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
| 9 stories, 4 age bands (0–2, 3–5, 6–8, 9–10), 59 comic panels | `data/stories.json` |
| 5-step creator: story → hero (name, age, pronouns, art style, dedication) → photos (hero + up to 5, with crop/zoom, consent) → full preview → format | `create.html`, `js/create.js` |
| Comic renderer: cover, dedication, panel layouts per age, captions, speech bubbles, "The End" page, watermark | `js/comic.js` |
| AI illustration of every panel from the photos (optional) | `api/generate.js` |
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

## Adding a story

Add an object to `data/stories.json` and run `npm run check`. Rules (enforced
by the check script):

- `ageGroup` is one of `0-2`, `3-5`, `6-8`, `9-10` — it sets the layout (1, 2
  or 3 panels per page) and text size.
- `{hero}` = child's name; `{c1}`…`{c5}` = family members in upload order;
  `{family}` = everyone added; `{their}` / `{them}` / `{Their}` = pronouns.
  Don't write a pronoun as the subject of a verb ("{they} is"), so the
  grammar works for she/he/they.
- **Captions** may only use `{hero}`, `{c1}`, `{family}` and pronouns. `{c1}`
  becomes the story's `sidekick` when no family was added, so captions always
  read correctly.
- `cast` / `speech` entries for `c2`–`c5` are dropped automatically if that
  person wasn't added. `"family"` in `cast` means everyone who was added.
- `scene` is the brief for the image model — describe the picture, never ask
  for text in it.

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
