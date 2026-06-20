// ─── GANTI nilai firebaseConfig dengan punya kamu dari Firebase Console ───────
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";

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

export const db = {
  async get(key) {
    try {
      const snap = await getDoc(doc(firestore, "bazaarpos", key));
      if (!snap.exists()) return null;
      return JSON.parse(snap.data().value);
    } catch (e) {
      console.error("Firebase get error:", e);
      return null;
    }
  },

  async set(key, value) {
    const payload = JSON.stringify(value);
    // Peringatan dini jika dokumen mendekati limit 1MB Firestore
    if (payload.length > 900000) {
      console.warn(`⚠️ Dokumen "${key}" sudah ${(payload.length/1024).toFixed(0)}KB — mendekati limit 1MB Firestore!`);
    }
    // Retry sampai 3x jika gagal (mengatasi koneksi tidak stabil di lokasi event)
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await setDoc(doc(firestore, "bazaarpos", key), {
          value: payload,
          updatedAt: new Date().toISOString(),
        });
        return true; // sukses
      } catch (e) {
        lastErr = e;
        console.error(`Firebase set error (percobaan ${attempt}/3):`, e);
        if (attempt < 3) await new Promise(r => setTimeout(r, 800 * attempt));
      }
    }
    // Gagal setelah 3x percobaan — lempar error agar caller TAHU dan TIDAK lanjut
    throw new Error(`Gagal menyimpan data "${key}" ke database setelah 3x percobaan: ${lastErr?.message || lastErr}`);
  },

  subscribe(key, callback) {
    const ref = doc(firestore, "bazaarpos", key);
    return onSnapshot(ref, (snap) => {
      if (!snap.exists()) { callback(null); return; }
      try { callback(JSON.parse(snap.data().value)); }
      catch (e) { callback(null); }
    }, (e) => {
      console.error("Firebase subscribe error:", e);
    });
  },
};
