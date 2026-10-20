// GET /api/order?session_id=cs_... — confirms with Stripe that an order is
// paid, so the success page can unlock the full, watermark-free book.

const { findFormat, stripe } = require("./_lib");

const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]+$/;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const sessionId = (req.query?.session_id || "").toString();
  if (!SESSION_RE.test(sessionId)) return res.status(400).json({ error: "Invalid order reference." });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: "Checkout isn't configured." });

  try {
    const session = await stripe("GET", `checkout/sessions/${sessionId}`);
    const format = findFormat(session.metadata?.format);
    return res.status(200).json({
      paid: session.payment_status === "paid",
      bookId: session.metadata?.bookId || null,
      storyId: session.metadata?.storyId || null,
      heroName: session.metadata?.heroName || null,
      format: format ? { id: format.id, name: format.name, print: format.print } : null,
      email: session.customer_details?.email || null,
      orderRef: sessionId.slice(-8).toUpperCase(),
    });
  } catch (err) {
    console.error("Order lookup failed:", err.message);
    return res.status(err.status === 404 ? 404 : 502).json({ error: "Couldn't find that order." });
  }
};
