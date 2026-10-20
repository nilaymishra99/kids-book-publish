// Shared helpers for the API routes. Files starting with "_" are not exposed
// as routes by Vercel.

const stories = require("../data/stories.json");
const pricing = require("../data/pricing.json");

function readJsonBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === "object" ? body : null;
}

function findStory(id) {
  return stories.stories.find((s) => s.id === id) || null;
}

function findFormat(id) {
  return pricing.formats.find((f) => f.id === id) || null;
}

function siteOrigin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const host = req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"] || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
}

// Best-effort, per-instance rate limit. Serverless instances don't share
// memory, so this only slows down abuse — the hard ceiling is the spend
// limit you set on the image provider's dashboard.
const hits = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start > windowMs) {
    hits.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

// Minimal Stripe REST client — avoids pulling in the full SDK for three calls.
function toForm(obj, prefix, out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object") toForm(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function stripe(method, path, params) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params ? toForm(params).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Stripe error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = {
  stories,
  pricing,
  readJsonBody,
  findStory,
  findFormat,
  siteOrigin,
  clientIp,
  rateLimited,
  stripe,
  escapeHtml,
};
