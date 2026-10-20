// Bundle builder: a few questions, then three stories chosen for the child's
// age and interests, made in one go and bought together with one discount.

import { BRAND, loadData, loadConfig, formatPrice, esc, setupNav } from "./common.js";
import { renderBook } from "./comic.js";
import { illustrate } from "./builder.js";
import { bookPages, bookPrice, bundlePrice } from "./story-model.js";
import { saveBook } from "./store.js";
import { turnTo, openReader } from "./reader.js";

setupNav();
const $ = (sel) => document.querySelector(sel);
const { ageGroups, stories, interests, pricing } = await loadData();
const config = await loadConfig();
const BUNDLE_SIZE = pricing.bundle.books;
const AGE_RANGES = { "0-2": [0, 2], "3-5": [3, 5], "6-8": [6, 8], "9-10": [9, 10] };

const state = {
  step: 0,
  age: 4,
  name: "",
  pronoun: "they",
  photo: null,
  interests: new Set(),
  style: "comic",
  format: pricing.formats.find((f) => f.badge)?.id || pricing.formats[0].id,
  pages: pricing.pages.included,
  chosen: [],
  bundleId: null,
  books: [],
  pageIndex: 0,
  current: 0,
  pageImages: [],
};

const steps = [...document.querySelectorAll(".step")];
function showStep(n) {
  state.step = n;
  steps.forEach((s, i) => (s.hidden = i !== n));
  [...$("#progress").children].forEach((li, i) => {
    li.classList.toggle("active", i === n);
    li.classList.toggle("done", i < n);
  });
  window.scrollTo({ top: 0 });
  if (n === 3) showBundle();
}

// ---------- Step 1: the child ----------
$("#age").innerHTML = Array.from({ length: 11 }, (_, i) => `<option value="${i}" ${i === 4 ? "selected" : ""}>${i === 0 ? "Under 1" : `${i} year${i > 1 ? "s" : ""}`}</option>`).join("");
$("#age").addEventListener("change", (e) => (state.age = Number(e.target.value)));
$("#name").addEventListener("input", (e) => (state.name = e.target.value.trim()));
document.querySelectorAll('input[name="pronoun"]').forEach((r) =>
  r.addEventListener("change", () => (state.pronoun = document.querySelector('input[name="pronoun"]:checked').value))
);

function squarePhoto(img, size = 768) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.88);
}

$("#photo").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file || !file.type.startsWith("image/")) return;
  const img = new Image();
  img.onload = () => {
    state.photo = squarePhoto(img);
    const preview = $("#photo-preview");
    preview.src = state.photo;
    preview.hidden = false;
  };
  img.src = URL.createObjectURL(file);
});

// ---------- Step 2: interests and style ----------
$("#interest-chips").innerHTML = interests
  .map((name) => `<button type="button" class="chip" data-interest="${esc(name)}" aria-pressed="false">${esc(name)}</button>`)
  .join("");
$("#interest-chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-interest]");
  if (!b) return;
  const name = b.dataset.interest;
  if (state.interests.has(name)) state.interests.delete(name);
  else state.interests.add(name);
  b.setAttribute("aria-pressed", String(state.interests.has(name)));
});

const styleOptions = config.ai
  ? [["comic", "💥 Classic comic"], ["manga", "🌸 Cute manga"], ["watercolor", "🎨 Watercolour"], ["cartoon3d", "🧸 3D cartoon"]]
  : [["comic", "💥 Photo-comic"]];
$("#style-row").innerHTML = styleOptions
  .map(([v, label]) => `<label class="radio-tile"><input type="radio" name="style" value="${v}" ${v === state.style ? "checked" : ""}><span>${label}</span></label>`)
  .join("");
$("#style-row").addEventListener("change", (e) => (state.style = e.target.value));

