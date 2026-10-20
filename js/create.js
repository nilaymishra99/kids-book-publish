// The five-step "create your comic" wizard.

import { BRAND, loadData, loadConfig, storyCardHtml, formatPrice, esc } from "./common.js";
import { renderBook, aiPanelKeys, resolveCast } from "./comic.js";
import { saveBook, getBook } from "./store.js";

const MAX_PEOPLE = 5;
const RELATIONS = ["Mum", "Dad", "Brother", "Sister", "Grandma", "Grandpa", "Nani", "Nana", "Dadi", "Dada", "Aunt", "Uncle", "Cousin", "Friend", "Pet"];
const AI_CONCURRENCY = 2;

const [{ ageGroups, stories, pricing }, config] = await Promise.all([loadData(), loadConfig()]);
const params = new URLSearchParams(location.search);

const state = {
  step: 0,
  storyId: stories.some((s) => s.id === params.get("story")) ? params.get("story") : null,
  pickAge: "all",
  people: [], // { key, name, relation, cropper }
  book: null,
  aiKey: null,
  pages: [],
  pageIndex: 0,
  format: pricing.formats.find((f) => f.badge)?.id || pricing.formats[0].id,
};

const $ = (sel) => document.querySelector(sel);
const steps = [...document.querySelectorAll(".step")];

// ---------- Navigation ----------

function showStep(n) {
  state.step = n;
  steps.forEach((s, i) => (s.hidden = i !== n));
  [...$("#progress").children].forEach((li, i) => {
    li.classList.toggle("active", i === n);
    li.classList.toggle("done", i < n);
    if (i === n) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0 });
  steps[n].querySelector("h1")?.focus?.();
  if (n === 3) buildPreview();
  if (n === 4) renderFormats();
}

const validators = [validateStory, validateHero, validatePhotos, () => state.pages.length > 0];

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-next]") && validators[state.step]()) showStep(state.step + 1);
  if (e.target.closest("[data-back]")) showStep(state.step - 1);
});

// ---------- Step 1: story ----------

function renderPicker() {
  $("#pick-filters").innerHTML = [`<button class="chip" data-age="all">All ages</button>`]
    .concat(ageGroups.map((g) => `<button class="chip" data-age="${g.id}">${g.emoji} ${esc(g.name)} · ${esc(g.ages)}</button>`))
    .join("");
  for (const b of $("#pick-filters").children) b.setAttribute("aria-pressed", String(b.dataset.age === state.pickAge));
  const list = stories.filter((s) => state.pickAge === "all" || s.ageGroup === state.pickAge);
  $("#pick-grid").innerHTML = list.map((s) => storyCardHtml(s, ageGroups, { tag: "button", name: heroName() })).join("");
  for (const b of $("#pick-grid").querySelectorAll("[data-story]")) b.setAttribute("aria-pressed", String(b.dataset.story === state.storyId));
}

$("#pick-filters").addEventListener("click", (e) => {
  const b = e.target.closest("[data-age]");
  if (!b) return;
  state.pickAge = b.dataset.age;
  renderPicker();
});
$("#pick-grid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-story]");
  if (!b) return;
  state.storyId = b.dataset.story;
  renderPicker();
  const story = currentStory();
  // Nudge the age dropdown to the story's range the first time.
  if (!$("#hero-age").dataset.touched) $("#hero-age").value = story.ageGroup.split("-")[0] === "0" ? "1" : story.ageGroup.split("-")[0];
});

function validateStory() {
  if (state.storyId) return true;
  alert("Pick a story first!");
  return false;
}

const currentStory = () => stories.find((s) => s.id === state.storyId);

// ---------- Step 2: hero ----------

$("#hero-age").innerHTML = Array.from({ length: 11 }, (_, i) => `<option value="${i}">${i === 0 ? "Under 1" : `${i} year${i > 1 ? "s" : ""}`}</option>`).join("");
$("#hero-age").value = "4";
$("#hero-age").addEventListener("change", (e) => (e.target.dataset.touched = "1"));
if (!config.ai) {
  $("#style-field").hidden = true;
  $("#photo-mode-note").hidden = false;
}

const heroName = () => $("#hero-name").value.trim();
const radio = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;

function validateHero() {
  const input = $("#hero-name");
  if (!heroName()) {
    input.setAttribute("aria-invalid", "true");
    input.focus();
    alert("Please enter your child's first name.");
    return false;
  }
  input.removeAttribute("aria-invalid");
  return true;
}

// ---------- Step 3: photos ----------

