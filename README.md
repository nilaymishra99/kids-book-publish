# Little Legends — personalised kids' comic books

Parents upload a photo of their child (plus up to five family members, friends
or pets), pick an age-appropriate story, and get a comic book starring their
family — as an instant PDF or a printed softcover/hardcover.

"Little Legends" is a placeholder brand name. Change it in the HTML headers,
`BRAND` in `js/common.js`, and the page `<title>`s.

This folder is a **standalone app**, deployed as its own Vercel project. It
lives in the personal-website repo for now; it shares no code with the
personal site, so you can move it to its own repo by copying the folder.

## What's in phase one

| Feature | Where |
|---|---|
| Landing page: hero, age groups, story catalogue with filters, how it works, pricing, privacy, FAQ | `index.html`, `js/home.js` |
| 8 stories with named characters, 4 age bands (0–2, 3–5, 6–8, 9–10), 15–30 pages each | `data/stories.json` |
| 5-step creator: story → hero (name, age, pronouns, art style, dedication) → photos (hero + up to 5, with crop/zoom, consent) → full preview → format | `create.html`, `js/create.js` |
| Comic renderer: cover, dedication, one illustrated page per story page, captions, speech bubbles, "The End" page, watermark | `js/comic.js` |
| AI illustration of every page from the photos (optional) | `api/generate.js`, `js/builder.js` |
| Bundle builder: age, interests, format and length → three matched books at a bundle price | `bundle.html`, `js/bundle.js` |
| Stripe Checkout, prices from one JSON file, shipping address for print | `api/checkout.js`, `data/pricing.json` |
| Success page: verifies payment, unlocks watermark-free book, PDF download, uploads print pages | `success.html`, `js/success.js`, `api/order.js`, `api/save-page.js` |
| Order email to you on every sale | `api/stripe-webhook.js` |

### Two illustration modes

- **AI mode** (`OPENAI_API_KEY` set): each panel and the cover are drawn by an
  image model (default `gpt-image-1`) using the uploaded photos as likeness
  references, in the art style the parent picks. The prompt is built
  server-side from `stories.json`, so the endpoint can't be used as a free
  image generator. Text is never drawn by the model — captions and bubbles are
  added by `js/comic.js`, so they're always spelled right.
- **Photo-comic mode** (no key, or if a panel fails): themed backdrops with the
  family's photos turned into comic-style portraits. Works with zero
  running cost — fine for a soft launch.

### Cost per book (AI mode, rough)

A story is 6–7 panels + a cover ≈ 8 images. At "medium" quality that's
very roughly US$0.50–1.00 of image generation per preview (check current pricing for your model and quality setting). Because previews are
free, set a **monthly spend limit** in the OpenAI dashboard and watch the ratio
of previews to orders. `GENERATE_HOURLY_LIMIT` slows down a single visitor, but
it's per-server-instance and best-effort, not a hard cap.

## Run it locally

