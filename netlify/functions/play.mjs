import { getStore } from "@netlify/blobs";

export default async (req) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    let id, playerId, max, maxPlayers;
    try {
        const body = await req.json();
        id         = String(body.id         || "").trim();
        playerId   = String(body.playerId   || "").trim();
        max        = parseInt(body.max,        10);
        maxPlayers = parseInt(body.maxPlayers, 10) || 0;
    } catch(e) { return new Response("Bad Request", { status: 400 }); }

    // id = SHA-256(URL fragment) — identifies the link
    // playerId = SHA-256(browser fingerprint) — identifies the player
    if (!id || id.length < 10 || !playerId || playerId.length < 10)
        return new Response("Bad Request", { status: 400 });

    // max = per-player attempts (0 = unlimited per player, only player-cap applies)
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

        // ALWAYS use server-stored limits after first open (client cannot change them)
        const storedMax        = meta.max;          // per-player attempt cap (0 = unlimited)
        const storedMaxPlayers = meta.maxPlayers || 0; // total distinct-player cap (0 = unlimited)

        // Ensure players map exists (backwards-compat if old flat format is loaded)
        if (!meta.players) meta.players = {};

        const isNewPlayer = !meta.players[playerId];

        // ── Check total-player cap (new players only) ──────────────────────────────
        if (isNewPlayer && storedMaxPlayers > 0) {
            const playerCount = Object.keys(meta.players).length;
            if (playerCount >= storedMaxPlayers) {
                return Response.json({ used: 0, blocked: true, reason: "player_limit" });
            }
        }

        // Get or create this player's record
        let player = meta.players[playerId];
        if (!player) {
            player = { attempts: 0, firstSeen: Date.now(), lastSeen: Date.now(), ip: maskedIp, plays: [] };
        }

        // ── Check per-player attempt cap ───────────────────────────────────────────
        if (storedMax > 0 && player.attempts >= storedMax) {
            return Response.json({ used: player.attempts, blocked: true, reason: "attempt_limit" });
        }

        // Consume one attempt for this player
        const playId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        player.attempts++;
        player.lastSeen = Date.now();
        player.ip = maskedIp;
        player.plays.push({
            playId,
            openedAt: Date.now(),
            finishedAt: null,
            won: null,
            guesses: null,
            completed: false
        });

        meta.players[playerId] = player;
        await store.set(`meta:${id}`, JSON.stringify(meta));

        return Response.json({
            used: player.attempts,                  // this player's attempts used (incl. this one)
            blocked: false,
            playId,
            remaining: storedMax > 0 ? storedMax - player.attempts : null
        });

    } catch(e) {
        console.error("play error:", e);
        return new Response("Storage error", { status: 500 });
    }
};
