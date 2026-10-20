// Comic book renderer. Every page is drawn on a <canvas> so the exact same
// pixels are used for the on-screen preview, the PDF download and the files
// sent to the printer.
//
// Each panel is either an AI illustration (book.ai[index]) or, when AI is off
// or failed, a "photo-comic" panel: a themed backdrop with the family's
// photos turned into comic-style portraits. Captions and speech bubbles are
// always drawn here (never by the image model), so the text is crisp and
// spelled correctly.

import { bookPages, resolveCast } from "./story-model.js";

const PAGE = 1600; // px — 8in square at 200dpi
const MARGIN = 56;
const GUTTER = 28;
const FOOTER = 64;
const INK = "#1b1b2f";
const DISPLAY = "Bangers, Impact, sans-serif";
const BODY = "Nunito, system-ui, sans-serif";

const TEXT_SIZE = { "0-2": 60, "3-5": 46, "6-8": 38, "9-10": 34 };


// ---------- Story text & cast ----------

function presentSlots(book) {
  return book.people.map((p) => p.slot);
}

export { resolveCast };

function listNames(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function fillText(text, book, story) {
  const pron = { she: ["her", "her", "Her"], he: ["his", "him", "His"] }[book.hero.pronoun] || ["their", "them", "Their"];
  const people = Object.fromEntries(book.people.map((p) => [p.slot, p.name]));
  const familyNames = book.people.map((p) => p.name);
  return text
    .replace(/\{hero\}/g, book.hero.name)
    .replace(/\{family\}/g, listNames(familyNames.length ? familyNames : [story.sidekick.name]))
    .replace(/\{c1\}/g, people.c1 || story.sidekick.name)
    .replace(/\{(c[2-5])\}/g, (_, slot) => people[slot] || story.sidekick.name)
    .replace(/\{their\}/g, pron[0])
    .replace(/\{them\}/g, pron[1])
    .replace(/\{Their\}/g, pron[2]);
}

function speechFor(panel, book) {
  const present = presentSlots(book);
  return panel.speech.filter((s) => s.who === "hero" || s.who === "sk" || present.includes(s.who));
}

// ---------- Image helpers ----------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Posterise + boost saturation so real photos sit better in a comic.
function comicify(img) {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  drawCover(ctx, img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size);
  const px = data.data;
  const step = 255 / 6;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const grey = 0.3 * r + 0.59 * g + 0.11 * b;
    for (let k = 0; k < 3; k++) {
      let v = grey + (px[i + k] - grey) * 1.35; // saturation
      v = (v - 128) * 1.12 + 128; // contrast
      px[i + k] = Math.round(Math.max(0, Math.min(255, v)) / step) * step;
    }
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

async function prepareAssets(book) {
  const portraits = {};
  if (book.heroPhoto) portraits.hero = comicify(await loadImage(book.heroPhoto));
  for (const p of book.people) {
    if (p.photo) portraits[p.slot] = comicify(await loadImage(p.photo));
  }
  const ai = {};
  for (const [key, src] of Object.entries(book.ai || {})) {
    if (src) ai[key] = await loadImage(src);
  }
  return { portraits, ai };
}

function personFor(slot, book, story, assets) {
  if (slot === "hero") return { name: book.hero.name, photo: assets.portraits.hero };
  if (slot === "sk") return { name: story.sidekick.name, emoji: story.sidekick.emoji };
  const p = book.people.find((x) => x.slot === slot);
  if (p) return { name: p.name, photo: assets.portraits[slot] };
  return { name: story.sidekick.name, emoji: story.sidekick.emoji };
}

// ---------- Drawing primitives ----------

function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function halftone(ctx, x, y, w, h, spacing, radius, color) {
  ctx.save();
  ctx.fillStyle = color;
  for (let row = 0, yy = y; yy < y + h + spacing; yy += spacing, row++) {
    for (let xx = x + (row % 2 ? spacing / 2 : 0); xx < x + w + spacing; xx += spacing) {
      ctx.beginPath();
      ctx.arc(xx, yy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function seeded(n) {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function portrait(ctx, person, cx, cy, r, { tag = true } = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.clip();
  if (person.photo) {
    ctx.drawImage(person.photo, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = "#fff6d6";
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.font = `${Math.round(r * 1.2)}px ${BODY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(person.emoji || "⭐", cx, cy + r * 0.06);
  }
  ctx.restore();
  ctx.lineWidth = Math.max(6, r * 0.07);
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  if (!tag) return;
  const size = Math.max(26, Math.min(44, r * 0.32));
  ctx.font = `${size}px ${DISPLAY}`;
  const w = ctx.measureText(person.name).width + size;
  const h = size * 1.35;
  const tx = cx - w / 2;
  const ty = cy + r - h * 0.35;
  ctx.fillStyle = "#ffd23f";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(tx, ty, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(person.name, cx, ty + h / 2 + 2);
}

function captionBox(ctx, text, x, y, maxW, size) {
  ctx.font = `800 ${size}px ${BODY}`;
  const lines = wrap(ctx, text, maxW - size);
  const lh = size * 1.22;
  const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + size);
  const h = lines.length * lh + size * 0.6;
  ctx.fillStyle = "#ffe66d";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, x + size / 2, y + size * 0.3 + i * lh));
  return h;
}

function measureBubble(ctx, text, maxW, size) {
  ctx.font = `800 ${size}px ${BODY}`;
  const lines = wrap(ctx, text, maxW - size * 1.4);
  const lh = size * 1.2;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 1.4;
  const h = lines.length * lh + size * 0.9;
  return { lines, lh, w, h };
}

// Bubble + tail are stroked first and filled second so the tail joins the
// bubble without a visible seam.
function speechBubble(ctx, m, x, y, size, tailTo) {
  const r = Math.min(m.h / 2, size * 1.1);
  const baseX = Math.max(x + r, Math.min(x + m.w - r, tailTo.x));
  const tipLen = Math.min(70, Math.max(30, tailTo.y - (y + m.h)));
  const tipX = baseX + Math.max(-60, Math.min(60, (tailTo.x - baseX) * 0.5));
  const shape = () => {
    ctx.beginPath();
    ctx.roundRect(x, y, m.w, m.h, r);
    ctx.moveTo(baseX - size * 0.5, y + m.h - 2);
    ctx.lineTo(tipX, y + m.h + tipLen);
    ctx.lineTo(baseX + size * 0.5, y + m.h - 2);
    ctx.closePath();
  };
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 10;
  shape();
  ctx.stroke();
  ctx.fillStyle = "#fff";
  shape();
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  m.lines.forEach((l, i) => ctx.fillText(l, x + m.w / 2, y + size * 0.45 + i * m.lh));
}

function watermark(ctx, brand) {
  ctx.save();
  ctx.translate(PAGE / 2, PAGE / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.font = `120px ${DISPLAY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.strokeStyle = "rgba(27,27,47,0.25)";
  ctx.lineWidth = 4;
  for (let row = -3; row <= 3; row++) {
    const text = `PREVIEW · ${brand.toUpperCase()} · PREVIEW`;
    ctx.fillText(text, 0, row * 300);
    ctx.strokeText(text, 0, row * 300);
  }
  ctx.restore();
}

function pageFooter(ctx, n, brand) {
  ctx.fillStyle = "#6b6b85";
  ctx.font = `700 26px ${BODY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`— ${n} —`, PAGE / 2, PAGE - FOOTER / 2 - 8);
  ctx.textAlign = "right";
  ctx.font = `24px ${DISPLAY}`;
  ctx.fillText(brand, PAGE - MARGIN, PAGE - FOOTER / 2 - 8);
}

// ---------- Panels & pages ----------

// Every story page is one full-page illustration with its own caption and speech.
function pageRect() {
  return { x: MARGIN, y: MARGIN, w: PAGE - MARGIN * 2, h: PAGE - MARGIN * 2 - FOOTER };
}

function drawPanel(ctx, rect, panel, index, book, story, assets) {
  const { x, y, w, h } = rect;
  const size = Math.round(TEXT_SIZE[story.ageGroup] * Math.max(0.8, Math.min(1, w / 1200)));
  const cast = resolveCast(panel, book);
  const ai = assets.ai[index];
  const speakers = {};

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  if (ai) {
    drawCover(ctx, ai, x, y, w, h);
  } else {
    const [top, bottom] = [story.palette[index % 2], story.palette[(index + 1) % 2]];
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    halftone(ctx, x, y, w, h, 24, 4, "rgba(255,255,255,0.16)");

    // Scenery props scattered across the upper half.
    const props = panel.props || [];
    const propSize = Math.min(w, h) * (props.length > 2 ? 0.2 : 0.24);
    ctx.font = `${Math.round(propSize)}px ${BODY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    props.forEach((p, i) => {
      const px = x + w * (0.12 + 0.76 * ((i + 0.5) / props.length)) + (seeded(index * 7 + i) - 0.5) * w * 0.08;
      const py = y + h * (0.36 + seeded(index * 13 + i) * 0.14);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate((seeded(index * 3 + i) - 0.5) * 0.5);
      ctx.globalAlpha = 0.95;
      ctx.fillText(p, 0, 0);
      ctx.restore();
    });

    // Ground strip + characters along the bottom.
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h, w * 0.62, h * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    const n = cast.length;
    // Each character gets an equal slice of the panel width; the hero is a
    // little bigger, so size everyone to leave room for that.
    const base = Math.min(h * 0.2, w / n / 2.5);
    cast.forEach((slot, i) => {
      const r = slot === "hero" ? base * 1.12 : base;
      const cx = x + (w * (i + 0.5)) / n;
      const cy = y + h - r - size * 0.9;
      portrait(ctx, personFor(slot, book, story, assets), cx, cy, r);
      speakers[slot] = { x: cx, y: cy - r };
    });
  }

  // Caption + speech bubbles go on top of either kind of panel.
  let cursor = y + 18;
  if (panel.caption) cursor += captionBox(ctx, fillText(panel.caption, book, story), x + 18, y + 18, w * 0.78, size) + 18;

  const placed = [];
  speechFor(panel, book).forEach((s, i) => {
    const m = measureBubble(ctx, fillText(s.text, book, story), w * 0.46, size);
    const target = speakers[s.who] || { x: i % 2 ? x + w * 0.3 : x + w * 0.7, y: y + h };
    let bx = Math.max(x + 18, Math.min(x + w - m.w - 18, target.x - m.w / 2));
    if (!speakers[s.who]) bx = i % 2 ? x + 24 : x + w - m.w - 24;
    let by = cursor + 10;
    for (const p of placed) {
      if (bx < p.x + p.w + 12 && bx + m.w + 12 > p.x && by < p.y + p.h + 40) by = p.y + p.h + 40;
    }
    speechBubble(ctx, m, bx, by, size, target);
    placed.push({ x: bx, y: by, w: m.w, h: m.h });
  });

  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 9;
  ctx.strokeRect(x, y, w, h);
}

function newPage() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PAGE;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffdf7";
  ctx.fillRect(0, 0, PAGE, PAGE);
  return { canvas, ctx };
}

function fitTitle(ctx, text, maxW, start, maxLines) {
  for (let size = start; size > 50; size -= 6) {
    ctx.font = `${size}px ${DISPLAY}`;
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines) return { size, lines };
  }
  ctx.font = `50px ${DISPLAY}`;
  return { size: 50, lines: wrap(ctx, text, maxW) };
}

function outlinedText(ctx, text, x, y, size, fill = "#fff") {
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.14;
  ctx.strokeStyle = INK;
  ctx.fillStyle = "#ffd23f";
  ctx.fillText(text, x + size * 0.05, y + size * 0.06);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawCoverPage(ctx, book, story, assets, brand) {
  if (assets.ai.cover) {
    drawCover(ctx, assets.ai.cover, 0, 0, PAGE, PAGE);
    return;
  }
  const [c1, c2] = story.palette;
  const grad = ctx.createLinearGradient(0, 0, PAGE, PAGE);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, PAGE, PAGE);
  halftone(ctx, 0, 0, PAGE, PAGE, 34, 7, "rgba(255,255,255,0.14)");

  const title = book.title || fillText(story.title, book, story);
  const { size, lines } = fitTitle(ctx, title, PAGE - 180, 170, 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => outlinedText(ctx, l, PAGE / 2, 70 + i * size * 1.02, size));
  const titleBottom = 70 + lines.length * size * 1.02;

  if (assets.ai.cover) {
    const w = 1380;
    const h = w / 1.5;
    const x = (PAGE - w) / 2;
    const y = Math.max(titleBottom + 30, 360);
    ctx.save();
    ctx.translate(PAGE / 2, y + h / 2);
    ctx.rotate(-0.015);
    ctx.fillStyle = INK;
    ctx.fillRect(-w / 2 + 16, -h / 2 + 16, w, h);
    drawCover(ctx, assets.ai.cover, -w / 2, -h / 2, w, h);
    ctx.lineWidth = 12;
    ctx.strokeStyle = INK;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  } else {
    // Starburst behind the hero.
    ctx.save();
    ctx.translate(PAGE / 2, 860);
    ctx.fillStyle = "#ffd23f";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 10;
    ctx.beginPath();
    for (let i = 0; i < 32; i++) {
      const r = i % 2 ? 380 : 480;
      const a = (i / 32) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    portrait(ctx, personFor("hero", book, story, assets), PAGE / 2, 860, 310, { tag: false });
    ctx.font = `220px ${BODY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(story.emoji, PAGE / 2 + 330, 600);
    const others = [...book.people.map((p) => p.slot)];
    if (!others.length) others.push("c1");
    others.forEach((slot, i) => {
      const side = i % 2 ? 1 : -1;
      const row = Math.floor(i / 2);
      portrait(ctx, personFor(slot, book, story, assets), PAGE / 2 + side * (520 + row * 40), 760 + row * 260, 110);
    });
  }

  // "Starring" ribbon.
  const ribbon = `Starring ${book.hero.name}!`;
  ctx.font = `96px ${DISPLAY}`;
  const rw = ctx.measureText(ribbon).width + 140;
  ctx.save();
  ctx.translate(PAGE / 2, 1380);
  ctx.rotate(-0.03);
  ctx.fillStyle = "#ff4d6d";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 10;
  ctx.fillRect(-rw / 2, -70, rw, 140);
  ctx.strokeRect(-rw / 2, -70, rw, 140);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  outlinedText(ctx, ribbon, 0, 4, 96);
  ctx.restore();

  ctx.font = `44px ${DISPLAY}`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`A ${brand} comic`, PAGE / 2, PAGE - 70);
}

function drawDedicationPage(ctx, book, story, brand) {
  halftone(ctx, 0, 0, PAGE, PAGE, 40, 5, "rgba(255,77,109,0.10)");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `150px ${BODY}`;
  ctx.fillText("💌", PAGE / 2, 360);
  ctx.font = `110px ${DISPLAY}`;
  ctx.fillStyle = INK;
  ctx.fillText(`For ${book.hero.name}`, PAGE / 2, 560);
  ctx.font = `600 54px ${BODY}`;
  const lines = wrap(ctx, book.dedication, PAGE - 360);
  lines.slice(0, 8).forEach((l, i) => ctx.fillText(l, PAGE / 2, 720 + i * 74));
  pageFooter(ctx, "♥", brand);
}

function drawEndPage(ctx, book, story, assets, brand) {
  const [c1, c2] = story.palette;
  const grad = ctx.createLinearGradient(0, 0, 0, PAGE);
  grad.addColorStop(0, c2);
  grad.addColorStop(1, c1);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, PAGE, PAGE);
  halftone(ctx, 0, 0, PAGE, PAGE, 34, 7, "rgba(255,255,255,0.14)");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `220px ${DISPLAY}`;
  outlinedText(ctx, "THE END!", PAGE / 2, 340, 220);

  const slots = ["hero", ...book.people.map((p) => p.slot)];
  if (slots.length === 1) slots.push("c1");
  const r = slots.length > 4 ? 120 : 150;
  const spacing = Math.min(r * 2 + 40, (PAGE - 160) / slots.length);
  const start = PAGE / 2 - (spacing * (slots.length - 1)) / 2;
  slots.forEach((slot, i) => portrait(ctx, personFor(slot, book, story, assets), start + i * spacing, 820, r));

  ctx.font = `800 52px ${BODY}`;
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 8;
  const thanks = `Thanks for reading, ${book.hero.name}!`;
  ctx.strokeText(thanks, PAGE / 2, 1150);
  ctx.fillText(thanks, PAGE / 2, 1150);
  ctx.font = `48px ${DISPLAY}`;
  ctx.fillText(`Made with love by ${brand}`, PAGE / 2, PAGE - 90);
}

// Keys to illustrate with AI, in reading order: the cover, then each story page.
export function aiPanelKeys(story, pageCount) {
  return ["cover", ...bookPages(story, pageCount).map((_, i) => i)];
}

/**
 * Render a whole book.
 * @returns {Promise<string[]>} one JPEG data URL per page
 */
export async function renderBook(book, story, { watermark: wm = false, brand = "Little Legends", quality = 0.9 } = {}) {
  await Promise.all([document.fonts.load(`80px Bangers`), document.fonts.load(`800 40px Nunito`)]).catch(() => {});
  const assets = await prepareAssets(book);
  const pages = [];
  const finish = ({ canvas, ctx }) => {
    if (wm) watermark(ctx, brand);
    pages.push(canvas.toDataURL("image/jpeg", quality));
  };

  let page = newPage();
  drawCoverPage(page.ctx, book, story, assets, brand);
  finish(page);

  if (book.dedication) {
    page = newPage();
    drawDedicationPage(page.ctx, book, story, brand);
    pages.push(page.canvas.toDataURL("image/jpeg", quality)); // no watermark: nothing to protect
  }

  (book.storyPages || bookPages(story, book.pages)).forEach((panel, i) => {
    page = newPage();
    if (assets.ai[i]) {
      drawCover(page.ctx, assets.ai[i], 0, 0, PAGE, PAGE);
    } else {
      drawPanel(page.ctx, pageRect(), panel, i, book, story, assets);
      pageFooter(page.ctx, i + 1, brand);
    }
    finish(page);
  });

  page = newPage();
  drawEndPage(page.ctx, book, story, assets, brand);
  finish(page);
  return pages;
}
