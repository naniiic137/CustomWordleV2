import { getStore } from "@netlify/blobs";

export default async (req) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    let id, playerId, max, maxPlayers, isPing;
    try {
        const body = await req.json();
        id         = String(body.id         || "").trim();
        playerId   = String(body.playerId   || "").trim();
        max        = parseInt(body.max,        10);
        maxPlayers = parseInt(body.maxPlayers, 10) || 0;
        isPing     = !!body.ping;
    } catch(e) { return new Response("Bad Request", { status: 400 }); }

    // id = SHA-256(URL fragment) — identifies the link
    // playerId = SHA-256(browser fingerprint + session ID) — identifies the player tab
    if (!id || id.length < 10 || !playerId || playerId.length < 10)
        return new Response("Bad Request", { status: 400 });

    if (isNaN(max)) max = 0;
    if (isNaN(maxPlayers)) maxPlayers = 0;
    if (max < 0 || max > 100) return new Response("Bad Request", { status: 400 });
    if (maxPlayers < 0 || maxPlayers > 10000) return new Response("Bad Request", { status: 400 });

    const ip = req.headers.get("x-nf-client-connection-ip")
            || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || "unknown";
    const maskedIp = ip.replace(/(\d+\.\d+)\.\d+\.\d+/, "$1.x.x");

    try {
        const store = getStore({ name: "wordle", consistency: "strong" });

        // Load or create the per-link meta record
        let meta = null;
        try {
            const raw = await store.get(`meta:${id}`, { type: "text" });
            if (raw) meta = JSON.parse(raw);
        } catch(e) {}

        if (!meta) {
            // First ever open of this link — lock in both limits from the creator's config
            meta = {
                max,
                maxPlayers: maxPlayers || 0,
                label: "Untitled",
                created: Date.now(),
                players: {}
            };
        }

        const storedMax        = meta.max;
        const storedMaxPlayers = meta.maxPlayers || 0;
        if (!meta.players) meta.players = {};

        // ── HANDLE PING ────────────────────────────────────────────────────────────
        // If this is just a background heartbeat, update lastPing and exit early.
        if (isPing) {
            if (meta.players[playerId]) {
                meta.players[playerId].lastPing = Date.now();
                await store.set(`meta:${id}`, JSON.stringify(meta));
            }
            return Response.json({ ok: true });
        }

        const isNewPlayer = !meta.players[playerId];
        const now = Date.now();

        // ── Check Lobby (active total-player cap) ──────────────────────────────────
        if (isNewPlayer && storedMaxPlayers > 0) {
            // Count players who have pinged within the last 20 seconds.
            // If they closed the tab, their ping will be older, freeing their slot.
            let activeCount = 0;
            for (const pid in meta.players) {
                const p = meta.players[pid];
                // Support legacy plays without lastPing by defaulting to lastSeen
                const lastActive = p.lastPing || p.lastSeen || 0;
                if (now - lastActive < 20000) {
                    activeCount++;
                }
            }

            if (activeCount >= storedMaxPlayers) {
                return Response.json({ used: 0, blocked: true, reason: "player_limit" });
            }
        }

        // Get or create this player's record
        let player = meta.players[playerId];
        if (!player) {
            player = { attempts: 0, firstSeen: now, lastSeen: now, lastPing: now, ip: maskedIp, plays: [] };
        }

        // ── Check per-player attempt cap ───────────────────────────────────────────
        if (storedMax > 0 && player.attempts >= storedMax) {
            // Update ping even if blocked, so they don't immediately drop from lobby screen
            player.lastPing = now;
            meta.players[playerId] = player;
            await store.set(`meta:${id}`, JSON.stringify(meta));

            return Response.json({ used: player.attempts, blocked: true, reason: "attempt_limit" });
        }

        // Consume one attempt for this player
        const playId = `${now}-${Math.random().toString(36).slice(2, 8)}`;
        player.attempts++;
        player.lastSeen = now;
        player.lastPing = now; // Mark as active in the lobby
        player.ip = maskedIp;
        player.plays.push({
            playId,
            openedAt: now,
            finishedAt: null,
            won: null,
            guesses: null,
            completed: false
        });

        meta.players[playerId] = player;
        await store.set(`meta:${id}`, JSON.stringify(meta));

        return Response.json({
            used: player.attempts,
            blocked: false,
            playId,
            remaining: storedMax > 0 ? storedMax - player.attempts : null
        });

    } catch(e) {
        console.error("play error:", e);
        return new Response("Storage error", { status: 500 });
    }
};
