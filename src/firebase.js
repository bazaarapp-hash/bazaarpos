// ─── GANTI nilai firebaseConfig dengan punya kamu dari Firebase Console ───────
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

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
  // get: kembalikan nilai yang sudah di-parse langsung (array/object)
  // bukan { value: "..." } — App.jsx butuh array/object langsung
  async get(key) {
    try {
      const snap = await getDoc(doc(firestore, "bazaarpos", key));
      if (!snap.exists()) return null;
      const raw = snap.data().value;
      return JSON.parse(raw); // kembalikan array/object langsung
    } catch (e) {
      console.error("Firebase get error:", e);
      return null;
    }
  },

  // set: terima array/object, simpan sebagai JSON string ke Firestore
  async set(key, value) {
    try {
      await setDoc(doc(firestore, "bazaarpos", key), {
        value: JSON.stringify(value), // selalu stringify sebelum simpan
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Firebase set error:", e);
    }
  },
};
