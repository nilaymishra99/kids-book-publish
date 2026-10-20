// After checkout: confirm payment, unlock the watermark-free book, offer the
// PDF download and (for print orders) send the finished pages to storage.

import { BRAND, loadData, loadConfig } from "./common.js";
import { renderBook } from "./comic.js";
import { getBook } from "./store.js";

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
    return { paid: true, demo: true, bookId: params.get("book"), format, orderRef: "DEMO" };
  }
  throw new Error("This page needs an order reference. Did you mean to start a new comic?");
}

async function uploadPages(order, pages) {
  const doneKey = `ll:uploaded:${order.sessionId}`;
  const status = $("#upload-status");
  status.hidden = false;
  if (localStorage.getItem(doneKey)) {
    status.textContent = "✅ Your pages are with our print team.";
    return;
  }
  for (let i = 0; i < pages.length; i++) {
    status.textContent = `Sending your pages to the printer… ${i + 1} / ${pages.length}. Please keep this page open.`;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const res = await fetch("/api/save-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: order.sessionId, page: i, image: pages[i] }),
      }).catch(() => null);
      ok = Boolean(res?.ok);
    }
    if (!ok) {
      status.textContent = `We couldn't send page ${i + 1} to the printer. Please refresh this page to try again — or email us with order ref ${order.orderRef}.`;
      status.classList.add("error");
      return;
    }
  }
  localStorage.setItem(doneKey, "1");
  status.textContent = "✅ All pages sent to our print team. We'll email you when it ships!";
}

try {
  const order = await lookupOrder();
  if (!order.paid) throw new Error("Your payment hasn't gone through yet. If you were charged, please contact us with your order ref.");

  const book = order.bookId ? await getBook(order.bookId).catch(() => null) : null;
  const { stories } = await loadData();
  const story = book && stories.find((s) => s.id === book.storyId);
  if (!book || !story) {
    throw new Error(
      `Your payment worked (order ref ${order.orderRef}), but this browser doesn't have the comic you made. Please open this link on the same device and browser you used to create it, or email us with your order ref and we'll sort it out.`
    );
  }

  const pages = await renderBook(book, story, { watermark: false, brand: BRAND, quality: 0.92 });

  $("#done-title").textContent = `${book.hero.name}'s comic is ready!`;
  $("#done-sub").textContent = order.format?.print
    ? `Your ${order.format.name.toLowerCase()} is being prepared. Your digital copy is below. Order ref: ${order.orderRef}`
    : `Here's your digital comic. Order ref: ${order.orderRef}`;
  $("#pages").innerHTML = pages.map((src, i) => `<img src="${src}" alt="Page ${i + 1}" style="width:150px;border:3px solid var(--line);border-radius:6px">`).join("");
  $("#print-pages").innerHTML = pages.map((src) => `<img src="${src}" alt="">`).join("");
  $("#download").addEventListener("click", () => window.print());
  $("#loading").hidden = true;
  $("#done").hidden = false;

  if (order.format?.print && !order.demo) await uploadPages(order, pages);
} catch (err) {
  problem(err.message);
}