class Cropper {
  constructor(el, onChange) {
    this.el = el;
    this.onChange = onChange;
    this.size = 480;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = this.size;
    this.img = null;
    this.zoom = 1;
    this.ox = 0;
    this.oy = 0;
    el.addEventListener("pointerdown", (e) => {
      if (!this.img) return;
      el.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const k = this.size / el.clientWidth;
      this.ox += (e.clientX - this.drag.x) * k;
      this.oy += (e.clientY - this.drag.y) * k;
      this.drag = { x: e.clientX, y: e.clientY };
      this.draw();
    });
    const end = () => {
      if (this.drag) this.onChange?.();
      this.drag = null;
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  setImage(img) {
    this.img = img;
    this.zoom = 1;
    this.ox = this.oy = 0;
    this.el.innerHTML = "";
    this.el.append(this.canvas);
    this.el.classList.add("has-photo");
    this.draw();
  }

  setZoom(z) {
    this.zoom = z;
    this.draw();
  }

  geometry(size) {
    const iw = this.img.naturalWidth;
    const ih = this.img.naturalHeight;
    const scale = Math.max(size / iw, size / ih) * this.zoom;
    const dw = iw * scale;
    const dh = ih * scale;
    const k = size / this.size;
    const maxX = (dw - size) / 2;
    const maxY = (dh - size) / 2;
    this.ox = Math.max(-maxX / k, Math.min(maxX / k, this.ox));
    this.oy = Math.max(-maxY / k, Math.min(maxY / k, this.oy));
    return { dx: (size - dw) / 2 + this.ox * k, dy: (size - dh) / 2 + this.oy * k, dw, dh };
  }

  draw() {
    const ctx = this.canvas.getContext("2d");
    const { dx, dy, dw, dh } = this.geometry(this.size);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, this.size, this.size);
    ctx.drawImage(this.img, dx, dy, dw, dh);
  }

  export(size = 768) {
    if (!this.img) return null;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const { dx, dy, dw, dh } = this.geometry(size);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(this.img, dx, dy, dw, dh);
    return c.toDataURL("image/jpeg", 0.88);
  }
}

function loadFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("That file isn't a photo."));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("We couldn't read that photo. Try a JPG or PNG."));
    img.src = url;
  });
}

let personSeq = 0;
function addPersonSlot({ hero = false, name = "", relation = "" } = {}) {
  const key = hero ? "hero" : `p${++personSeq}`;
  const el = document.createElement("div");
  el.className = `person ${hero ? "hero-slot" : ""}`;
  el.dataset.key = key;
  const id = `ph-${key}`;
  el.innerHTML = `
    ${hero ? "" : `<button type="button" class="remove" aria-label="Remove this person">✕</button>`}
    <h3>${hero ? `⭐ <span class="js-hero-label">${esc(heroName() || "Your hero")}</span>` : "Family member"}</h3>
    <div class="cropper"><div class="placeholder"><span class="emoji" aria-hidden="true">${hero ? "🧒" : "🙂"}</span>Add a photo</div></div>
    <div class="photo-actions">
      <label class="btn btn-sm btn-white file-btn">📷 ${hero ? "Choose photo" : "Photo"}<input type="file" accept="image/*" id="${id}" aria-label="Choose photo"></label>
      <label class="visually-hidden" for="${id}-zoom">Zoom</label>
      <input type="range" id="${id}-zoom" min="1" max="3" step="0.01" value="1" disabled>
    </div>
    ${
      hero
        ? ""
        : `<div class="field"><label for="${id}-rel">Who is this?</label>
             <select id="${id}-rel" class="js-rel"><option value="">Choose…</option>${RELATIONS.map((r) => `<option ${r === relation ? "selected" : ""}>${r}</option>`).join("")}</select></div>
           <div class="field" style="margin-bottom:0"><label for="${id}-name">Name in the story</label>
             <input type="text" id="${id}-name" class="js-name" maxlength="20" placeholder="e.g. Mumma, Dadu, Riya" value="${esc(name)}"></div>`
    }`;
  $("#people").append(el);

  const person = { key, hero, cropper: new Cropper(el.querySelector(".cropper"), () => {}), el };
  const zoom = el.querySelector('input[type="range"]');
  el.querySelector('input[type="file"]').addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      person.cropper.setImage(await loadFile(file));
      zoom.disabled = false;
      zoom.value = "1";
      $("#photo-error").hidden = true;
    } catch (err) {
      showPhotoError(err.message);
    }
  });
  zoom.addEventListener("input", () => person.cropper.setZoom(Number(zoom.value)));
  el.querySelector(".remove")?.addEventListener("click", () => {
    el.remove();
    state.people = state.people.filter((p) => p !== person);
    updateSlotsLeft();
  });
  const rel = el.querySelector(".js-rel");
  const nameInput = el.querySelector(".js-name");
  rel?.addEventListener("change", () => {
    if (!nameInput.value.trim() || RELATIONS.includes(nameInput.value.trim())) nameInput.value = rel.value;
  });
  state.people.push(person);
  updateSlotsLeft();
  return person;
}

