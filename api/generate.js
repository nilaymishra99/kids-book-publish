// POST /api/generate — AI illustration for the comic.
//
// Three modes, all prompts built here from data/stories.json so the browser
// can't steer the image model:
//   "sidekick"  — draws the story's sidekick character sheet (no photo)
//   "character" — draws a cartoon character sheet from one uploaded photo
//                 (the closest cartoon likeness we can get)
//   "page"      — draws one full comic page (cover or story page), using the
//                 character sheets as references so faces stay consistent
//
// Required env var: OPENAI_API_KEY
// Optional: IMAGE_MODEL (default gpt-image-1), IMAGE_QUALITY (low|medium|high,
//           default medium), GENERATE_HOURLY_LIMIT (requests per IP per hour,
//           default 300)
//
// Photos are sent to the image provider only for the "character" call and are
// not stored by this function.

const { readJsonBody, findStory, clientIp, rateLimited, bookPages, resolveCast, validPageCount, PAGE_LIMITS } = require("./_lib");

const STYLE = "bright, colourful, joyful children's comic book art: bold clean outlines, vivid rainbow colours, sparkles and little details in every corner, friendly rounded characters, soft gradients, playful and magical";
const SLOTS = ["c1", "c2", "c3", "c4", "c5"];
const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_REFS = 6;
const SIZE = "1024x1024";

function clean(str, max) {
  return (str || "").toString().replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function listNames(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// Same token rules as js/comic.js fillText.
function fillText(text, hero, people, story, pronoun) {
  const pron = { she: ["her", "her", "Her"], he: ["his", "him", "His"] }[pronoun] || ["their", "them", "Their"];
  const names = people.map((p) => p.name || "a family member");
  const bySlot = Object.fromEntries(people.map((p) => [p.slot, p.name || "a family member"]));
  return text
    .replace(/\{hero\}/g, hero)
    .replace(/\{family\}/g, listNames(names.length ? names : [story.sidekick.name]))
    .replace(/\{(c[2-5])\}/g, (_, slot) => bySlot[slot] || story.sidekick.name)
    .replace(/\{c1\}/g, bySlot.c1 || story.sidekick.name)
    .replace(/\{their\}/g, pron[0])
    .replace(/\{them\}/g, pron[1])
    .replace(/\{Their\}/g, pron[2]);
}

function imageFromResponse(data) {
  const b64 = data?.data?.[0]?.b64_json;
  return b64 ? `data:image/jpeg;base64,${b64}` : null;
}

async function callImages(apiKey, { prompt, refs }) {
  const model = process.env.IMAGE_MODEL || "gpt-image-1";
  const quality = process.env.IMAGE_QUALITY || "medium";
  if (!refs.length) {
    return fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, size: SIZE, quality, output_format: "jpeg", n: 1 }),
    });
  }
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", SIZE);
  form.append("quality", quality);
  form.append("output_format", "jpeg");
  form.append("n", "1");
  refs.forEach((ref, i) => form.append("image[]", new Blob([ref.buf], { type: ref.type }), `ref-${i + 1}.jpg`));
  return fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
}

