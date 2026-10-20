// Finds the people in an uploaded photo and lets the parent choose one
// headshot. Only the chosen headshot is kept; the full photo is not stored.
//
// Detection order: the browser's face detector (when it exists), then the
// /api/detect-faces service, then the centre of the photo (with a note).

const MAX_FACES = 6;
const HEAD_SCALE = 1.7; // headshot = head box expanded so hair and chin fit
const LABEL_POSITIONS = ["on the left", "in the middle", "on the right"];

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

// Smaller JPEG copy of the photo for detection (keeps uploads small).
function photoToDataUrl(img, max = 1280) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

// Square headshot around a face box ([x, y, w, h] as fractions of the image).
export function cropHeadshot(img, box, size = 768) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const [x, y, w, h] = box;
  let side = Math.min(iw, ih, Math.max(w * iw, h * ih) * HEAD_SCALE);
  const cx = (x + w / 2) * iw;
  const cy = (y + h / 2) * ih;
  const sx = Math.min(Math.max(cx - side / 2, 0), iw - side);
  const sy = Math.min(Math.max(cy - side / 2, 0), ih - side);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.9);
}

async function detectWithBrowser(img) {
  if (!("FaceDetector" in window)) return null;
  try {
    const found = await new window.FaceDetector({ fastMode: true, maxDetectedFaces: MAX_FACES }).detect(img);
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    return found
      .map((f) => ({ x: f.boundingBox.x / iw, y: f.boundingBox.y / ih, w: f.boundingBox.width / iw, h: f.boundingBox.height / ih }))
      .sort((a, b) => a.x - b.x)
      .map((f, i, all) => ({
        box: [f.x, f.y, f.w, f.h],
        description: `person ${LABEL_POSITIONS[Math.round((i / Math.max(1, all.length - 1)) * 2)] || ""}`.trim(),
      }));
  } catch {
    return null;
  }
}

async function detectWithService(img) {
  try {
    const res = await fetch("/api/detect-faces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photo: photoToDataUrl(img) }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.faces) ? data.faces : null;
  } catch {
    return null;
  }
}

// Returns { faces, automatic }. faces is null when no detector is available.
export async function findFaces(img) {
  const browser = await detectWithBrowser(img);
  if (browser?.length) return { faces: browser, automatic: true };
  if (browser) return { faces: [], automatic: true };
  const service = await detectWithService(img);
  return { faces: service, automatic: Boolean(service) };
}

// Drop-in for the old photo cropper: setImage(img), export(), img, setHeadshot().
export class HeadshotPicker {
  constructor(el, { onChange = () => {}, name = "" } = {}) {
    this.el = el;
    this.onChange = onChange;
    this.name = name;
    this.img = null;
    this.source = null;
    this.headshot = null;
    this.faces = [];
    this.render("empty");
  }

  setZoom() {} // no manual zoom any more; kept so older callers keep working

  export() {
    return this.headshot;
  }

  async setImage(img) {
    this.source = img;
    this.img = null;
    this.headshot = null;
    this.render("loading");
    const { faces, automatic } = await findFaces(img);
    this.faces = faces || [];
    if (faces === null) {
      // No face finder available: use the centre of the photo, and say so.
      this.choose([0, 0, 1, 1], { note: true });
    } else if (faces.length === 0) {
      this.render("none");
    } else if (faces.length === 1) {
      this.choose(faces[0].box, { note: !automatic });
    } else {
      this.render("choose");
    }
  }

  // Used when a saved book is reopened: the headshot is already cropped.
  setHeadshot(dataUrl) {
    this.headshot = dataUrl;
    this.img = true;
    this.render("chosen");
  }

  choose(box, { note = false } = {}) {
    this.headshot = cropHeadshot(this.source, box);
    this.img = this.source;
    this.render("chosen", { note });
    this.onChange(this.headshot);
  }

  render(state, { note = false } = {}) {
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    // Read the name only when a state needs it, so it is never read before the page has set it up.
    const nameText = () => (typeof this.name === "function" ? this.name() : this.name) || "this child";
    let html = "";
    if (state === "empty") html = `<div class="placeholder"><span class="emoji" aria-hidden="true">🙂</span>Add a photo</div>`;
    if (state === "loading") html = `<div class="placeholder"><span class="emoji" aria-hidden="true">🔍</span>Finding faces…</div>`;
    if (state === "none") html = `<div class="placeholder"><span class="emoji" aria-hidden="true">🤔</span>We couldn't find a face in that photo. Please try a clearer, front-facing photo.</div>`;
    if (state === "choose") {
      html = `<div class="headshot-choose">
        <p class="headshot-title">We found ${this.faces.length} people. Which one is ${esc(nameText())}?</p>
        <div class="headshot-grid">${this.faces
          .map(
            (f, i) => `<button type="button" class="headshot-option" data-face="${i}" aria-label="Use person ${i + 1}: ${esc(f.description)}">
              <img src="${cropHeadshot(this.source, f.box, 160)}" alt="">
              <span>${esc(f.description)}</span></button>`
          )
          .join("")}</div></div>`;
    }
    if (state === "chosen") {
      html = `<div class="headshot-result">
        <img class="headshot-avatar" src="${this.headshot}" alt="Headshot of ${esc(nameText())}">
        ${note ? `<p class="hint">Automatic face finding isn't available here, so we used the centre of the photo. Check the headshot looks right.</p>` : ""}
        ${this.faces.length > 1 ? `<button type="button" class="btn btn-sm btn-white" data-again="1">Choose someone else</button>` : ""}
      </div>`;
    }
    this.el.innerHTML = html;
    this.el.classList.toggle("headshot-box", state === "choose" || state === "none" || state === "loading");
    this.el.onclick = (e) => {
      const opt = e.target.closest("[data-face]");
      if (opt) return this.choose(this.faces[Number(opt.dataset.face)].box);
      if (e.target.closest("[data-again]")) this.render("choose");
    };
  }
}
