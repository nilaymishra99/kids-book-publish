// Draws a book with AI: a sidekick sheet, a cartoon character sheet for the
// child and each family member (from their photo), then every comic page
// drawn with those characters as references. Shared by the single-book
// creator and the bundle wizard.

import { bookPages, resolveCast } from "./story-model.js";

const CONCURRENCY = 2;

async function post(body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180000);
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.image ? data.image : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Fills book.characters (cartoon sheets) and book.ai (full pages).
// Returns the number of pages that could not be drawn.
export async function illustrate(book, story, onProgress = () => {}) {
  book.characters = book.characters || {};
  book.ai = book.ai || {};
  const pages = bookPages(story, book.pages);
  const pageKeys = ["cover", ...pages.map((_, i) => i)];
  const people = book.people.map(({ slot, name, relation }) => ({ slot, name, relation }));
  const total = 1 + 1 + book.people.length + pageKeys.length;
  let done = 0;
  const tick = () => onProgress(++done, total);
  onProgress(0, total);

  // 1. Sidekick sheet (no photo needed).
  book.characters.sk = await post({ mode: "sidekick", storyId: story.id });
  tick();

  // 2. Cartoon sheet for the child, and for each family member, from their photo.
  const sources = [{ slot: "hero", name: book.hero.name, photo: book.heroPhoto }, ...book.people.map((p) => ({ slot: p.slot, name: p.name, relation: p.relation, photo: p.photo }))];
  for (const src of sources) {
    book.characters[src.slot] = await post({
      mode: "character",
      slot: src.slot,
      storyId: story.id,
      name: src.name,
      relation: src.relation || "",
      hero: book.hero,
      cast: people,
      photo: src.photo,
    });
    tick();
  }

  // 3. Full comic pages, each drawn with the characters that appear on it.
  const sheetsFor = (key) => {
    const slots = key === "cover" ? ["hero", "sk", ...book.people.map((p) => p.slot)] : resolveCast(pages[key], book);
    const characters = {};
    for (const slot of slots) if (book.characters[slot]) characters[slot] = book.characters[slot];
    return characters;
  };
  const queue = [...pageKeys];
  async function worker() {
    while (queue.length) {
      const key = queue.shift();
      const image = await post({
        mode: "page",
        storyId: story.id,
        panel: key,
        pageCount: book.pages,
        hero: book.hero,
        cast: people,
        characters: sheetsFor(key),
      });
      if (image) book.ai[key] = image;
      tick();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return pageKeys.filter((k) => !book.ai[k]).length;
}