function parseDataUrl(value) {
  const match = typeof value === "string" && DATA_URL_RE.exec(value);
  if (!match) return null;
  const buf = Buffer.from(match[2], "base64");
  if (buf.length > MAX_IMAGE_BYTES) return "too-large";
  return { buf, type: `image/${match[1]}` };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "AI illustration isn't switched on yet." });

  const limit = Number(process.env.GENERATE_HOURLY_LIMIT) || 300;
  if (rateLimited(`gen:${clientIp(req)}`, limit, 60 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many illustrations requested. Please try again in an hour." });
  }

  const body = readJsonBody(req);
  if (!body) return res.status(400).json({ error: "Invalid JSON body" });
  const story = findStory(body.storyId);
  if (!story) return res.status(400).json({ error: "Unknown story." });

  const hero = clean(body.hero?.name, 40) || "the child";
  const age = Math.min(10, Math.max(0, parseInt(body.hero?.age, 10) || 4));
  const pronoun = ["she", "he", "they"].includes(body.hero?.pronoun) ? body.hero.pronoun : "they";
  const kid = pronoun === "she" ? "girl" : pronoun === "he" ? "boy" : "child";
  const people = (Array.isArray(body.cast) ? body.cast : [])
    .filter((m) => SLOTS.includes(m?.slot))
    .map((m) => ({ slot: m.slot, name: clean(m.name, 40), relation: clean(m.relation, 30) }));

  try {
    // ---- Sidekick character sheet (text only) ----
    if (body.mode === "sidekick") {
      const prompt = `Character design sheet for a children's comic: ${story.sidekick.name}, ${story.sidekick.desc}. Full body, friendly happy pose, centred on a plain soft pastel background. ${STYLE}. No text, no letters.`;
      const apiRes = await callImages(apiKey, { prompt, refs: [] });
      const image = imageFromResponse(await apiRes.json().catch(() => ({})));
      return image ? res.status(200).json({ image }) : res.status(502).json({ error: "The illustrator is busy right now." });
    }

    // ---- Cartoon character from one photo ----
    if (body.mode === "character") {
      const slot = body.slot;
      const photo = parseDataUrl(body.photo);
      if (photo === "too-large") return res.status(413).json({ error: "That photo is too large." });
      if (!photo) return res.status(400).json({ error: "Please upload a JPG, PNG or WebP photo." });
      const person = slot === "hero" ? `${hero}, a ${age}-year-old ${kid} (the main character)` : `${clean(body.name, 40) || "a family member"}${clean(body.relation, 30) ? `, the child's ${clean(body.relation, 30).toLowerCase()}` : ""}`;
      const prompt = `Turn the person in the reference photo into a cartoon character design sheet for a children's comic. The character is ${person}. Keep a close likeness: the same face shape, hair style and colour, skin tone, eye colour, and any glasses. Make it a friendly, cute cartoon version. Full body, happy pose, plain soft pastel background. ${STYLE}. Wholesome, fully and modestly dressed. No text, no letters.`;
      const apiRes = await callImages(apiKey, { prompt, refs: [{ ...photo, type: photo.type }] });
      const data = await apiRes.json().catch(() => ({}));
      const image = imageFromResponse(data);
      if (!apiRes.ok || !image) {
        const blocked = data?.error?.code === "moderation_blocked";
        return res.status(502).json({
          error: blocked ? "The illustrator couldn't use that photo. Try a clearer, front-facing photo." : "The illustrator is busy right now.",
        });
      }
      return res.status(200).json({ image });
    }

    // ---- One full comic page ----
    if (body.mode !== "page") return res.status(400).json({ error: "Unknown mode." });
    const pageCount = body.pageCount === undefined ? PAGE_LIMITS.min : Number(body.pageCount);
    if (!validPageCount(pageCount)) return res.status(400).json({ error: "Books have 15 to 30 pages." });
    const pages = bookPages(story, pageCount);
    const isCover = body.panel === "cover";
    const page = isCover ? null : pages[Number(body.panel)];
    if (!isCover && !page) return res.status(400).json({ error: "Unknown page." });

    const cast = isCover ? ["hero", "sk", ...people.map((p) => p.slot)] : resolveCast(page, people);
    const sheets = body.characters && typeof body.characters === "object" ? body.characters : {};
    const refs = [];
    const lines = [];
    for (const slot of cast) {
      const parsed = parseDataUrl(sheets[slot]);
      if (parsed && parsed !== "too-large" && refs.length < MAX_REFS) {
        refs.push(parsed);
        const who = slot === "hero" ? `${hero}, the main character` : slot === "sk" ? story.sidekick.name : people.find((p) => p.slot === slot)?.name || "a family member";
        lines.push(`- Reference image ${refs.length} is ${who}. Keep this character's look exactly the same.`);
      }
    }

    const scene = isCover
      ? `The front cover of a comic book titled "${story.title.replace("{hero}", hero)}". ${hero} in a joyful heroic pose with the other characters around. Big bold title text at the top, nothing else in text.`
      : page.scene;
    const bubbles = isCover ? [] : page.speech.map((s) => {
      const who = s.who === "hero" ? hero : s.who === "sk" ? story.sidekick.name : people.find((p) => p.slot === s.who)?.name || story.sidekick.name;
      return `${who}: "${fillText(s.text, hero, people, story, pronoun)}"`;
    });
    const caption = isCover ? null : fillText(page.caption, hero, people, story, pronoun);
    const pageNumber = isCover ? null : Number(body.panel) + 1;

    const prompt = [
      `A complete page of a personalised children's comic book, square format, page ${pageNumber ?? "cover"} of ${pageCount}.`,
      `Style: ${STYLE}.`,
      `Lay out the page as one to three comic panels with clear white gutters, whichever suits the scene best.`,
      `Scene: ${scene}.`,
      lines.length ? `Characters (use the reference images):\n${lines.join("\n")}` : "",
      caption ? `Put this caption in a yellow box at the top of the page, spelled exactly: "${caption}"` : "",
      bubbles.length ? `Add these speech bubbles, spelled exactly as written:\n${bubbles.map((b) => `- ${b}`).join("\n")}` : "",
      `Only the text listed above may appear on the page. Keep text large, short and easy to read. Wholesome, warm and age-appropriate, fully and modestly dressed.`,
    ].filter(Boolean).join("\n");

    const apiRes = await callImages(apiKey, { prompt, refs });
    const data = await apiRes.json().catch(() => ({}));
    const image = imageFromResponse(data);
    if (!apiRes.ok || !image) {
      console.error("Image API error:", apiRes.status, JSON.stringify(data?.error || data).slice(0, 500));
      return res.status(502).json({ error: "The illustrator is busy right now. We'll show this page in photo-comic style." });
    }
    return res.status(200).json({ image });
  } catch (err) {
    console.error("Generate failed:", err);
    return res.status(500).json({ error: "Couldn't draw this right now." });
  }
};
