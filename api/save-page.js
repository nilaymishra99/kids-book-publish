// POST /api/save-page — after a PRINT order is paid, the customer's browser
// uploads each finished page here so it can be sent to the printer.
// Pages are stored as PRIVATE blobs (not reachable by URL without the token)
// under orders/<checkout session id>/<book id>/page-NN.jpg. A bundle order has
// one folder per book.
//
// Required env vars: STRIPE_SECRET_KEY, BLOB_READ_WRITE_TOKEN (created
// automatically when you add a Blob store to the Vercel project)

const { put } = require("@vercel/blob");
const { readJsonBody, findFormat, stripe } = require("./_lib");

const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]+$/;
const ID_RE = /^[a-z0-9-]{8,64}$/i;
const PAGE_RE = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/;
const MAX_PAGES = 40;

// Cache of verified paid print sessions for this warm instance, so a
// 15-page upload doesn't call Stripe 15 times.
const verified = new Set();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN || !process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: "Print uploads aren't configured." });
  }

  const body = readJsonBody(req);
  const sessionId = (body?.sessionId || "").toString();
  const bookId = (body?.bookId || "").toString();
  const page = parseInt(body?.page, 10);
  const match = PAGE_RE.exec(body?.image || "");
  if (!SESSION_RE.test(sessionId) || !ID_RE.test(bookId) || !(page >= 0 && page < MAX_PAGES) || !match) {
    return res.status(400).json({ error: "Invalid page upload." });
  }

  const key = `${sessionId}/${bookId}`;
  if (!verified.has(key)) {
    try {
      const session = await stripe("GET", `checkout/sessions/${sessionId}`);
      const m = session.metadata || {};
      const inOrder =
        m.bookId === bookId || (m.bundleBooks || "").split(",").some((item) => item.split(":")[0] === bookId);
      if (session.payment_status !== "paid" || !findFormat(m.format)?.print || !inOrder) {
        return res.status(403).json({ error: "This book isn't part of a paid print order." });
      }
      verified.add(key);
    } catch (err) {
      console.error("Order verification failed:", err.message);
      return res.status(502).json({ error: "Couldn't verify the order." });
    }
  }

  try {
    const name = `orders/${sessionId}/${bookId}/page-${String(page).padStart(2, "0")}.jpg`;
    await put(name, Buffer.from(match[1], "base64"), {
      access: "private",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Blob upload failed:", err);
    return res.status(500).json({ error: "Couldn't save this page." });
  }
};
