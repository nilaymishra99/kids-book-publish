// POST /api/write-story — writes one personalised story for a book, using
// Claude. Every page is checked here before it reaches the browser: the page
// count, the length of the text, and who may speak or appear.
//
// Body: { storyId, pageCount, hero: {name, age, pronoun}, people: [{slot, name, relation}] }
// Returns: { title, pages: [{ scene, caption, speech: [{who, text}], cast: [slot] }] }

const { readJsonBody, findStory, clientIp, rateLimited, validPageCount, PAGE_LIMITS } = require("./_lib");
const { storyReady, writesJson } = require("./_providers");

const SLOTS = ["c1", "c2", "c3", "c4", "c5"];
const clean = (s, max) => String(s || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

const CRAFT = `You are an award-winning children's book author writing a personalised comic book.
Write a complete, original story with a clear beginning, middle and end, and a satisfying ending. Plot rules:
- Every page moves the story forward. No filler pages, no repeated scenes.
- Give the hero a real want and a real problem. Use clear cause and effect, one small surprise, and a moment where family helps the hero find their own courage.
- Give the sidekick a personality and a funny habit that shows up more than once.
- Use the child's name and the pronouns given. Use family members by name.
- Warm, funny, and kind. No scary villains; any obstacle is solved with cleverness or kindness.
- The reading level must suit the age: very short, simple words for toddlers; short sentences and a little humour for young children; richer language and a real plot twist for older children.
- Captions are the narrator's words (one or two short sentences). Speech bubbles are what characters say (short, and natural).
- "scene" describes the picture for an illustrator: who is where, what they are doing, the colours, the setting and the mood. Be specific and vivid. Do not ask for any text in the picture.
- "cast" lists the slots drawn on that page: "hero", "sk" (the sidekick), or the family slots given.
- Reply with JSON only, no commentary: {"title": "...", "pages": [{"scene": "...", "caption": "...", "speech": [{"who": "hero|sk|c1..c5", "text": "..."}], "cast": ["hero", ...]}]}`;

function sanitizePage(p, allowed) {
  const cast = ["hero"];
  for (const slot of Array.isArray(p?.cast) ? p.cast : []) {
    if (allowed.has(slot) && !cast.includes(slot)) cast.push(slot);
  }
  const speech = (Array.isArray(p?.speech) ? p.speech : [])
    .filter((s) => allowed.has(s?.who) && cast.includes(s.who))
    .slice(0, 2)
    .map((s) => ({ who: s.who, text: clean(s.text, 140) }))
    .filter((s) => s.text);
  const scene = clean(p?.scene, 500);
  const caption = clean(p?.caption, 220);
  if (!scene || !caption) return null;
  return { scene, caption, speech, cast };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!storyReady()) return res.status(503).json({ error: "Story writing isn't switched on yet." });
  if (rateLimited(`story:${clientIp(req)}`, Number(process.env.STORY_HOURLY_LIMIT) || 100, 60 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many stories requested. Please try again in an hour." });
  }

  const body = readJsonBody(req);
  if (!body) return res.status(400).json({ error: "Invalid JSON body" });
  const story = findStory(body.storyId);
  if (!story) return res.status(400).json({ error: "Unknown story." });
  const pageCount = Number(body.pageCount);
  if (!validPageCount(pageCount)) return res.status(400).json({ error: "Books have 15 to 30 pages." });

  const heroName = clean(body.hero?.name, 40) || "the child";
  const pronoun = ["she", "he", "they"].includes(body.hero?.pronoun) ? body.hero.pronoun : "they";
  const age = Math.min(10, Math.max(0, parseInt(body.hero?.age, 10) || 4));
  const people = (Array.isArray(body.people) ? body.people : [])
    .filter((p) => SLOTS.includes(p?.slot))
    .map((p) => ({ slot: p.slot, name: clean(p.name, 40) || "a family member", relation: clean(p.relation, 30) }));
  const allowed = new Set(["hero", "sk", ...people.map((p) => p.slot)]);

  const user = [
    `Story: "${story.title.replace("{hero}", heroName)}" — ${story.blurb.replace("{hero}", heroName)}`,
    `Setting and theme: ${story.theme} (${story.interests.join(", ")}).`,
    `Hero: ${heroName}, age ${age}. Pronouns: ${pronoun === "she" ? "she/her" : pronoun === "he" ? "he/him" : "they/them"}. Slot "hero".`,
    `Sidekick: ${story.sidekick.name}, ${story.sidekick.desc}. Slot "sk".`,
    people.length
      ? `Family members in the book:\n${people.map((p) => `- ${p.name}${p.relation ? ` (the child's ${p.relation.toLowerCase()})` : ""}, slot "${p.slot}"`).join("\n")}`
      : "No family members were added; keep the cast to the hero and the sidekick.",
    `Write exactly ${pageCount} pages. Reading age: about ${age} years.`,
  ].join("\n");

  try {
    const drafted = await writesJson({ system: CRAFT, user, maxTokens: 8000 });
    const raw = Array.isArray(drafted?.pages) ? drafted.pages : [];
    const pages = raw.map((p) => sanitizePage(p, allowed)).filter(Boolean);
    if (pages.length !== pageCount) {
      return res.status(502).json({ error: "The story writer didn't finish the story. Please try again." });
    }
    return res.status(200).json({ title: clean(drafted.title, 80) || story.title.replace("{hero}", heroName), pages });
  } catch (err) {
    console.error("Story writing failed:", err);
    return res.status(500).json({ error: "Couldn't write the story right now." });
  }
};
