// Shared browser helpers: data loading, story-card markup, mobile nav.

export const BRAND = "Little Legends";

let dataPromise;
export function loadData() {
  dataPromise ||= Promise.all([
    fetch("/data/stories.json").then((r) => r.json()),
    fetch("/data/pricing.json").then((r) => r.json()),
  ]).then(([stories, pricing]) => ({ ...stories, pricing }));
  return dataPromise;
}

let configPromise;
export function loadConfig() {
  configPromise ||= fetch("/api/config")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .catch(() => ({ ai: false, checkout: "off", printStorage: false }));
  return configPromise;
}

export function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function formatPrice(pricing, amount) {
  return `${pricing.symbol}${amount.toLocaleString("en-IN")}`;
}

// Title with the hero's name dropped in (or a highlighted placeholder).
export function storyTitleHtml(story, name) {
  return esc(story.title).replace("{hero}", `<span class="hero-name">${esc(name || "Your Child")}</span>`);
}

export function storyCardHtml(story, ageGroups, { tag = "a", name = "" } = {}) {
  const age = ageGroups.find((g) => g.id === story.ageGroup);
  const [c1, c2] = story.palette;
  const attrs = tag === "a" ? `href="/create?story=${story.id}"` : `type="button" data-story="${story.id}" aria-pressed="false"`;
  return `
    <${tag} class="card story-card ${tag === "button" ? "story-pick" : ""}" ${attrs} style="text-decoration:none">
      <div class="story-cover" style="background:linear-gradient(135deg, ${c1}, ${c2})">
        <span class="age-badge">${esc(age?.ages || story.ageGroup)}</span>
        <span class="theme-badge">${esc(story.theme)}</span>
        <span class="big" aria-hidden="true">${story.emoji}</span>
      </div>
      <div class="story-body">
        <h3>${storyTitleHtml(story, name)}</h3>
        <p>${esc(story.blurb.replace("{hero}", name || "your child"))}</p>
        <span class="meta">15–30 pages · ${esc(age?.name || "")}</span>
      </div>
    </${tag}>`;
}

export function setupNav() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".nav");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  nav.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}
