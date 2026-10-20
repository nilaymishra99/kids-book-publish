// POST /api/checkout — creates a Stripe Checkout session for one book.
// Price comes from data/pricing.json, never from the request.
//
// Required env var: STRIPE_SECRET_KEY
// Optional: SITE_URL (used for success/cancel redirects; defaults to the
//           request's host), ALLOW_DEMO_CHECKOUT=true (local testing only —
//           skips payment when Stripe isn't configured)

const { readJsonBody, findStory, findFormat, pricing, siteOrigin, stripe } = require("./_lib");

const BOOK_ID_RE = /^[a-z0-9-]{8,64}$/i;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = readJsonBody(req);
  if (!body) return res.status(400).json({ error: "Invalid JSON body" });

  const story = findStory(body.storyId);
  const format = findFormat(body.format);
  const bookId = (body.bookId || "").toString();
  const heroName = (body.heroName || "").toString().trim().slice(0, 40);
  if (!story || !format || !BOOK_ID_RE.test(bookId) || !heroName) {
    return res.status(400).json({ error: "Please finish building your book first." });
  }

  const origin = siteOrigin(req);
  const title = story.title.replace("{hero}", heroName);

  if (!process.env.STRIPE_SECRET_KEY) {
    if (process.env.ALLOW_DEMO_CHECKOUT === "true") {
      return res.status(200).json({ url: `${origin}/success?demo=1&book=${encodeURIComponent(bookId)}&format=${format.id}` });
    }
    return res.status(503).json({ error: "Checkout isn't open yet. Please check back soon!" });
  }

  const params = {
    mode: "payment",
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/create?resume=${encodeURIComponent(bookId)}`,
    line_items: {
      0: {
        quantity: 1,
        price_data: {
          currency: pricing.currency,
          unit_amount: Math.round(format.price * 100),
          product_data: { name: `${title} — ${format.name}` },
        },
      },
    },
    metadata: { bookId, storyId: story.id, format: format.id, heroName },
    payment_intent_data: { metadata: { bookId, storyId: story.id, format: format.id } },
    billing_address_collection: "auto",
    phone_number_collection: { enabled: format.print ? "true" : "false" },
  };
  if (format.print) {
    params.shipping_address_collection = {
      allowed_countries: Object.fromEntries(pricing.shippingCountries.map((c, i) => [i, c])),
    };
  }

  try {
    const session = await stripe("POST", "checkout/sessions", params);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout failed:", err.message);
    return res.status(502).json({ error: "Couldn't start checkout right now. Please try again." });
  }
};
