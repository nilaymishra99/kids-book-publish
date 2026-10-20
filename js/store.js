// Keeps finished books in this browser's IndexedDB so the success page can
// unlock them after the Stripe redirect. Photos never leave the device except
// to be illustrated (AI mode) or, for paid print orders, as finished pages.

const DB_NAME = "little-legends";
const STORE = "books";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const saveBook = (book) => run("readwrite", (s) => s.put(book));
export const getBook = (id) => run("readonly", (s) => s.get(id));
export const deleteBook = (id) => run("readwrite", (s) => s.delete(id));
