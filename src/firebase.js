// ─── GANTI nilai firebaseConfig dengan punya kamu dari Firebase Console ───────
import { initializeApp } from "firebase/app";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc,
  collection, getDocs, onSnapshot, writeBatch, query, orderBy
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAA0tOPK_hXLLxCJ_aOrNC_--dMv05qkv8",
  authDomain: "bazaarpos-8d302.firebaseapp.com",
  projectId: "bazaarpos-8d302",
  storageBucket: "bazaarpos-8d302.firebasestorage.app",
  messagingSenderId: "253411988957",
  appId: "1:253411988957:web:3cea911f6112df072cd234"
};

const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);

// ─── Koleksi besar → tiap item = 1 dokumen Firestore (scalable) ───────────────
// Koleksi kecil → tetap 1 dokumen JSON (settings, tenant, menu, dll)
const BIG_COLLECTIONS = new Set([
  "bzr_transactions",
  "bzr_wallet_logs",
  "bzr_orders",
  "bzr_customers",
]);

// ─── Helper: batch write max 500 operasi per batch ───────────────────────────
async function batchWrite(ops) {
  const LIMIT = 490;
  for (let i = 0; i < ops.length; i += LIMIT) {
    const batch = writeBatch(firestore);
    ops.slice(i, i + LIMIT).forEach(({ type, ref, data }) => {
      if (type === "set") batch.set(ref, data);
      else if (type === "delete") batch.delete(ref);
    });
    await batch.commit();
  }
}

export const db = {
  // ── GET: baca data ──────────────────────────────────────────────────────────
  async get(key) {
    try {
      if (BIG_COLLECTIONS.has(key)) {
        // Query semua dokumen di koleksi
        const snap = await getDocs(collection(firestore, key));
        if (snap.empty) return [];
        return snap.docs.map(d => d.data());
      } else {
        // Dokumen tunggal
        const snap = await getDoc(doc(firestore, "bzr_config", key));
        if (!snap.exists()) return null;
        return JSON.parse(snap.data().value);
      }
    } catch (e) {
      console.error("Firebase get error:", key, e);
      return BIG_COLLECTIONS.has(key) ? [] : null;
    }
  },

  // ── SET: simpan data ────────────────────────────────────────────────────────
  async set(key, value) {
    try {
      if (BIG_COLLECTIONS.has(key)) {
        const newArray = Array.isArray(value) ? value : [];
        const newMap = {};
        newArray.forEach(item => { if (item?.id) newMap[item.id] = item; });

        // Ambil ID yang sudah ada
        const existing = await getDocs(collection(firestore, key));
        const existingIds = new Set(existing.docs.map(d => d.id));
        const newIds = new Set(Object.keys(newMap));

        const ops = [];

        // Set/update item baru atau yang berubah
        for (const [id, item] of Object.entries(newMap)) {
          ops.push({
            type: "set",
            ref: doc(firestore, key, id),
            data: { ...item, _updatedAt: new Date().toISOString() },
          });
        }

        // Hapus item yang dihilangkan dari array
        for (const id of existingIds) {
          if (!newIds.has(id)) {
            ops.push({ type: "delete", ref: doc(firestore, key, id) });
          }
        }

        if (ops.length > 0) await batchWrite(ops);
      } else {
        // Dokumen tunggal
        await setDoc(doc(firestore, "bzr_config", key), {
          value: JSON.stringify(value),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error("Firebase set error:", key, e);
    }
  },

  // ── SUBSCRIBE: real-time listener ──────────────────────────────────────────
  subscribe(key, callback) {
    try {
      if (BIG_COLLECTIONS.has(key)) {
        // Listen ke seluruh koleksi — hanya kirim diff yang berubah
        return onSnapshot(
          collection(firestore, key),
          (snap) => {
            const items = snap.docs.map(d => {
              const data = d.data();
              delete data._updatedAt;
              return data;
            });
            callback(items);
          },
          (e) => { console.error("Firebase subscribe error:", key, e); }
        );
      } else {
        // Listen ke dokumen tunggal
        return onSnapshot(
          doc(firestore, "bzr_config", key),
          (snap) => {
            if (!snap.exists()) { callback(null); return; }
            try { callback(JSON.parse(snap.data().value)); }
            catch (e) { console.error("Firebase parse error:", key, e); callback(null); }
          },
          (e) => { console.error("Firebase subscribe error:", key, e); }
        );
      }
    } catch (e) {
      console.error("Firebase subscribe setup error:", key, e);
      return () => {};
    }
  },
};