function updateSlotsLeft() {
  const left = MAX_PEOPLE - state.people.filter((p) => !p.hero).length;
  $("#slots-left").textContent = `(${left} left)`;
  $("#add-person").disabled = left <= 0;
}

$("#add-person").addEventListener("click", () => addPersonSlot());
$("#hero-name").addEventListener("input", () => {
  const label = document.querySelector(".js-hero-label");
  if (label) label.textContent = heroName() || "Your hero";
});

function showPhotoError(msg) {
  const box = $("#photo-error");
  box.textContent = msg;
  box.hidden = false;
}

function validatePhotos() {
  const heroSlot = state.people.find((p) => p.hero);
  if (!heroSlot.cropper.img) return showPhotoError(`Please add a photo of ${heroName()}.`), false;
  for (const p of state.people.filter((x) => !x.hero)) {
    const name = p.el.querySelector(".js-name").value.trim();
    if (!p.cropper.img || !name) {
      return showPhotoError("Each family member needs a photo and a name — or remove the empty card with ✕."), false;
    }
  }
  if (!$("#consent").checked) return showPhotoError("Please tick the box to confirm you're happy for these photos to be used."), false;
  $("#photo-error").hidden = true;
  return true;
}

// ---------- Step 4: preview ----------

function collectBook() {
  const story = currentStory();
  const companions = state.people.filter((p) => !p.hero);
  return {
    id: state.book?.id || crypto.randomUUID(),
    createdAt: Date.now(),
    storyId: story.id,
    hero: { name: heroName(), age: Number($("#hero-age").value), pronoun: radio("pronoun") },
    style: config.ai ? radio("style") : "photo",
    dedication: $("#dedication").value.trim(),
    heroPhoto: state.people.find((p) => p.hero).cropper.export(),
    people: companions.map((p, i) => ({
      slot: `c${i + 1}`,
      name: p.el.querySelector(".js-name").value.trim(),
      relation: p.el.querySelector(".js-rel").value,
      photo: p.cropper.export(),
    })),
    ai: {},
  };
}

// Only things that change the pictures — renaming the hero or editing the
// dedication re-renders text without paying for new illustrations.
function illustrationKey(book) {
  return JSON.stringify([book.storyId, book.style, book.hero.age, book.hero.pronoun, book.heroPhoto, book.people.map((p) => [p.relation, p.photo])]);
}

async function illustrate(book, story) {
  const keys = aiPanelKeys(story);
  let done = 0;
  let failed = 0;
  const status = $("#gen-status");
  const bar = $("#gen-bar");
  const tick = () => {
    bar.style.width = `${Math.round((done / keys.length) * 100)}%`;
    status.textContent = done < keys.length ? `Illustrating page ${done + 1} of ${keys.length}…` : "Putting the pages together…";
  };
  tick();

  const photosFor = (key) => {
    const slots = key === "cover" ? ["hero", ...book.people.map((p) => p.slot)] : resolveCast(story.panels[key], book);
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
      tick();
    }
  }
  await Promise.all(Array.from({ length: AI_CONCURRENCY }, worker));
  return failed;
}

async function buildPreview() {
  const story = currentStory();
  const fresh = collectBook();
  $("#to-order").disabled = true;
  $("#viewer").hidden = true;
  $("#gen-note").hidden = true;
  $("#generating").hidden = false;
  $("#gen-status").textContent = "Warming up the crayons…";
  $("#gen-bar").style.width = "0%";

  const key = illustrationKey(fresh);
  if (state.book && state.aiKey === key) fresh.ai = state.book.ai;
  else if (config.ai) {
    const failed = await illustrate(fresh, story);
    if (failed) {
      const note = $("#gen-note");
      note.textContent = `${failed} illustration${failed > 1 ? "s" : ""} couldn't be drawn, so ${failed > 1 ? "those pages use" : "that page uses"} photo-comic style instead. Go back and press "Create my preview" again to retry.`;
      note.hidden = false;
    }
  }
  state.book = fresh;
  state.aiKey = key;

  state.pages = await renderBook(fresh, story, { watermark: true, brand: BRAND, quality: 0.82 });
  try {
    await saveBook(fresh);
    localStorage.setItem("ll:lastBook", fresh.id);
  } catch (err) {
    console.warn("Couldn't save book locally", err);
  }
  $("#generating").hidden = true;
  showViewer();
  $("#to-order").disabled = false;
}

