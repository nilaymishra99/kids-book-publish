// POST /api/detect-faces — finds the people in an uploaded photo so the
// parent can choose which headshot to use. Returns a box for each face
// (fractions of the image width and height) and a short, neutral description
// to tell people apart. It never names anyone.
//
// Required env var: OPENAI_API_KEY. Optional: DETECT_MODEL (default gpt-4.1-mini),
// DETECT_HOURLY_LIMIT (default 200 per IP).
//
// The photo is not stored. If the key isn't set, the client falls back to the
// browser's face detector or the centre of the photo.

const { readJsonBody, clientIp, rateLimited } = require("./_lib");

const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FACES = 6;

const SYSTEM = `You find the people in a family photo so a parent can choose which one to use.
For each clearly visible human face, give the bounding box of the head (including hair) as fractions of the image: x and y of the top-left corner, then width and height, each between 0 and 1.
Give a short, neutral description to tell the people apart, for example "young girl with pigtails, smiling" or "man in a blue shirt with glasses". Do not name anyone and do not guess who anyone is.
Ignore faces that are very small, blurred, or mostly hidden.
Reply only with JSON: {"people": [{"box": [x, y, width, height], "description": "..."}]}. If there are no faces, reply {"people": []}.`;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function cleanFaces(people) {
  if (!Array.isArray(people)) return [];
  return people
    .slice(0, MAX_FACES)
    .map((p) => {
      const b = Array.isArray(p?.box) ? p.box.map(Number) : [];
      if (b.length !== 4 || b.some((n) => !Number.isFinite(n))) return null;
      const [x, y] = [clamp01(b[0]), clamp01(b[1])];
      const w = Math.min(1 - x, clamp01(b[2]));
      const h = Math.min(1 - y, clamp01(b[3]));
      if (w < 0.03 || h < 0.03) return null;
      const description = String(p.description || "person").replace(/[\r\n]+/g, " ").trim().slice(0, 60) || "person";
      return { box: [x, y, w, h], description };
    })
    .filter(Boolean);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Automatic face finding isn't switched on." });
  if (rateLimited(`detect:${clientIp(req)}`, Number(process.env.DETECT_HOURLY_LIMIT) || 200, 60 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many photos checked. Please try again in an hour." });
  }

  const body = readJsonBody(req);
  const match = DATA_URL_RE.exec(body?.photo || "");
  if (!match) return res.status(400).json({ error: "Please upload a JPG, PNG or WebP photo." });
  if (Buffer.byteLength(match[2], "base64") > MAX_BYTES) return res.status(413).json({ error: "That photo is too large." });

  try {
    const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.DETECT_MODEL || "gpt-4.1-mini",
        response_format: { type: "json_object" },
        max_tokens: 800,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Find every human face in this photo." },
              { type: "image_url", image_url: { url: body.photo, detail: "high" } },
            ],
          },
        ],
      }),
    });
    const data = await apiRes.json().catch(() => ({}));
    if (!apiRes.ok) {
      console.error("Face finding error:", apiRes.status, JSON.stringify(data?.error || data).slice(0, 300));
      return res.status(502).json({ error: "We couldn't check that photo. Please try again." });
    }
    let parsed = {};
    try {
      parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    } catch {
      parsed = {};
    }
    return res.status(200).json({ faces: cleanFaces(parsed.people) });
  } catch (err) {
    console.error("Face finding failed:", err);
    return res.status(500).json({ error: "We couldn't check that photo. Please try again." });
  }
};