// ---------- Step 3: format and length ----------
function renderFormats() {
  $("#format-row").innerHTML = pricing.formats
    .map(
      (f) => `<label class="radio-tile"><input type="radio" name="format" value="${f.id}" ${f.id === state.format ? "checked" : ""}><span>${esc(f.name)} · ${formatPrice(pricing, f.price)}</span></label>`
    )
    .join("");
}
$("#format-row").addEventListener("change", (e) => {
  state.format = e.target.value;
  updatePagesHint();
});
$("#pages").innerHTML = Array.from({ length: pricing.pages.max - pricing.pages.min + 1 }, (_, i) => {
  const n = pricing.pages.min + i;
  return `<option value="${n}" ${n === state.pages ? "selected" : ""}>${n} pages</option>`;
}).join("");
$("#pages").addEventListener("change", (e) => {
  state.pages = Number(e.target.value);
  updatePagesHint();
});
function updatePagesHint() {
  const books = state.chosen.length ? state.chosen : [{}, {}, {}];
  const perBook = state.format ? bookPrice(pricing, state.format, state.pages) : 0;
  $("#pages-hint").textContent = `Each book: ${formatPrice(pricing, perBook)} · bundle of ${BUNDLE_SIZE}: ${formatPrice(pricing, bundlePrice(pricing, books.map(() => ({ format: state.format, pages: state.pages }))))} after the ${pricing.bundle.discountPercent}% bundle discount.`;
}

// ---------- Step 4: match and show the bundle ----------
function chooseStories() {
  const group = ageGroups.find((g) => {
    const [lo, hi] = AGE_RANGES[g.id];
    return state.age >= lo && state.age <= hi;
  });
  const scored = stories.map((s) => {
    const inAge = s.ageGroup === group?.id;
    const overlap = (s.interests || []).filter((i) => state.interests.has(i)).length;
    return { story: s, score: (inAge ? 3 : 0) + overlap };
  });
  scored.sort((a, b) => b.score - a.score || a.story.id.localeCompare(b.story.id));
  return scored.slice(0, BUNDLE_SIZE).map((x) => x.story);
}

function showBundle() {
  state.chosen = chooseStories();
  $("#bundle-list").innerHTML = state.chosen
    .map((s) => {
      const [c1, c2] = s.palette;
      const matched = (s.interests || []).filter((i) => state.interests.has(i));
      return `
      <article class="card story-card" style="padding:0">
        <div class="story-cover" style="background:linear-gradient(135deg,${c1},${c2})"><span class="big" aria-hidden="true">${s.emoji}</span></div>
        <div class="story-body">
          <h3>${esc(s.title.replace("{hero}", state.name || "Your child"))}</h3>
          <p>${esc(s.blurb.replace("{hero}", state.name || "your child"))}</p>
          <span class="meta">${ageGroups.find((g) => g.id === s.ageGroup)?.ages || ""} · ${matched.length ? `matches ${esc(matched.join(", "))}` : "a great fit for this age"}</span>
        </div>
      </article>`;
    })
    .join("");
  const books = state.chosen.map(() => ({ format: state.format, pages: state.pages }));
  $("#bundle-price").textContent = `${state.chosen.length} books · ${state.pages} pages each · ${formatPrice(pricing, bundlePrice(pricing, books))} (was ${formatPrice(pricing, books.reduce((t, b) => t + bookPrice(pricing, b.format, b.pages), 0))})`;
  $("#bundle-note").textContent = config.ai
    ? "We'll illustrate all three books from your child's photo. This takes a few minutes."
    : "Each book is made in photo-comic style from your child's photo.";
  $("#make-bundle").disabled = false;
}

const validators = [
  () => {
    if (!state.name) return (alert("Please add your child's first name."), false);
    if (!state.photo) return (alert("Please add a photo of your child."), false);
    if (!$("#consent").checked) return (alert("Please tick the consent box to continue."), false);
    return true;
  },
  () => (state.interests.size ? true : (alert("Pick at least one interest."), false)),
  () => true,
];
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-next]") && validators[state.step]()) {
    if (state.step === 2) renderFormats();
    showStep(state.step + 1);
  }
  if (e.target.closest("[data-back]")) showStep(state.step - 1);
});
renderFormats();
updatePagesHint();

