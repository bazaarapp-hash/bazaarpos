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
    try {
      await setDoc(doc(firestore, "bazaarpos", key), {
        value: JSON.stringify(value),
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Firebase set error:", e);
    }
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
