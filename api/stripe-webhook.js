// POST /api/stripe-webhook — Stripe calls this when a checkout completes; we
// email the shop owner the order details so print orders can be fulfilled.
//
// Instead of verifying the webhook signature (which needs the raw request
// body), we re-fetch the event from Stripe by id with our secret key. Anyone
// can POST here, but only real events that exist in our Stripe account are
// acted on.
//
// Required env vars: STRIPE_SECRET_KEY, RESEND_API_KEY
// Optional: ORDERS_TO_EMAIL (default mail2nilaymishra@gmail.com),
//           ORDERS_FROM_EMAIL (default Resend's sandbox sender)

const { readJsonBody, findFormat, findStory, pricing, stripe, escapeHtml } = require("./_lib");

const EVENT_RE = /^evt_[A-Za-z0-9]+$/;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = readJsonBody(req);
  const eventId = (body?.id || "").toString();
  if (!EVENT_RE.test(eventId)) return res.status(400).json({ error: "Invalid event" });

  let event;
  try {
    event = await stripe("GET", `events/${eventId}`);
  } catch (err) {
    console.error("Webhook event lookup failed:", err.message);
    return res.status(err.status === 404 ? 400 : 502).json({ error: "Unknown event" });
  }

  if (event.type !== "checkout.session.completed") return res.status(200).json({ ignored: true });

  const session = event.data.object;
  const m = session.metadata || {};
  const format = findFormat(m.format);
  const story = findStory(m.storyId);
  const bundle = (m.bundleBooks || "").split(",").filter(Boolean).map((item) => {
    const [bookId, storyId, pages] = item.split(":");
    const st = findStory(storyId);
    return `${st ? st.title.replace("{hero}", m.heroName || "") : storyId} (${pages} pages, ${bookId})`;
  });
  const ship = session.collected_information?.shipping_details || session.shipping_details;
  const addr = ship?.address;
  const rows = [
    ["Order", session.id],
    ["Book", bundle.length ? `Bundle: ${bundle.join("; ")}` : story ? `${story.title.replace("{hero}", m.heroName || "")} (${m.pages || "?"} pages)` : m.storyId],
    ["Format", format?.name || session.metadata?.format],
    ["Paid", `${pricing.symbol}${(session.amount_total || 0) / 100} (${session.payment_status})`],
    ["Customer", `${session.customer_details?.name || ""} <${session.customer_details?.email || ""}> ${session.customer_details?.phone || ""}`],
  ];
  if (format?.print && addr) {
    rows.push(["Ship to", [ship.name, addr.line1, addr.line2, addr.city, addr.state, addr.postal_code, addr.country].filter(Boolean).join(", ")]);
    rows.push(["Pages", `Vercel Blob → orders/${session.id}/<book id>/ (uploaded from the customer's browser after payment)`]);
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("New order (RESEND_API_KEY not set, not emailing):", JSON.stringify(rows));
    return res.status(200).json({ ok: true });
  }

  try {
    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.ORDERS_FROM_EMAIL || "Comic Orders <onboarding@resend.dev>",
        to: [process.env.ORDERS_TO_EMAIL || "mail2nilaymishra@gmail.com"],
        subject: `New ${format?.print ? "PRINT" : "digital"} ${bundle.length ? "bundle" : "order"} — ${m.heroName || ""}`,
        html: `<table>${rows.map(([k, v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v || "")}</td></tr>`).join("")}</table>`,
      }),
    });
    if (!sendRes.ok) console.error("Resend error:", sendRes.status, await sendRes.text());
  } catch (err) {
    console.error("Order email failed:", err);
  }
  // Always 200 once the event is verified, so Stripe doesn't retry forever
  // over an email hiccup — the order is still visible in the Stripe dashboard.
  return res.status(200).json({ ok: true });
};
