const crypto = require("crypto");

exports.handler = async function(event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { password } = JSON.parse(event.body);
    const correctPassword = process.env.CREATOR_PASSWORD;

    if (!correctPassword) {
      console.error("CREATOR_PASSWORD environment variable is not set");
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: "Server configuration error" })
      };
    }

    /* Timing-safe comparison to prevent timing attacks */
    const a = Buffer.from(String(password || ""));
    const b = Buffer.from(String(correctPassword));
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (match) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true })
      };
    } else {
      return {
        statusCode: 401,
        body: JSON.stringify({ ok: false, error: "Incorrect password" })
      };
    }
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Invalid request" }) };
  }
};
