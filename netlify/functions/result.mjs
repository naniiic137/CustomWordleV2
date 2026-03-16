import { getStore } from "@netlify/blobs";

export default async (req) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    let id, playId, won, guesses;
    try {
        const body = await req.json();
        id      = String(body.id      || "").trim();
        playId  = String(body.playId  || "").trim();
        won     = !!body.won;
        guesses = parseInt(body.guesses, 10);
    } catch(e) { return new Response("Bad Request", { status: 400 }); }

    if (!id || id.length < 10 || !playId)
        return new Response("Bad Request", { status: 400 });
    if (isNaN(guesses) || guesses < 1 || guesses > 20)
        return new Response("Bad Request", { status: 400 });

    try {
        const store = getStore({ name: "wordle", consistency: "strong" });

        let meta = null;
        try {
            const raw = await store.get(`meta:${id}`, { type: "text" });
            if (raw) meta = JSON.parse(raw);
        } catch(e) {}

        if (!meta) return Response.json({ ok: false, error: "puzzle_not_found" });

        /* Find the play record and update it */
        let found = false;
        for (const stableId in meta.attempts) {
            const record = meta.attempts[stableId];
            if (!record.plays) continue;
            for (let i = 0; i < record.plays.length; i++) {
                if (record.plays[i].playId === playId && !record.plays[i].completed) {
                    record.plays[i].finishedAt = Date.now();
                    record.plays[i].won = won;
                    record.plays[i].guesses = guesses;
                    record.plays[i].completed = true;
                    found = true;
                    break;
                }
            }
            if (found) break;
        }

        if (!found) return Response.json({ ok: false, error: "play_not_found" });

        await store.set(`meta:${id}`, JSON.stringify(meta));
        return Response.json({ ok: true });

    } catch(e) {
        console.error("result error:", e);
        return new Response("Storage error", { status: 500 });
    }
};
