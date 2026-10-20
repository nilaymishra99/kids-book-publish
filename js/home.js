import { loadData, storyCardHtml, formatPrice, esc, setupNav } from "./common.js";

setupNav();
document.getElementById("year").textContent = new Date().getFullYear();

const { ageGroups, categories, stories, pricing } = await loadData();

const grid = document.getElementById("story-grid");
const filters = document.getElementById("story-filters");
const themeFilters = document.getElementById("theme-filters");
let activeAge = "all";
let activeTheme = "all";

function renderStories() {
  const list = stories.filter(
    (s) => (activeAge === "all" || s.ageGroup === activeAge) && (activeTheme === "all" || s.category === activeTheme)
  );
  grid.innerHTML = list.length
    ? list.map((s) => storyCardHtml(s, ageGroups)).join("")
    : `<p class="card" style="grid-column:1/-1;text-align:center">No stories match both filters yet — try "All ages" or "All themes".</p>`;
  for (const btn of filters.querySelectorAll("button")) btn.setAttribute("aria-pressed", String(btn.dataset.age === activeAge));
  for (const btn of themeFilters.querySelectorAll("button")) btn.setAttribute("aria-pressed", String(btn.dataset.theme === activeTheme));
  for (const card of document.querySelectorAll(".age-card")) card.setAttribute("aria-pressed", String(card.dataset.age === activeAge));
}

function setAge(age) {
  activeAge = age;
  renderStories();
}

filters.innerHTML = [`<button class="chip" data-age="all">All ages</button>`]
  .concat(ageGroups.map((g) => `<button class="chip" data-age="${g.id}">${g.emoji} ${esc(g.ages)}</button>`))
  .join("");
filters.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-age]");
  if (btn) setAge(btn.dataset.age);
});

themeFilters.innerHTML = [`<button class="chip" data-theme="all">All themes</button>`]
  .concat(categories.map((c) => `<button class="chip" data-theme="${c.id}">${c.emoji} ${esc(c.name)}</button>`))
  .join("");
themeFilters.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-theme]");
  if (!btn) return;
  activeTheme = btn.dataset.theme;
  renderStories();
});

document.getElementById("age-cards").innerHTML = ageGroups
  .map(
    (g) => `
    <button class="card age-card" data-age="${g.id}" aria-pressed="false">
      <div class="emoji" aria-hidden="true">${g.emoji}</div>
      <h3>${esc(g.name)}</h3>
      <div class="ages">${esc(g.ages)}</div>
      <p>${esc(g.blurb)}</p>
    </button>`
  )
  .join("");
document.getElementById("age-cards").addEventListener("click", (e) => {
  const card = e.target.closest(".age-card");
  if (!card) return;
  setAge(card.dataset.age);
  document.getElementById("stories").scrollIntoView();
});

document.getElementById("price-grid").innerHTML = pricing.formats
  .map(
    (f) => `
    <div class="card price-card">
      ${f.badge ? `<span class="badge">${esc(f.badge)}</span>` : ""}
      <h3>${esc(f.name)}</h3>
      <div class="price">${formatPrice(pricing, f.price)}</div>
      <ul>${f.features.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <a class="btn ${f.badge ? "btn-red" : "btn-white"}" href="/create" style="margin-top:auto">Create yours</a>
    </div>`
  )
  .join("");

renderStories();
