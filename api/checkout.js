// POST /api/checkout — creates a Stripe Checkout session for one book or a
// bundle. Prices are worked out here from data/pricing.json, never from the
// request.
//
// Single book:  { bookId, storyId, format, pages, heroName }
// Bundle:       { bundleId, format, heroName, books: [{ bookId, storyId, pages }, ...] }
//
// Required env var: STRIPE_SECRET_KEY
// Optional: SITE_URL (used for success/cancel redirects; defaults to the
//           request's host), ALLOW_DEMO_CHECKOUT=true (local testing only —
//           skips payment when Stripe isn't configured)

const { readJsonBody, findStory, findFormat, pricing, siteOrigin, stripe, bookPrice, validPageCount } = require("./_lib");

const ID_RE = /^[a-z0-9-]{8,64}$/i;

function bundleTotal(format, books) {
  const sum = books.reduce((total, b) => total + bookPrice(format, b.pages), 0);
  return Math.round((sum * (100 - pricing.bundle.discountPercent)) / 100);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = readJsonBody(req);
  if (!body) return res.status(400).json({ error: "Invalid JSON body" });

  const format = findFormat(body.format);
  const heroName = (body.heroName || "").toString().trim().slice(0, 40);
  if (!format || !heroName) return res.status(400).json({ error: "Please finish building your book first." });

  const origin = siteOrigin(req);
  let amount;
  let productName;
  let metadata;
  let successQuery;

  if (Array.isArray(body.books)) {
    // Bundle
    const bundleId = (body.bundleId || "").toString();
    const books = [];
    for (const b of body.books.slice(0, 10)) {
      const story = findStory(b?.storyId);
      if (!story || !ID_RE.test(String(b?.bookId || "")) || !validPageCount(Number(b?.pages))) {
        return res.status(400).json({ error: "Please finish building your bundle first." });
      }
      books.push({ bookId: String(b.bookId), storyId: story.id, pages: Number(b.pages) });
    }
    if (!ID_RE.test(bundleId) || books.length < 2 || books.length > pricing.bundle.books + 2) {
      return res.status(400).json({ error: "Please finish building your bundle first." });
    }
    amount = bundleTotal(format, books);
    productName = `Bundle of ${books.length} comic books — ${format.name}`;
    metadata = {
      bundleId,
      format: format.id,
      heroName,
      bundleBooks: books.map((b) => `${b.bookId}:${b.storyId}:${b.pages}`).join(","),
    };
    successQuery = `bundle=${encodeURIComponent(bundleId)}`;
  } else {
    // Single book
    const story = findStory(body.storyId);
    const bookId = (body.bookId || "").toString();
    const pages = Number(body.pages);
    if (!story || !ID_RE.test(bookId) || !validPageCount(pages)) {
      return res.status(400).json({ error: "Please finish building your book first." });
    }
    amount = bookPrice(format, pages);
    productName = `${story.title.replace("{hero}", heroName)} — ${format.name}, ${pages} pages`;
    metadata = { bookId, storyId: story.id, format: format.id, pages: String(pages), heroName };
    successQuery = `book=${encodeURIComponent(bookId)}`;
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    if (process.env.ALLOW_DEMO_CHECKOUT === "true") {
      return res.status(200).json({ url: `${origin}/success?demo=1&${successQuery}&format=${format.id}` });
    }
    return res.status(503).json({ error: "Checkout isn't open yet. Please check back soon!" });
  }

  const params = {
    mode: "payment",
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/create`,
    line_items: {
      0: {
        quantity: 1,
        price_data: {
          currency: pricing.currency,
          unit_amount: amount * 100,
          product_data: { name: productName },
        },
      },
    },
    metadata,
    payment_intent_data: { metadata },
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
