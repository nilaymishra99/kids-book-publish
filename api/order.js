// GET /api/order?session_id=cs_... — confirms with Stripe that an order is
// paid, so the success page can unlock the full, watermark-free book(s).

const { findFormat, stripe } = require("./_lib");

const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]+$/;

function parseBundle(value) {
  if (!value) return null;
  return value.split(",").map((item) => {
    const [bookId, storyId, pages] = item.split(":");
    return { bookId, storyId, pages: Number(pages) };
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const sessionId = (req.query?.session_id || "").toString();
  if (!SESSION_RE.test(sessionId)) return res.status(400).json({ error: "Invalid order reference." });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: "Checkout isn't configured." });

  try {
    const session = await stripe("GET", `checkout/sessions/${sessionId}`);
    const m = session.metadata || {};
    const format = findFormat(m.format);
    return res.status(200).json({
      paid: session.payment_status === "paid",
      bookId: m.bookId || null,
      bundleId: m.bundleId || null,
      bundleBooks: parseBundle(m.bundleBooks),
      storyId: m.storyId || null,
      pages: m.pages ? Number(m.pages) : null,
      heroName: m.heroName || null,
      format: format ? { id: format.id, name: format.name, print: format.print } : null,
      email: session.customer_details?.email || null,
      orderRef: sessionId.slice(-8).toUpperCase(),
    });
  } catch (err) {
    console.error("Order lookup failed:", err.message);
    return res.status(err.status === 404 ? 404 : 502).json({ error: "Couldn't find that order." });
  }
};
