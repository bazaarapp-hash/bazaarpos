// ─── GANTI nilai firebaseConfig dengan punya kamu dari Firebase Console 74───────
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, runTransaction } from "firebase/firestore";

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

  // ── Cek konektivitas cepat ke server — SATU KALI ping saja (tidak retry) ────
  // Dipakai SEBELUM transaksi apapun dimulai — kalau server tidak terjangkau dalam
  // 2.5 detik, langsung dianggap gagal, tanpa menunggu lama dan tanpa menghapus
  // data orderan/keranjang yang sudah diisi kasir.
  async ping(timeoutMs = 2500) {
    try {
      await Promise.race([
        getDoc(doc(firestore, "bazaarpos", "bzr_settings")),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ]);
      return true;
    } catch (e) {
      return false;
    }
  },

  // ── Update saldo pelanggan secara ATOMIK (anti race-condition) ──────────────
  // Dipakai untuk SEMUA perubahan saldo: top up, bayar transaksi, refund, kosongkan saldo.
  // Menggunakan Firestore runTransaction: baca-ubah-tulis terjadi sebagai satu unit
  // di server, dan otomatis di-retry kalau ada device lain menulis di waktu bersamaan.
  // Ini mencegah kasus "saldo ketimpa" saat top up & transaksi terjadi nyaris bersamaan.
  async updateCustomerBalance(customerId, deltaOrFn, buildLogEntry, extraCustFields = {}) {
    const custRef = doc(firestore, "bazaarpos", "bzr_customers");
    const logRef = doc(firestore, "bazaarpos", "bzr_wallet_logs");
    let resultCust = null;
    let resultLog = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await runTransaction(firestore, async (transaction) => {
          const custSnap = await transaction.get(custRef);
          const logSnap = await transaction.get(logRef);
          const customers = custSnap.exists() ? JSON.parse(custSnap.data().value) : [];
          const walletLogs = logSnap.exists() ? JSON.parse(logSnap.data().value) : [];

          const idx = customers.findIndex(c => c.id === customerId);
          if (idx === -1) throw new Error("Pelanggan tidak ditemukan (mungkin baru dihapus).");

          const balBefore = customers[idx].balance;
          // deltaOrFn bisa berupa angka (tambah/kurang) atau fungsi (balBefore => balAfter) untuk set absolut
          const balAfter = typeof deltaOrFn === "function" ? deltaOrFn(balBefore) : balBefore + deltaOrFn;
          if (balAfter < 0) {
            throw new Error(`Saldo tidak cukup! Saldo saat ini: Rp ${balBefore.toLocaleString("id-ID")} (mungkin sudah berubah sejak halaman dibuka).`);
          }

          customers[idx] = { ...customers[idx], ...extraCustFields, balance: balAfter };
          const logEntry = buildLogEntry(balBefore, balAfter);
          const newLogs = logEntry ? [logEntry, ...walletLogs] : walletLogs;

          transaction.set(custRef, { value: JSON.stringify(customers), updatedAt: new Date().toISOString() });
          if (logEntry) {
            transaction.set(logRef, { value: JSON.stringify(newLogs), updatedAt: new Date().toISOString() });
          }
          resultCust = customers[idx];
          resultLog = logEntry;
        });
        return { customer: resultCust, logEntry: resultLog }; // sukses
      } catch (e) {
        lastErr = e;
        // Error bisnis (saldo tidak cukup / pelanggan tidak ada) — jangan retry, lempar langsung
        if (e.message && (e.message.includes("Saldo tidak cukup") || e.message.includes("tidak ditemukan"))) {
          throw e;
        }
        console.error(`Transaksi saldo gagal (percobaan ${attempt}/3):`, e);
        if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt));
      }
    }
    throw new Error(`Gagal update saldo setelah 3x percobaan: ${lastErr?.message || lastErr}`);
  },

  // ── Tambah pelanggan baru ATOMIK (untuk top up pelanggan baru) ──────────────
  async addNewCustomer(newCustomer, buildLogEntry) {
    const custRef = doc(firestore, "bazaarpos", "bzr_customers");
    const logRef = doc(firestore, "bazaarpos", "bzr_wallet_logs");
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await runTransaction(firestore, async (transaction) => {
          const custSnap = await transaction.get(custRef);
          const logSnap = await transaction.get(logRef);
          const customers = custSnap.exists() ? JSON.parse(custSnap.data().value) : [];
          const walletLogs = logSnap.exists() ? JSON.parse(logSnap.data().value) : [];
          if (customers.find(c => c.phone === newCustomer.phone)) {
            throw new Error("Nomor HP sudah terdaftar (mungkin baru saja didaftarkan device lain).");
          }
          const newCustomers = [...customers, newCustomer];
          const logEntry = buildLogEntry();
          const newLogs = logEntry ? [logEntry, ...walletLogs] : walletLogs;
          transaction.set(custRef, { value: JSON.stringify(newCustomers), updatedAt: new Date().toISOString() });
          if (logEntry) {
            transaction.set(logRef, { value: JSON.stringify(newLogs), updatedAt: new Date().toISOString() });
          }
        });
        return true;
      } catch (e) {
        lastErr = e;
        if (e.message && e.message.includes("sudah terdaftar")) throw e;
        console.error(`Tambah pelanggan gagal (percobaan ${attempt}/3):`, e);
        if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt));
      }
    }
    throw new Error(`Gagal tambah pelanggan setelah 3x percobaan: ${lastErr?.message || lastErr}`);
  },
};