// ---------- Create the three books ----------
function newBook(story) {
  return {
    id: crypto.randomUUID(),
    bundleId: state.bundleId,
    storyId: story.id,
    pages: state.pages,
    hero: { name: state.name, age: state.age, pronoun: state.pronoun },
    style: config.ai ? state.style : "photo",
    dedication: "",
    heroPhoto: state.photo,
    people: [],
    ai: {},
    createdAt: Date.now(),
  };
}

$("#make-bundle").addEventListener("click", async () => {
  $("#make-bundle").disabled = true;
  state.bundleId = crypto.randomUUID();
  state.books = state.chosen.map(newBook);
  $("#bundle-generating").hidden = false;
  $("#bundle-preview").hidden = true;

  for (let i = 0; i < state.books.length; i++) {
    const book = state.books[i];
    const story = state.chosen[i];
    if (config.ai) {
      await illustrate(book, story, (done, total) => {
        $("#bundle-bar").style.width = `${Math.round(((i + done / total) / state.books.length) * 100)}%`;
        $("#bundle-status").textContent = `Book ${i + 1} of ${state.books.length}: illustrating page ${Math.min(done + 1, total)} of ${total}…`;
      });
    }
    book.pagesRendered = await renderBook(book, story, { watermark: true, brand: BRAND, quality: 0.82 });
    // Keep the preview images out of the saved copy: they can be rebuilt from the book.
    const { pagesRendered, ...stored } = book;
    await saveBook(stored).catch((err) => console.warn("Couldn't save book locally", err));
  }
  $("#bundle-generating").hidden = true;
  showBookTabs();
  $("#bundle-preview").hidden = false;
});

function showBookTabs() {
  $("#book-tabs").innerHTML = state.books
    .map((b, i) => `<button type="button" class="chip" role="tab" data-book="${i}" aria-pressed="${i === 0}">${esc(state.chosen[i].title.replace("{hero}", state.name))}</button>`)
    .join("");
  selectBook(0);
}

function selectBook(i) {
  state.current = i;
  state.pageIndex = 0;
  for (const b of $("#book-tabs").children) b.setAttribute("aria-pressed", String(Number(b.dataset.book) === i));
  showPage(0);
}

function showPage(n) {
  const pages = state.books[state.current].pagesRendered;
  state.pageIndex = Math.max(0, Math.min(pages.length - 1, n));
  turnTo($("#viewer-img"), pages[state.pageIndex]);
  $("#page-count").textContent = `Page ${state.pageIndex + 1} / ${pages.length}`;
}

$("#book-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-book]");
  if (b) selectBook(Number(b.dataset.book));
});
$("#prev-page").addEventListener("click", () => showPage(state.pageIndex - 1));
$("#watch").addEventListener("click", () => {
  const book = state.books[state.current];
  openReader(book.pagesRendered, state.chosen[state.current].title.replace("{hero}", state.name));
});
$("#next-page").addEventListener("click", () => showPage(state.pageIndex + 1));

// ---------- Checkout the bundle ----------
$("#checkout-bundle").addEventListener("click", async () => {
  const btn = $("#checkout-bundle");
  const err = $("#err4");
  err.hidden = true;
  if (config.checkout === "off") {
    err.textContent = "Ordering opens very soon! Your bundle is saved in this browser, so come back to this page to order it.";
    err.hidden = false;
    return;
  }
  btn.disabled = true;
  btn.textContent = "Opening checkout…";
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundleId: state.bundleId,
        format: state.format,
        heroName: state.name,
        books: state.books.map((b) => ({ bookId: b.id, storyId: b.storyId, pages: b.pages })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || "Couldn't start checkout. Please try again.");
    location.href = data.url;
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = "Checkout bundle 🔒";
  }
});

showStep(0);
