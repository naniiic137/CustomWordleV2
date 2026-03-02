import { getStore } from "@netlify/blobs";

export default async (req) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    let id, playerId, max;
    try {
        const body = await req.json();
        id       = String(body.id       || "").trim();
        playerId = String(body.playerId || "").trim();
        max      = parseInt(body.max, 10);
    } catch(e) { return new Response("Bad Request", { status: 400 }); }

    // id = SHA-256(URL fragment) — identifies the link
    // playerId = SHA-256(browser fingerprint) — identifies the player
    if (!id || id.length < 10 || !playerId || playerId.length < 10 || isNaN(max) || max < 1 || max > 100)
        return new Response("Bad Request", { status: 400 });

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
            // First ever open of this link — record the per-player attempt limit
            meta = { max, label: "Untitled", created: Date.now(), players: {} };
        }

        // ALWAYS use server-stored max after first open (client cannot inflate it)
        const storedMax = meta.max;

        // Ensure players map exists (backwards-compat if old flat format is loaded)
        if (!meta.players) meta.players = {};

        // Get or create this player's record
        let player = meta.players[playerId];
        if (!player) {
            player = { attempts: 0, firstSeen: Date.now(), lastSeen: Date.now(), ip: maskedIp, plays: [] };
        }

        // Check if this player has exhausted their personal attempt quota
        if (player.attempts >= storedMax) {
            return Response.json({ used: player.attempts, blocked: true });
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
            used: player.attempts,         // this player's attempts used (including this one)
            blocked: false,
            playId,
            remaining: storedMax - player.attempts  // attempts left for this player
        });

    } catch(e) {
        console.error("play error:", e);
        return new Response("Storage error", { status: 500 });
    }
};
