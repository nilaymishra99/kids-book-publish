// Shared rules for building a book from a story: which pages it uses, who is
// drawn on each page, and what it costs. api/_lib.js mirrors these exactly —
// keep the two in step.

export const PAGE_LIMITS = { min: 15, max: 30 };

export function bookPages(story, pageCount) {
  const n = Math.min(PAGE_LIMITS.max, Math.max(PAGE_LIMITS.min, Number(pageCount) || PAGE_LIMITS.min));
  return [...story.intro, ...story.middle.slice(0, n - story.intro.length - story.finale.length), ...story.finale];
}

export function resolveCast(page, book) {
  const present = book.people.map((p) => p.slot);
  const cast = ["hero"];
  for (const slot of page.cast) {
    if (slot === "family") cast.push(...present);
    else if (slot === "sk" || slot === "hero" || present.includes(slot)) cast.push(slot);
  }
  return [...new Set(cast)];
}

export function bookPrice(pricing, formatId, pageCount) {
  const format = pricing.formats.find((f) => f.id === formatId);
  const extra = Math.max(0, Number(pageCount) - pricing.pages.included);
  return format.price + extra * pricing.pages.extraPagePrice;
}

export function bundlePrice(pricing, items) {
  const total = items.reduce((sum, it) => sum + bookPrice(pricing, it.format, it.pages), 0);
  return Math.round(total * (100 - pricing.bundle.discountPercent) / 100);
}
