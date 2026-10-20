// Sanity-checks data/stories.json and data/pricing.json so a typo in a new
// story can't break the book builder. Run: npm run check

const { stories, ageGroups, categories, interests } = require("../data/stories.json");
const pricing = require("../data/pricing.json");

const CAPTION_TOKENS = new Set(["hero", "family", "their", "them", "Their"]);
const SPEECH_TOKENS = new Set([...CAPTION_TOKENS, "sk", "c2", "c3", "c4", "c5", "c1"]);
const CAST = new Set(["hero", "sk", "family", "c1", "c2", "c3", "c4", "c5"]);
const WHO = new Set(["hero", "sk", "c1", "c2", "c3", "c4", "c5"]);
const errors = [];
const ids = new Set();

function tokens(text) {
  return [...text.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

function checkPage(page, at) {
  if (!page.scene) errors.push(`${at}: missing scene`);
  if (!page.caption) errors.push(`${at}: missing caption`);
  if (!Array.isArray(page.cast) || !page.cast.includes("hero")) errors.push(`${at}: hero must be in cast`);
  for (const c of page.cast || []) if (!CAST.has(c)) errors.push(`${at}: bad cast "${c}"`);
  for (const t of tokens(page.caption || "")) if (!CAPTION_TOKENS.has(t)) errors.push(`${at}: caption can't use {${t}}`);
  for (const line of page.speech || []) {
    if (!WHO.has(line.who)) errors.push(`${at}: bad speaker "${line.who}"`);
    for (const t of tokens(line.text)) if (!SPEECH_TOKENS.has(t)) errors.push(`${at}: speech can't use {${t}}`);
  }
}

for (const s of stories) {
  const where = `story "${s.id}"`;
  if (ids.has(s.id)) errors.push(`${where}: duplicate id`);
  ids.add(s.id);
  if (!ageGroups.some((g) => g.id === s.ageGroup)) errors.push(`${where}: unknown ageGroup ${s.ageGroup}`);
  if (!categories.some((c) => c.id === s.category)) errors.push(`${where}: unknown category ${s.category}`);
  for (const i of s.interests || []) if (!interests.includes(i)) errors.push(`${where}: unknown interest "${i}"`);
  if (!s.interests?.length) errors.push(`${where}: needs at least one interest`);
  for (const key of ["title", "blurb", "theme", "emoji"]) if (!s[key]) errors.push(`${where}: missing ${key}`);
  if (!s.sidekick?.name || !s.sidekick?.emoji || !s.sidekick?.desc) errors.push(`${where}: sidekick needs name, emoji, desc`);
  if (!Array.isArray(s.palette) || s.palette.length !== 2) errors.push(`${where}: palette needs 2 colours`);
  if (s.intro?.length !== 2) errors.push(`${where}: intro must be 2 pages`);
  if (s.middle?.length !== 26) errors.push(`${where}: middle must be 26 pages (so a book can reach 30)`);
  if (s.finale?.length !== 2) errors.push(`${where}: finale must be 2 pages`);
  [...(s.intro || []), ...(s.middle || []), ...(s.finale || [])].forEach((p, i) => checkPage(p, `${where} page ${i + 1}`));
}

const per = pricing.pages;
if (!(per.min === 15 && per.max === 30 && per.included === 15)) errors.push("pricing: pages must be 15 included, 15 to 30");
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
console.log(`✓ ${stories.length} stories, ${stories.reduce((n, s) => n + s.intro.length + s.middle.length + s.finale.length, 0)} pages written, ${pricing.formats.length} formats — all good`);
