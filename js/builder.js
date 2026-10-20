// Illustrates a book's pages with the AI image endpoint. Shared by the
// single-book creator and the bundle wizard.

import { bookPages, resolveCast } from "./story-model.js";

const CONCURRENCY = 2;

// Fills book.ai[key] for "cover" and each story page. Returns how many failed.
export async function illustrate(book, story, onProgress = () => {}) {
  const pages = bookPages(story, book.pages);
  const keys = ["cover", ...pages.map((_, i) => i)];
  let done = 0;
  let failed = 0;
  onProgress(done, keys.length);

  const photosFor = (key) => {
    const slots = key === "cover" ? ["hero", ...book.people.map((p) => p.slot)] : resolveCast(pages[key], book);
    const photos = {};
    for (const slot of slots) {
      if (slot === "hero") photos.hero = book.heroPhoto;
      else {
        const p = book.people.find((x) => x.slot === slot);
        if (p) photos[slot] = p.photo;
      }
    }
    return photos;
  };

  const queue = [...keys];
  async function worker() {
    while (queue.length) {
      const key = queue.shift();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 120000);
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            storyId: story.id,
            panel: key,
            pageCount: book.pages,
            style: book.style,
            hero: book.hero,
            cast: book.people.map(({ slot, name, relation }) => ({ slot, name, relation })),
            photos: photosFor(key),
          }),
        });
        clearTimeout(timer);
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.image) book.ai[key] = data.image;
        else failed++;
      } catch {
        failed++;
      }
      done++;
      onProgress(done, keys.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return failed;
}
