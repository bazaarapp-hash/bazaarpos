// ─── GANTI nilai firebaseConfig dengan punya kamu dari Firebase Console ───────
import { initializeApp } from "firebase/app";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc,
  collection, query, where, getDocs, onSnapshot, writeBatch, startsWith
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

// ─── Semua data tetap di koleksi "bazaarpos" (rules sudah ada) ────────────────
// Koleksi besar → tiap item = dokumen terpisah dengan prefix
// Contoh: bzr_transactions/item:TXN001, bzr_transactions/item:TXN002
// Koleksi kecil → tetap 1 dokumen JSON seperti sebelumnya
const BIG = new Set([
  "bzr_transactions",
  "bzr_wallet_logs",
  "bzr_orders",
  "bzr_customers",
]);

// Prefix untuk membedakan item individual vs config
const ITEM_PREFIX = "item:";
const META_SUFFIX = ":META";

// ─── Batch write helper ───────────────────────────────────────────────────────
async function doBatch(ops) {
  if (!ops.length) return;
  const LIMIT = 490;
  for (let i = 0; i < ops.length; i += LIMIT) {
    const batch = writeBatch(firestore);
    ops.slice(i, i + LIMIT).forEach(({ type, ref, data }) => {
      if (type === "set")    batch.set(ref, data);
      if (type === "delete") batch.delete(ref);
    });
    await batch.commit();
  }
}

export const db = {
  // ── READ ──────────────────────────────────────────────────────────────────
  async get(key) {
    try {
      if (BIG.has(key)) {
        // Ambil index dulu
        const meta = await getDoc(doc(firestore, "bazaarpos", key + META_SUFFIX));
        if (!meta.exists()) return [];
        const ids = meta.data().ids || [];
        if (!ids.length) return [];
        // Fetch individual items
        const items = await Promise.all(
          ids.map(id => getDoc(doc(firestore, "bazaarpos", key + ITEM_PREFIX + id)))
        );
        return items.filter(s => s.exists()).map(s => s.data());
      } else {
        const snap = await getDoc(doc(firestore, "bazaarpos", key));
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
        const newMap = {};
        newArr.forEach(item => { if (item?.id) newMap[item.id] = item; });
        const newIds = Object.keys(newMap);

        // Ambil index lama
        const meta = await getDoc(doc(firestore, "bazaarpos", key + META_SUFFIX));
        const oldIds = meta.exists() ? (meta.data().ids || []) : [];
        const oldIdSet = new Set(oldIds);
        const newIdSet = new Set(newIds);

        const ops = [];

        // Upsert item baru/berubah
        for (const [id, item] of Object.entries(newMap)) {
          ops.push({
            type: "set",
            ref: doc(firestore, "bazaarpos", key + ITEM_PREFIX + id),
            data: item,
          });
        }

        // Hapus item yang dihilangkan
        for (const id of oldIds) {
          if (!newIdSet.has(id)) {
            ops.push({ type: "delete", ref: doc(firestore, "bazaarpos", key + ITEM_PREFIX + id) });
          }
        }

        // Update index
        ops.push({
          type: "set",
          ref: doc(firestore, "bazaarpos", key + META_SUFFIX),
          data: { ids: newIds, updatedAt: new Date().toISOString() },
        });

        await doBatch(ops);

      } else {
        // Dokumen tunggal — sama seperti sebelumnya
        await setDoc(doc(firestore, "bazaarpos", key), {
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
        // Listen ke META dokumen untuk tau kalau ada perubahan
        const metaRef = doc(firestore, "bazaarpos", key + META_SUFFIX);
        let itemUnsubs = [];

        const metaUnsub = onSnapshot(metaRef, async (metaSnap) => {
          // Cleanup listener lama
          itemUnsubs.forEach(u => u());
          itemUnsubs = [];

          if (!metaSnap.exists()) { callback([]); return; }
          const ids = metaSnap.data().ids || [];
          if (!ids.length) { callback([]); return; }

          // Fetch semua item saat ini
          const items = await Promise.all(
            ids.map(id => getDoc(doc(firestore, "bazaarpos", key + ITEM_PREFIX + id)))
          );
          callback(items.filter(s => s.exists()).map(s => s.data()));
        }, (e) => console.error("db.subscribe error:", key, e));

        return () => {
          metaUnsub();
          itemUnsubs.forEach(u => u());
        };

      } else {
        // Dokumen tunggal — sama seperti sebelumnya
        return onSnapshot(
          doc(firestore, "bazaarpos", key),
          (snap) => {
            if (!snap.exists()) { callback(null); return; }
            try { callback(JSON.parse(snap.data().value)); }
            catch (e) { callback(null); }
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
