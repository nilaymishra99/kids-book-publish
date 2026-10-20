// POST /api/generate — AI illustration for the comic.
//
//   mode "sidekick"  — the story's sidekick character sheet (no photo)
//   mode "character" — a cartoon character sheet from one headshot
//   mode "page"      — one full comic page, drawn with the character sheets as
//                      references. The page text comes from the story written
//                      for this book (body.page), or from the template story
//                      when no written story is available.
//
// Providers and model ids are set in api/_providers.js (Gemini by default).
// Photos go to the image provider only in "character" mode and are not stored.

const { readJsonBody, findStory, clientIp, rateLimited, bookPages, resolveCast, validPageCount, PAGE_LIMITS } = require("./_lib");
const { imageReady, drawImage } = require("./_providers");

const STYLE = "bright, colourful, joyful children's comic book art: bold clean outlines, vivid rainbow colours, sparkles and little details in every corner, friendly rounded characters, soft gradients, playful and magical";
const SLOTS = ["c1", "c2", "c3", "c4", "c5"];
const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_REFS = 6;

const clean = (str, max) => (str || "").toString().replace(/[\r\n]+/g, " ").trim().slice(0, max);

function listNames(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// Template text uses tokens; written text already has names.
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

// Written pages come from the story writer and are checked again here.
function writtenPage(p, allowed) {
  const scene = clean(p?.scene, 500);
  const caption = clean(p?.caption, 220);
  if (!scene || !caption) return null;
  const cast = ["hero"];
  for (const s of Array.isArray(p.cast) ? p.cast : []) if (allowed.has(s) && !cast.includes(s)) cast.push(s);
  const speech = (Array.isArray(p.speech) ? p.speech : [])
    .filter((s) => cast.includes(s?.who))
    .slice(0, 2)
    .map((s) => ({ who: s.who, text: clean(s.text, 140) }))
    .filter((s) => s.text);
  return { scene, caption, speech, cast, written: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!imageReady()) return res.status(503).json({ error: "AI illustration isn't switched on yet." });
  if (rateLimited(`gen:${clientIp(req)}`, Number(process.env.GENERATE_HOURLY_LIMIT) || 300, 60 * 60 * 1000)) {
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
    if (body.mode === "sidekick") {
      const prompt = `Character design sheet for a children's comic: ${story.sidekick.name}, ${story.sidekick.desc}. Full body, friendly happy pose, centred on a plain soft pastel background. ${STYLE}. No text, no letters.`;
      const out = await drawImage({ prompt });
      return out.image ? res.status(200).json({ image: out.image }) : res.status(out.status || 502).json({ error: out.error });
    }

    if (body.mode === "character") {
      const match = DATA_URL_RE.exec(body.photo || "");
      if (!match) return res.status(400).json({ error: "Please upload a JPG, PNG or WebP photo." });
      const buf = Buffer.from(match[2], "base64");
      if (buf.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: "That photo is too large." });
      const slot = body.slot;
      const who = slot === "hero"
        ? `${hero}, a ${age}-year-old ${kid} (the main character)`
        : `${clean(body.name, 40) || "a family member"}${clean(body.relation, 30) ? `, the child's ${clean(body.relation, 30).toLowerCase()}` : ""}`;
      const prompt = `Turn the person in the reference photo into a cartoon character design sheet for a children's comic. The character is ${who}. Keep a close likeness: the same face shape, hair style and colour, skin tone, eye colour, and any glasses. Make it a friendly, cute cartoon version. Full body, happy pose, plain soft pastel background. ${STYLE}. Wholesome, fully and modestly dressed. No text, no letters.`;
      const out = await drawImage({ prompt, refs: [{ buf, type: `image/${match[1]}` }] });
      if (!out.image) return res.status(out.status || 502).json({ error: out.blocked ? "The illustrator couldn't use that photo. Try a clearer, front-facing photo." : out.error });
      return res.status(200).json({ image: out.image });
    }

    if (body.mode !== "page") return res.status(400).json({ error: "Unknown mode." });
    const pageCount = body.pageCount === undefined ? PAGE_LIMITS.min : Number(body.pageCount);
    if (!validPageCount(pageCount)) return res.status(400).json({ error: "Books have 15 to 30 pages." });
    const isCover = body.panel === "cover";
    const allowed = new Set(["hero", "sk", ...people.map((p) => p.slot)]);

    // The page: written text for this book, or the template page.
    let page;
    let filled = false;
    if (isCover) {
      page = null;
    } else if (body.page) {
      page = writtenPage(body.page, allowed);
      if (!page) return res.status(400).json({ error: "Unknown page." });
      filled = true;
    } else {
      const pages = bookPages(story, pageCount);
      page = pages[Number(body.panel)];
      if (!page) return res.status(400).json({ error: "Unknown page." });
    }

    const cast = isCover ? ["hero", "sk", ...people.map((p) => p.slot)] : filled ? page.cast : resolveCast(page, people);
    const sheets = body.characters && typeof body.characters === "object" ? body.characters : {};
    const refs = [];
    const lines = [];
    for (const slot of cast) {
      const match = DATA_URL_RE.exec(sheets[slot] || "");
      if (match && refs.length < MAX_REFS) {
        refs.push({ buf: Buffer.from(match[2], "base64"), type: `image/${match[1]}` });
        const name = slot === "hero" ? `${hero}, the main character` : slot === "sk" ? story.sidekick.name : people.find((p) => p.slot === slot)?.name || "a family member";
        lines.push(`- Reference image ${refs.length} is ${name}. Keep this character's look exactly the same.`);
      }
    }

    const text = (s) => (filled ? s : fillText(s, hero, people, story, pronoun));
    const title = clean(body.title, 80) || story.title.replace("{hero}", hero);
    const scene = isCover ? `The front cover of a comic book titled "${title}". ${hero} in a joyful heroic pose with the other characters around. Big bold title text at the top, nothing else in text.` : page.scene;
    const caption = isCover ? null : text(page.caption);
    const bubbles = isCover ? [] : page.speech.map((s) => {
      const name = s.who === "hero" ? hero : s.who === "sk" ? story.sidekick.name : people.find((p) => p.slot === s.who)?.name || story.sidekick.name;
      return `${name}: "${text(s.text)}"`;
    });
    const pageNumber = isCover ? "cover" : `${Number(body.panel) + 1} of ${pageCount}`;

    const prompt = [
      `A complete page of a personalised children's comic book, square format, page ${pageNumber}.`,
      `Style: ${STYLE}.`,
      `Lay out the page as one to three comic panels with clear white gutters, whichever suits the scene best.`,
      `Scene: ${scene}.`,
      lines.length ? `Characters (use the reference images):\n${lines.join("\n")}` : "",
      caption ? `Put this caption in a yellow box at the top of the page, spelled exactly: "${caption}"` : "",
      bubbles.length ? `Add these speech bubbles, spelled exactly as written:\n${bubbles.map((b) => `- ${b}`).join("\n")}` : "",
      `Only the text listed above may appear on the page. Keep text large, short and easy to read. Wholesome, warm and age-appropriate, fully and modestly dressed.`,
    ].filter(Boolean).join("\n");

    const out = await drawImage({ prompt, refs });
    if (!out.image) return res.status(out.status || 502).json({ error: out.error });
    return res.status(200).json({ image: out.image });
  } catch (err) {
    console.error("Generate failed:", err);
    return res.status(500).json({ error: "Couldn't draw this right now." });
  }
};
