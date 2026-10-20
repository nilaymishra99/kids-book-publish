// After checkout: confirm payment, unlock the watermark-free book(s), offer
// PDF downloads and (for print orders) send each book's pages to storage.

import { BRAND, loadData, loadConfig, esc } from "./common.js";
import { renderBook } from "./comic.js";
import { openReader } from "./reader.js";
import { getBook, getBooksByBundle } from "./store.js";

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

function problem(msg) {
  $("#loading").hidden = true;
  $("#problem").hidden = false;
  $("#problem-msg").textContent = msg;
}

async function lookupOrder() {
  const sessionId = params.get("session_id");
  if (sessionId) {
    const res = await fetch(`/api/order?session_id=${encodeURIComponent(sessionId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "We couldn't find that order.");
    return { ...data, sessionId };
  }
  // Demo mode is only honoured when the server says checkout is in demo mode.
  const config = await loadConfig();
  if (params.get("demo") === "1" && config.checkout === "demo") {
    const { pricing } = await loadData();
    const format = pricing.formats.find((f) => f.id === params.get("format")) || pricing.formats[0];
    return {
      paid: true,
      demo: true,
      bookId: params.get("book"),
      bundleId: params.get("bundle"),
      format,
      orderRef: "DEMO",
    };
  }
  throw new Error("This page needs an order reference. Did you mean to start a new comic?");
}

async function uploadPages(order, bookId, pages) {
  const doneKey = `ll:uploaded:${order.sessionId}:${bookId}`;
  const status = $("#upload-status");
  status.hidden = false;
  if (localStorage.getItem(doneKey)) return true;
  for (let i = 0; i < pages.length; i++) {
    status.textContent = `Sending pages to the printer… ${i + 1} / ${pages.length}. Please keep this page open.`;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const res = await fetch("/api/save-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: order.sessionId, bookId, page: i, image: pages[i] }),
      }).catch(() => null);
      ok = Boolean(res?.ok);
    }
    if (!ok) {
      status.textContent = `We couldn't send page ${i + 1} to the printer. Please refresh this page to try again, or email us with order ref ${order.orderRef}.`;
      status.classList.add("error");
      return false;
    }
  }
  localStorage.setItem(doneKey, "1");
  return true;
}

function downloadBook(pages) {
  $("#print-pages").innerHTML = pages.map((src) => `<img src="${src}" alt="">`).join("");
  window.print();
}

try {
  const order = await lookupOrder();
  if (!order.paid) throw new Error("Your payment hasn't gone through yet. If you were charged, please contact us with your order ref.");

  const { stories } = await loadData();
  const books = order.bundleId
    ? await getBooksByBundle(order.bundleId)
    : [await getBook(order.bookId).catch(() => null)].filter(Boolean);
  const ready = books.filter((b) => stories.some((s) => s.id === b.storyId));
  if (!ready.length) {
    throw new Error(
      `Your payment worked (order ref ${order.orderRef}), but this browser doesn't have the comic you made. Please open this link on the same device and browser you used to create it, or email us with your order ref and we'll sort it out.`
    );
  }

  const isBundle = Boolean(order.bundleId);
  $("#done-title").textContent = isBundle ? `Your ${ready.length}-book bundle is ready!` : `${ready[0].hero.name}'s comic is ready!`;
  $("#done-sub").textContent = order.format?.print
    ? `Your ${order.format.name.toLowerCase()} ${isBundle ? "bundle is" : "is"} being prepared. Your digital copy is below. Order ref: ${order.orderRef}`
    : `Here's your digital ${isBundle ? "bundle" : "comic"}. Order ref: ${order.orderRef}`;
  $("#download").hidden = true;

  const rendered = [];
  for (const book of ready) {
    const story = stories.find((s) => s.id === book.storyId);
    const pages = await renderBook(book, story, { watermark: false, brand: BRAND, quality: 0.92 });
    rendered.push({ book, story, pages });
  }

  $("#pages").innerHTML = rendered
    .map(
      ({ book, story, pages }, i) => `
      <div class="card book-card">
        <h3>${esc(story.title.replace("{hero}", book.hero.name))}</h3>
        <p class="hint">${pages.length} pages</p>
        <div class="thumbs" style="justify-content:center">
          ${pages.slice(0, 4).map((src, p) => `<img src="${src}" alt="Page ${p + 1}" style="width:110px;border:2px solid var(--line);border-radius:8px">`).join("")}
        </div>
        <p><button class="btn btn-sm btn-white" data-read="${i}">🎬 Read animated</button> <button class="btn btn-sm" data-book="${i}">Download PDF</button></p>
      </div>`
    )
    .join("");
  $("#pages").addEventListener("click", (e) => {
    const b = e.target.closest("[data-book]");
    if (b) downloadBook(rendered[Number(b.dataset.book)].pages);
    const r = e.target.closest("[data-read]");
    if (r) {
      const { book, story, pages } = rendered[Number(r.dataset.read)];
      openReader(pages, story.title.replace("{hero}", book.hero.name));
    }
  });

  $("#loading").hidden = true;
  $("#done").hidden = false;

  if (order.format?.print && !order.demo) {
    let allOk = true;
    for (const { book, pages } of rendered) {
      allOk = (await uploadPages(order, book.id, pages)) && allOk;
    }
    if (allOk) $("#upload-status").textContent = "✅ All pages sent to our print team. We'll email you when it ships!";
  }
} catch (err) {
  problem(err.message);
}
