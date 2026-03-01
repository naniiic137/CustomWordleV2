import { getStore } from "@netlify/blobs";

export default async (req) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    let id, max;
    try {
        const body = await req.json();
        id  = String(body.id  || "").trim();
        max = parseInt(body.max, 10);
    } catch(e) { return new Response("Bad Request", { status: 400 }); }

    if (!id || id.length < 10 || isNaN(max) || max < 1 || max > 100)
        return new Response("Bad Request", { status: 400 });

    const ip = req.headers.get("x-nf-client-connection-ip")
            || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || "unknown";
    const maskedIp = ip.replace(/(\d+\.\d+)\.\d+\.\d+/, "$1.x.x");

    try {
        const store = getStore({ name: "wordle", consistency: "strong" });

        // Load existing record or create fresh
        let meta = null;
        try {
            const raw = await store.get(`meta:${id}`, { type: "text" });
            if (raw) meta = JSON.parse(raw);
        } catch(e) {}

        if (!meta) {
            // First ever open — create the record with max from client
            meta = { max, label: "Untitled", created: Date.now(), plays: [] };
        }

        // ALWAYS use the server-stored max after the first open (client can't change it)
        const storedMax = meta.max;
        const usedSlots = meta.plays.length;

        // All attempts used — block
        if (usedSlots >= storedMax) {
            return Response.json({ used: usedSlots, blocked: true });
        }

        // Consume one attempt
        const playId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        meta.plays.push({
            playId,
            openedAt: Date.now(),
            finishedAt: null,
            won: null,
            guesses: null,
            completed: false,
            ip: maskedIp
        });

        await store.set(`meta:${id}`, JSON.stringify(meta));

        // Return used = plays so far (including this one)
        return Response.json({ used: meta.plays.length, blocked: false, playId });

    } catch(e) {
        console.error("play error:", e);
        return new Response("Storage error", { status: 500 });
    }
};
