// Small helpers for the animated page turns used in the preview, the bundle
// viewer and the animated reader on the success page.

// Swap an image's source with a page-turn animation.
export function turnTo(img, src) {
  img.classList.remove("turn");
  void img.offsetWidth; // restart the CSS animation
  img.src = src;
  img.classList.add("turn");
}

// Full-screen reader with animated page turns and an autoplay button.
export function openReader(pages, title = "Your comic") {
  const overlay = document.createElement("div");
  overlay.className = "reader";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", title);
  overlay.innerHTML = `
    <div class="reader-bar">
      <strong>${title.replace(/[<>&]/g, "")}</strong>
      <div class="reader-actions">
        <button class="btn btn-sm btn-white" data-act="play">▶ Play</button>
        <button class="btn btn-sm btn-white" data-act="close" aria-label="Close reader">✕</button>
      </div>
    </div>
    <div class="reader-stage"><img alt="" class="turn"></div>
    <div class="reader-controls">
      <button class="btn btn-sm btn-white" data-act="prev" aria-label="Previous page">◀</button>
      <span data-count aria-live="polite"></span>
      <button class="btn btn-sm btn-white" data-act="next" aria-label="Next page">▶</button>
    </div>`;
  document.body.appendChild(overlay);
  const img = overlay.querySelector("img");
  const count = overlay.querySelector("[data-count]");
  const play = overlay.querySelector('[data-act="play"]');
  let index = 0;
  let timer = null;

  const show = (i) => {
    index = Math.max(0, Math.min(pages.length - 1, i));
    turnTo(img, pages[index]);
    count.textContent = `Page ${index + 1} / ${pages.length}`;
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
    play.textContent = "▶ Play";
  };
  overlay.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") close();
    if (act === "prev") (stop(), show(index - 1));
    if (act === "next") (stop(), show(index + 1));
    if (act === "play") {
      if (timer) return stop();
      play.textContent = "❚❚ Pause";
      timer = setInterval(() => (index >= pages.length - 1 ? stop() : show(index + 1)), 3500);
      if (index >= pages.length - 1) show(0);
    }
  });
  const onKey = (e) => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") (stop(), show(index - 1));
    if (e.key === "ArrowRight") (stop(), show(index + 1));
  };
  document.addEventListener("keydown", onKey);
  function close() {
    stop();
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }
  show(0);
}
