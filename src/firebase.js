// ─── GANTI nilai firebaseConfig dengan punya kamu dari Firebase Console ───────
import { initializeApp } from "firebase/app";
import {
  getFirestore, doc, getDoc, setDoc,
  collection, getDocs, onSnapshot, writeBatch
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

// ─── Koleksi besar → tiap item = 1 dokumen (scalable, no 1MB limit) ──────────
const BIG = new Set([
  "bzr_transactions",
  "bzr_wallet_logs",
  "bzr_orders",
  "bzr_customers",
]);

// ─── Batch write helper (max 490 ops per batch) ───────────────────────────────
async function doBatch(ops) {
  if (!ops.length) return;
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
  // ── READ ──────────────────────────────────────────────────────────────────
  async get(key) {
    try {
      if (BIG.has(key)) {
        const snap = await getDocs(collection(firestore, key));
        return snap.empty ? [] : snap.docs.map(d => {
          const data = { ...d.data() };
          delete data._ts;
          return data;
        });
      } else {
        const snap = await getDoc(doc(firestore, "bzr_config", key));
        if (!snap.exists()) return null;
        return JSON.parse(snap.data().value);
      }
    } catch (e) {
      console.error("db.get error:", key, e);
      return BIG.has(key) ? [] : null;
    }
  },

  // ── WRITE ─────────────────────────────────────────────────────────────────
  async set(key, value) {
    try {
      if (BIG.has(key)) {
        const newArr = Array.isArray(value) ? value : [];

        // Build map of new items
        const newMap = {};
        newArr.forEach(item => { if (item?.id) newMap[item.id] = item; });

        // Get existing IDs from Firestore
        const existing = await getDocs(collection(firestore, key));
        const existingIds = new Set(existing.docs.map(d => d.id));
        const newIds = new Set(Object.keys(newMap));

        const ops = [];

        // Upsert new/changed items
        for (const [id, item] of Object.entries(newMap)) {
          ops.push({
            type: "set",
            ref: doc(firestore, key, id),
            data: { ...item, _ts: new Date().toISOString() },
          });
        }

        // Delete removed items
        for (const id of existingIds) {
          if (!newIds.has(id)) {
            ops.push({ type: "delete", ref: doc(firestore, key, id) });
          }
        }

        await doBatch(ops);

      } else {
        await setDoc(doc(firestore, "bzr_config", key), {
          value: JSON.stringify(value),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error("db.set error:", key, e);
    }
  },

  // ── SUBSCRIBE (real-time) ─────────────────────────────────────────────────
  subscribe(key, callback) {
    try {
      if (BIG.has(key)) {
        // Firestore hanya kirim DIFF yang berubah — sangat hemat bandwidth
        return onSnapshot(
          collection(firestore, key),
          (snap) => {
            const items = snap.docs.map(d => {
              const data = { ...d.data() };
              delete data._ts;
              return data;
            });
            callback(items);
          },
          (e) => console.error("db.subscribe error:", key, e)
        );
      } else {
        return onSnapshot(
          doc(firestore, "bzr_config", key),
          (snap) => {
            if (!snap.exists()) { callback(null); return; }
            try { callback(JSON.parse(snap.data().value)); }
            catch (e) { console.error("db.subscribe parse error:", key, e); callback(null); }
          },
          (e) => console.error("db.subscribe error:", key, e)
        );
      }
    } catch (e) {
      console.error("db.subscribe setup error:", key, e);
      return () => {};
    }
  },
};
