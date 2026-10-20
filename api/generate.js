// POST /api/generate — illustrates ONE page (or the cover) with an AI image
// model, using the uploaded family photos as likeness references.
//
// The prompt is built here from data/stories.json — the browser only sends a
// story id, a page number and the book length, so this endpoint can't be used
// as a general image generator.
//
// Required env var: OPENAI_API_KEY
// Optional: IMAGE_MODEL (default gpt-image-1), IMAGE_QUALITY (low|medium|high,
//           default medium), IMAGE_INPUT_FIDELITY (default high; set to "" to
//           omit), GENERATE_HOURLY_LIMIT (requests per IP per hour, default 150)
//
// Photos are forwarded to the image provider for this one request and are not
// stored anywhere by this function.

const { readJsonBody, findStory, clientIp, rateLimited, bookPages, resolveCast, validPageCount, PAGE_LIMITS } = require("./_lib");

const STYLES = {
  comic: "bright classic comic-book art for children, bold clean ink outlines, flat vivid colours, light halftone shading",
  manga: "cute manga / anime style for young children, clean line art, soft cel shading, big expressive eyes",
  watercolor: "soft watercolour picture-book illustration, gentle paper texture, warm pastel palette",
  cartoon3d: "modern 3D animated family-film style, soft studio lighting, rounded friendly shapes",
};

const SLOTS = ["c1", "c2", "c3", "c4", "c5"];
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;

function clean(str, max) {
  return (str || "").toString().replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "AI illustration isn't switched on yet." });
  }

  const limit = Number(process.env.GENERATE_HOURLY_LIMIT) || 150;
  if (rateLimited(`gen:${clientIp(req)}`, limit, 60 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many illustrations requested. Please try again in an hour." });
  }

  const body = readJsonBody(req);
  if (!body) return res.status(400).json({ error: "Invalid JSON body" });

  const story = findStory(body.storyId);
  if (!story) return res.status(400).json({ error: "Unknown story." });

  const pageCount = body.pageCount === undefined ? PAGE_LIMITS.min : Number(body.pageCount);
  if (!validPageCount(pageCount)) return res.status(400).json({ error: "Books have 15 to 30 pages." });

  const pages = bookPages(story, pageCount);
  const isCover = body.panel === "cover";
  const page = isCover ? null : pages[Number(body.panel)];
  if (!isCover && !page) return res.status(400).json({ error: "Unknown page." });

  const style = STYLES[body.style] || STYLES.comic;
  const hero = {
    name: clean(body.hero?.name, 40) || "the child",
    age: Math.min(10, Math.max(0, parseInt(body.hero?.age, 10) || 4)),
    pronoun: ["she", "he", "they"].includes(body.hero?.pronoun) ? body.hero.pronoun : "they",
  };
  const people = {};
  for (const member of Array.isArray(body.cast) ? body.cast : []) {
    if (SLOTS.includes(member?.slot)) {
      people[member.slot] = { name: clean(member.name, 40), relation: clean(member.relation, 30) };
    }
  }
  const peopleList = Object.keys(people).map((slot) => ({ slot }));

  const cast = isCover
    ? ["hero", "sk", ...Object.keys(people)]
    : resolveCast(page, peopleList);

  const refs = [];
  const lines = [];
  for (const slot of cast) {
    const photo = (body.photos || {})[slot];
    const match = typeof photo === "string" && PHOTO_RE.exec(photo);
    let who;
    if (slot === "hero") {
      const kid = hero.pronoun === "she" ? "girl" : hero.pronoun === "he" ? "boy" : "child";
      who = `${hero.name}, a ${hero.age}-year-old ${kid} (the main character)`;
    } else if (slot === "sk") {
      who = `${story.sidekick.name}, ${story.sidekick.desc}`;
    } else if (people[slot]) {
      who = `${people[slot].name || "a family member"}${people[slot].relation ? `, the child's ${people[slot].relation.toLowerCase()}` : ""}`;
    } else {
      continue;
    }
    if (match) {
      const buf = Buffer.from(match[2], "base64");
      if (buf.length > MAX_PHOTO_BYTES) return res.status(413).json({ error: "A photo is too large." });
      refs.push({ buf, type: `image/${match[1]}` });
      lines.push(`- ${who}: match the face, skin tone and hair from reference photo ${refs.length}`);
    } else {
      lines.push(`- ${who}`);
    }
  }

  const scene = isCover
    ? `the front cover of a comic book called "${story.title.replace("{hero}", hero.name)}": the main character in a joyful pose in a ${story.theme.toLowerCase()} setting, with the other characters around them. Leave empty space at the top for the title.`
    : page.scene;

  const prompt = [
    `Illustrate a single page for a personalised children's comic book (reader age ${hero.age}).`,
    `Art style: ${style}.`,
    `Scene: ${scene}.`,
    `Characters in this picture:`,
    ...lines,
    `Turn every real person into a friendly cartoon character in this art style while keeping them clearly recognisable.`,
    `Wholesome, warm and age-appropriate. Everyone fully and modestly dressed. Do NOT draw any text, letters, captions or speech bubbles — they are added later.`,
  ].join("\n");

  const model = process.env.IMAGE_MODEL || "gpt-image-1";
  const common = {
    model,
    prompt,
    size: "1536x1024",
    quality: process.env.IMAGE_QUALITY || "medium",
    output_format: "jpeg",
    n: "1",
  };

  try {
    let apiRes;
    if (refs.length) {
      const form = new FormData();
      for (const [k, v] of Object.entries(common)) form.append(k, v);
      const fidelity = process.env.IMAGE_INPUT_FIDELITY ?? "high";
      if (fidelity) form.append("input_fidelity", fidelity);
      refs.forEach((ref, i) => form.append("image[]", new Blob([ref.buf], { type: ref.type }), `ref-${i + 1}.jpg`));
      apiRes = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } else {
      apiRes = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...common, n: 1 }),
      });
    }

    const data = await apiRes.json().catch(() => ({}));
    if (!apiRes.ok || !data?.data?.[0]?.b64_json) {
      console.error("Image API error:", apiRes.status, JSON.stringify(data?.error || data).slice(0, 500));
      const blocked = data?.error?.code === "moderation_blocked";
      return res.status(502).json({
        error: blocked
          ? "The illustrator couldn't use one of these photos. Try a clearer, front-facing photo."
          : "The illustrator is busy right now. We'll use photo-comic style for this page.",
      });
    }

    return res.status(200).json({ image: `data:image/jpeg;base64,${data.data[0].b64_json}` });
  } catch (err) {
    console.error("Generate failed:", err);
    return res.status(500).json({ error: "Couldn't illustrate this page right now." });
  }
};
