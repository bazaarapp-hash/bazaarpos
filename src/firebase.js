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
 
// ─── db object — pengganti window.storage / localStorage ─────────────────────
export const db = {
  async get(key) {
    try {
      const snap = await getDoc(doc(firestore, "bazaarpos", key));
      if (!snap.exists()) return null;
      // Data disimpan sebagai string JSON di field "value"
      return { value: snap.data().value };
    } catch (e) {
      console.error("Firebase get error:", e);
      return null;
    }
  },
 
  async set(key, value) {
    try {
      // value sudah berupa string JSON dari App.jsx (JSON.stringify sudah dipanggil di sana)
      await setDoc(doc(firestore, "bazaarpos", key), {
        value: typeof value === "string" ? value : JSON.stringify(value),
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Firebase set error:", e);
    }
  },
};