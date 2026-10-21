// Walks waiting to be uploaded, kept in this browser (IndexedDB) so a walk is
// never lost if the network drops or the page closes before the upload ends.

const DB_NAME = "soundroute";
const DB_VERSION = 1;
const STORE = "pendingWalks";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      Promise.resolve(fn(store))
        .then((r) => {
          result = r;
        })
        .catch(reject);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const asPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** walk = { id, name, createdAt, durationS, audioMime, audioBlob, nodes: [...] } */
export function savePendingWalk(walk) {
  return withStore("readwrite", (s) => asPromise(s.put(walk)));
}

export function listPendingWalks() {
  return withStore("readonly", (s) => asPromise(s.getAll()));
}

export function deletePendingWalk(id) {
  return withStore("readwrite", (s) => asPromise(s.delete(id)));
}
