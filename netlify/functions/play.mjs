import { getStore } from "@netlify/blobs";

export default async (req) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    /* Reject oversized payloads to prevent abuse */
    const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
    if (contentLength > 4096) return new Response("Payload Too Large", { status: 413 });

    let id, stableId, sessionId, max, maxPlayers, isPing;
    try {
        const body = await req.json();
        id         = String(body.id         || "").trim();
        stableId   = String(body.stableId   || "").trim();   // hardware fingerprint (same in private tabs)
        sessionId  = String(body.sessionId  || "").trim();   // per-tab fingerprint (includes sessionStorage ID)
        max        = parseInt(body.max,        10);
        maxPlayers = parseInt(body.maxPlayers, 10) || 0;
        isPing     = !!body.ping;
    } catch(e) { return new Response("Bad Request", { status: 400 }); }

    /* Validate input lengths to prevent storage abuse */
    if (id.length > 128 || stableId.length > 128 || sessionId.length > 128)
        return new Response("Bad Request", { status: 400 });

    if (!id || id.length < 10 || !stableId || stableId.length < 10 || !sessionId || sessionId.length < 10)
        return new Response("Bad Request", { status: 400 });

    if (isNaN(max)) max = 0;
    if (isNaN(maxPlayers)) maxPlayers = 0;
    if (max < 0 || max > 100) return new Response("Bad Request", { status: 400 });
    if (maxPlayers < 0 || maxPlayers > 10000) return new Response("Bad Request", { status: 400 });

    const ip = req.headers.get("x-nf-client-connection-ip")
            || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || "unknown";
    const maskedIp = ip.replace(/(\d+\.\d+)\.\d+\.\d+/, "$1.x.x");

    /* ── IP-based rate limiting: max 30 play requests per IP per minute ── */
    try {
        const rlStore = getStore({ name: "wordle-ratelimit", consistency: "strong" });
        const rlKey = `rl:${ip}`;
        let rl = null;
        try {
            const raw = await rlStore.get(rlKey, { type: "text" });
            if (raw) rl = JSON.parse(raw);
        } catch(e) {}
        const now0 = Date.now();
        if (!rl || now0 - rl.windowStart > 60000) {
            rl = { windowStart: now0, count: 1 };
        } else {
            rl.count++;
        }
        await rlStore.set(rlKey, JSON.stringify(rl));
        if (rl.count > 30) {
            return new Response("Too Many Requests", { status: 429 });
        }
    } catch(e) { /* rate limit store failure is non-fatal */ }

    try {
        const store = getStore({ name: "wordle", consistency: "strong" });

        let meta = null;
        try {
            const raw = await store.get(`meta:${id}`, { type: "text" });
            if (raw) meta = JSON.parse(raw);
        } catch(e) {}

        if (!meta) {
            meta = {
                max,
                maxPlayers: maxPlayers || 0,
                label: "Untitled",
                created: Date.now(),
                // Two separate tracking maps:
                // attempts: { stableId → { attempts, plays[] } }  — per-person attempt quota
                // sessions: { sessionId → { lastPing } }          — active lobby seats
                attempts: {},
                sessions: {}
            };
        }

        const storedMax        = meta.max;
        const storedMaxPlayers = meta.maxPlayers || 0;
        if (!meta.attempts) meta.attempts = {};
        if (!meta.sessions) meta.sessions = {};
        // Migrate old single "players" map to new "attempts" map
        if (meta.players && !Object.keys(meta.attempts).length) {
            meta.attempts = meta.players;
            delete meta.players;
        }

        const now = Date.now();

        // ── CLEANUP: prune sessions older than 5 minutes to prevent unbounded growth ──
        for (const sid in meta.sessions) {
            if (now - (meta.sessions[sid].lastPing || 0) > 300000) delete meta.sessions[sid];
        }

        // ── HANDLE PING ────────────────────────────────────────────────────────────
        if (isPing) {
            if (meta.sessions[sessionId]) {
                meta.sessions[sessionId].lastPing = now;
            } else {
                meta.sessions[sessionId] = { lastPing: now, stableId };
            }
            await store.set(`meta:${id}`, JSON.stringify(meta));
            return Response.json({ ok: true });
        }

        // ── 1) CHECK PER-PLAYER ATTEMPT LIMIT (using stableId) ─────────────────────
        // stableId is the HARDWARE fingerprint — identical across normal & private tabs.
        // This means private tabs CANNOT bypass the attempt limit.
        let playerRecord = meta.attempts[stableId];
        if (!playerRecord) {
            playerRecord = { attempts: 0, firstSeen: now, lastSeen: now, ip: maskedIp, plays: [] };
        }

        if (storedMax > 0 && playerRecord.attempts >= storedMax) {
            // Update session ping even when blocked so the lobby seat remains occupied
            meta.sessions[sessionId] = { lastPing: now, stableId };
            meta.attempts[stableId] = playerRecord;
            await store.set(`meta:${id}`, JSON.stringify(meta));
            return Response.json({ used: playerRecord.attempts, blocked: true, reason: "attempt_limit" });
        }

        // ── 2) CHECK LOBBY CAPACITY (using sessionId) ─────────────────────────────
        // sessionId is unique per tab — each tab occupies one "seat".
        // When a tab closes, its heartbeat stops and the session expires after 20s.
        const isNewSession = !meta.sessions[sessionId];
        if (isNewSession && storedMaxPlayers > 0) {
            let activeSessions = 0;
            for (const sid in meta.sessions) {
                const s = meta.sessions[sid];
                if (now - (s.lastPing || 0) < 20000) activeSessions++;
            }
            if (activeSessions >= storedMaxPlayers) {
                return Response.json({ used: playerRecord.attempts, blocked: true, reason: "player_limit" });
            }
        }

        // Register this session as active
        meta.sessions[sessionId] = { lastPing: now, stableId };

        // ── 3) CONSUME ONE ATTEMPT ─────────────────────────────────────────────────
        const playId = `${now}-${Math.random().toString(36).slice(2, 8)}`;
        playerRecord.attempts++;
        playerRecord.lastSeen = now;
        playerRecord.ip = maskedIp;
        playerRecord.plays.push({
            playId,
            openedAt: now,
            finishedAt: null,
            won: null,
            guesses: null,
            completed: false
        });

        meta.attempts[stableId] = playerRecord;
        await store.set(`meta:${id}`, JSON.stringify(meta));

        return Response.json({
            used: playerRecord.attempts,
            blocked: false,
            playId,
            remaining: storedMax > 0 ? storedMax - playerRecord.attempts : null
        });

    } catch(e) {
        console.error("play error:", e);
        return new Response("Storage error", { status: 500 });
    }
};
