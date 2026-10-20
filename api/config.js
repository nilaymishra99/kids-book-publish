// GET /api/config — tells the browser which optional services are switched on,
// so the create flow can pick AI illustration vs. photo-comic mode and
// real vs. demo checkout. Never returns secrets, only booleans.

const { imageReady, storyReady } = require("./_providers");

module.exports = function handler(req, res) {
  const stripeOn = Boolean(process.env.STRIPE_SECRET_KEY);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ai: imageReady(),
    story: storyReady(),
    checkout: stripeOn ? "stripe" : process.env.ALLOW_DEMO_CHECKOUT === "true" ? "demo" : "off",
    printStorage: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
  });
};