function showViewer() {
  $("#viewer").hidden = false;
  $("#thumbs").innerHTML = state.pages
    .map((src, i) => `<button type="button" data-page="${i}" aria-label="Page ${i + 1}"><img src="${src}" alt=""></button>`)
    .join("");
  goToPage(0);
}

function goToPage(i) {
  state.pageIndex = Math.max(0, Math.min(state.pages.length - 1, i));
  const img = $("#viewer-img");
  img.src = state.pages[state.pageIndex];
  img.alt = `Preview page ${state.pageIndex + 1} of ${state.pages.length}`;
  $("#page-count").textContent = `Page ${state.pageIndex + 1} / ${state.pages.length}`;
  for (const b of $("#thumbs").children) b.setAttribute("aria-current", String(Number(b.dataset.page) === state.pageIndex));
}

$("#prev-page").addEventListener("click", () => goToPage(state.pageIndex - 1));
$("#next-page").addEventListener("click", () => goToPage(state.pageIndex + 1));
$("#thumbs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-page]");
  if (b) goToPage(Number(b.dataset.page));
});
document.addEventListener("keydown", (e) => {
  if (state.step !== 3 || e.target.closest("input, textarea, select")) return;
  if (e.key === "ArrowLeft") goToPage(state.pageIndex - 1);
  if (e.key === "ArrowRight") goToPage(state.pageIndex + 1);
});

// ---------- Step 5: order ----------

function renderFormats() {
  $("#format-grid").innerHTML = pricing.formats
    .map(
      (f) => `
      <button type="button" class="card price-card format-pick" data-format="${f.id}" aria-pressed="${f.id === state.format}">
        ${f.badge ? `<span class="badge">${esc(f.badge)}</span>` : ""}
        <h3>${esc(f.name)}</h3>
        <div class="price">${formatPrice(pricing, f.price)}</div>
        <ul>${f.features.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </button>`
    )
    .join("");
  const f = pricing.formats.find((x) => x.id === state.format);
  const title = currentStory().title.replace("{hero}", state.book.hero.name);
  $("#order-summary").textContent = `“${title}” · ${f.name} · ${formatPrice(pricing, f.price)}`;
  const err = $("#checkout-error");
  if (config.checkout === "off") {
    err.textContent = "Ordering opens very soon! Your preview is saved in this browser — come back to this page to order it.";
    err.hidden = false;
    $("#checkout-btn").disabled = true;
  }
}

$("#format-grid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-format]");
  if (!b) return;
  state.format = b.dataset.format;
  renderFormats();
});

$("#checkout-btn").addEventListener("click", async () => {
  const btn = $("#checkout-btn");
  const err = $("#checkout-error");
  btn.disabled = true;
  btn.textContent = "Opening checkout…";
  err.hidden = true;
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: state.book.id, storyId: state.book.storyId, format: state.format, heroName: state.book.hero.name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || "Couldn't start checkout. Please try again.");
    location.href = data.url;
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = "Checkout securely 🔒";
  }
});

// ---------- Start / resume ----------

async function resume(id) {
  const book = await getBook(id).catch(() => null);
  if (!book || !stories.some((s) => s.id === book.storyId)) return false;
  state.storyId = book.storyId;
  $("#hero-name").value = book.hero.name;
  $("#hero-age").value = String(book.hero.age);
  document.querySelector(`input[name="pronoun"][value="${book.hero.pronoun}"]`).checked = true;
  const styleInput = document.querySelector(`input[name="style"][value="${book.style}"]`);
  if (styleInput) styleInput.checked = true;
  $("#dedication").value = book.dedication || "";
  const toImg = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
  const heroSlot = state.people.find((p) => p.hero);
  heroSlot.cropper.setImage(await toImg(book.heroPhoto));
  for (const p of book.people) {
    const slot = addPersonSlot({ name: p.name, relation: p.relation });
    slot.cropper.setImage(await toImg(p.photo));
  }
  for (const p of state.people) p.el.querySelector('input[type="range"]').disabled = false;
  $("#consent").checked = true;
  state.book = book;
  state.aiKey = illustrationKey(collectBook());
  return true;
}

addPersonSlot({ hero: true });
renderPicker();

const resumeId = params.get("resume");
if (resumeId && (await resume(resumeId))) {
  renderPicker();
  showStep(3);
} else {
  showStep(0);
}
