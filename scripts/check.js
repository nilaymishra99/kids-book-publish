// Sanity-checks data/stories.json and data/pricing.json so a typo in a new
// story can't break the comic renderer. Run: npm run check

const { stories, ageGroups, categories } = require("../data/stories.json");
const pricing = require("../data/pricing.json");

const CAPTION_TOKENS = new Set(["hero", "c1", "family", "their", "them", "Their"]);
const SPEECH_TOKENS = new Set([...CAPTION_TOKENS, "c2", "c3", "c4", "c5"]);
const SLOTS = new Set(["hero", "c1", "c2", "c3", "c4", "c5"]);
const errors = [];
const ids = new Set();

function tokens(text) {
  return [...text.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

for (const s of stories) {
  const where = `story "${s.id}"`;
  if (ids.has(s.id)) errors.push(`${where}: duplicate id`);
  ids.add(s.id);
  if (!ageGroups.some((g) => g.id === s.ageGroup)) errors.push(`${where}: unknown ageGroup ${s.ageGroup}`);
  if (!categories.some((c) => c.id === s.category)) errors.push(`${where}: unknown category ${s.category}`);
  for (const key of ["title", "blurb", "theme", "emoji"]) if (!s[key]) errors.push(`${where}: missing ${key}`);
  if (!s.sidekick?.name || !s.sidekick?.emoji || !s.sidekick?.desc) errors.push(`${where}: sidekick needs name, emoji, desc`);
  if (!Array.isArray(s.palette) || s.palette.length !== 2) errors.push(`${where}: palette needs 2 colours`);
  if (!s.panels?.length) errors.push(`${where}: no panels`);
  s.panels.forEach((p, i) => {
    const at = `${where} panel ${i}`;
    if (!p.scene) errors.push(`${at}: missing scene`);
    if (!p.cast?.includes("hero")) errors.push(`${at}: hero must be in cast`);
    for (const c of p.cast || []) if (!SLOTS.has(c) && c !== "family") errors.push(`${at}: bad cast "${c}"`);
    for (const t of tokens(p.caption || "")) if (!CAPTION_TOKENS.has(t)) errors.push(`${at}: caption can't use {${t}}`);
    for (const line of p.speech || []) {
      if (!SLOTS.has(line.who)) errors.push(`${at}: bad speaker "${line.who}"`);
      for (const t of tokens(line.text)) if (!SPEECH_TOKENS.has(t)) errors.push(`${at}: speech can't use {${t}}`);
    }
  });
}

for (const f of pricing.formats) {
  if (!f.id || !f.name || !(f.price > 0)) errors.push(`pricing: bad format ${JSON.stringify(f)}`);
}

// Make sure every API route at least loads.
for (const route of ["config", "generate", "checkout", "order", "save-page", "stripe-webhook"]) {
  try {
    if (typeof require(`../api/${route}.js`) !== "function") errors.push(`api/${route}.js doesn't export a handler`);
  } catch (err) {
    errors.push(`api/${route}.js failed to load: ${err.message}`);
  }
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join("\n"));
  process.exit(1);
}
console.log(`✓ ${stories.length} stories, ${stories.reduce((n, s) => n + s.panels.length, 0)} panels, ${pricing.formats.length} formats — all good`);