Node 20+ and the [Vercel CLI](https://vercel.com/docs/cli):

```bash
cd kids-comics
npm install
cp .env.example .env     # ALLOW_DEMO_CHECKOUT=true lets you "order" without Stripe
vercel dev
npm run check            # validates stories.json / pricing.json and loads every API route
```

With an empty `.env` you get photo-comic mode and demo checkout — the full
flow works end to end.

## Go-live checklist

1. **Vercel project**: Import the repo → set **Root Directory** to
   `kids-comics`. (The repo root's `.vercelignore` keeps this folder out of the
   personal-website deployment.) Generation can take up to ~60s per image;
   `vercel.json` sets `api/generate.js` to 120s, which needs Fluid compute
   (on by default for new projects).
2. **Env vars** (Project → Settings → Environment Variables), see `.env.example`:
   - `OPENAI_API_KEY` — for AI mode. Set a spend limit.
   - `STRIPE_SECRET_KEY` — start with `sk_test_…`, switch to live when ready.
     Do **not** set `ALLOW_DEMO_CHECKOUT` in production.
   - `SITE_URL` — your real domain.
   - `RESEND_API_KEY`, `ORDERS_TO_EMAIL` — order notification emails.
   - Add a **Blob store** (Storage tab) → `BLOB_READ_WRITE_TOKEN` is set
     automatically. Needed for print orders.
3. **Stripe webhook**: Developers → Webhooks → add
   `https://YOUR-DOMAIN/api/stripe-webhook`, event `checkout.session.completed`.
   Also turn on email receipts for customers in Stripe settings.
4. **Printing**: print orders email you the shipping address; the pages are in
   Vercel Blob under `orders/<session id>/page-NN.jpg` (1600×1600 px, 8×8 in at
   200 dpi). Send them to a print-on-demand partner. Delete them after
   shipping — the privacy page promises within 30 days.
5. **Legal & trust**: replace `hello@example.com`, have a lawyer review
   `privacy.html` and add terms & refund policy pages. You're handling
   children's photos: in India that's the DPDP Act (verifiable parental
   consent for under-18s); if you sell to the US/EU, COPPA/GDPR apply as well.
6. **Prices**: edit `data/pricing.json` (currency, amounts, shipping countries).

## AI providers

- **Pictures and face finding:** Google Gemini (`GEMINI_API_KEY`). Default image
  model `gemini-3.1-flash-image`, about $0.06–0.08 per picture at the time of
  writing. The older 2.5 image model is past Google's shutdown date.
- **Stories:** Anthropic Claude (`ANTHROPIC_API_KEY`). Each book gets its own
  story, written for the child's name, age, pronouns and family. The server
  checks the page count, text length and who may appear before anything is shown.
- **OpenAI:** optional alternative for pictures (`IMAGE_PROVIDER=openai`).

Model ids are set with environment variables, so you can change them in Vercel
without a code change. Check current prices and model ids before launch.

## Headshots

Each uploaded photo is checked for faces before anything else happens:

1. The browser's own face detector is used when it's available.
2. Otherwise the photo goes to `/api/detect-faces`, which returns a box and a
   short neutral description for each person (for example "young boy, glasses").
   It never names anyone.
3. One person: their headshot is used automatically.
   Several people: the parent chooses which headshot to use.
   No face: the parent is asked for a clearer photo.
4. Only the chosen headshot (a 768 px square) is kept and sent to the avatar
   step. The full photo is discarded in the browser after detection.

Without `OPENAI_API_KEY` the site uses the browser's detector, or the centre of
the photo with a note. Set `DETECT_MODEL` or `DETECT_HOURLY_LIMIT` to tune
detection.

## How the AI comic is made

1. **Sidekick sheet:** the story's character is drawn once from its description.
2. **Character sheets:** the child and each family member are drawn as a cartoon
   character from their uploaded photo. This is the closest cartoon likeness we
   can get. The photo is sent to the image provider for this step only.
3. **Pages:** every comic page (plus the cover) is drawn in full colour by the
   image model, with the character sheets as references so faces stay the same
   from page to page. The captions and speech bubbles are written into the
   prompt from `data/stories.json`, so the browser can't change them.
4. **Animation:** pages turn with a 3D flip in the preview, and the reader
   (`js/reader.js`) plays the book with autoplay. The cover floats gently.

Each book needs about 17–32 images, so costs grow with page count. Image
resolution is 1024 × 1024. The print files are 8 × 8 in at 200 dpi, so before
printing, check the page sharpness (higher quality setting or upscaling).

## Stories, page counts and bundles

Each story in `data/stories.json` has three parts:

- `intro`: 2 pages
- `middle`: 26 pages (the adventure)
- `finale`: 2 pages

A book with N pages (15–30) uses `intro`, the first N−4 pages of `middle`, and
`finale`, so every length has a complete beginning and ending. The shared rule
lives in `js/story-model.js` and is mirrored in `api/_lib.js`; keep them in step.

Rules (enforced by `npm run check`):

- `ageGroup` is one of `0-2`, `3-5`, `6-8`, `9-10`. `category` must be a
  `categories` id, and every value in `interests` must be in the `interests` list.
- Each page has `scene` (the image brief), `caption`, `speech` and `cast`.
  `cast` lists who is drawn: `hero`, `sk` (the sidekick), `family` (everyone
  added) or `c1`–`c5`.
- Captions may use `{hero}`, `{family}`, `{their}`, `{them}` and `{Their}`.
  Speech may also use `{c2}`–`{c5}`. Speaker `who` may be `hero`, `sk`, or `c1`–`c5`.
- `scene` describes the picture only. Never ask for text in it.

Pricing lives in `data/pricing.json`. A book includes 15 pages in its format
price, and each extra page costs ₹200. A bundle is three books, with
`bundle.discountPercent` off the total. The server works out every price.

## Known limits of phase one

- The finished book lives in the customer's browser (IndexedDB). If they pay
  on one device and open the success link on another, the page explains this
  and gives an order reference. Server-side storage of drafts would fix it
  (see roadmap).
- The watermark is a deterrent, not DRM — a technical user could pull the
  unwatermarked pages out of their own browser. AI illustration is the
  costly part, and it's already been paid for at preview time, so the real
  protection is the spend limit.
- AI likeness quality depends on the model and the photo. Clear, front-facing
  photos work best; the FAQ says so.

## Phase two ideas

- Customer accounts, saved drafts across devices, "regenerate this panel".
- Custom stories: parent types a theme ("Riya's first day at school") and
  Claude writes a story in the `stories.json` format.
- Hindi and regional languages (story text is already data, so it's
  translation work, not code).
- Print-on-demand API integration so print orders go out without manual steps.
- Gift cards, bundles (birthday + festival books), a referral discount.
