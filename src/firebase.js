// ─── GANTI nilai firebaseConfig dengan punya kamu dari Firebase Console 85───────
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, getDocFromServer, setDoc, onSnapshot, runTransaction } from "firebase/firestore";

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
    if (payload.length > 900000) {
      console.warn(`⚠️ Dokumen "${key}" sudah ${(payload.length/1024).toFixed(0)}KB — mendekati limit 1MB Firestore!`);
    }
    // ── SATU KALI percobaan saja, TANPA retry ──────────────────────────────────
    // Alasan: setDoc menulis seluruh dokumen sekaligus (overwrite). Jika kita retry
    // dan percobaan pertama ternyata sudah commit di server (tapi konfirmasi hilang
    // di jaringan), retry akan menulis data yang SAMA → tidak berbahaya untuk set().
    // Tapi untuk konsistensi dan menghindari race condition, kita tetap 1x saja.
    await setDoc(doc(firestore, "bazaarpos", key), {
      value: payload,
      updatedAt: new Date().toISOString(),
    });
    return true;
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

  // ── Cek konektivitas cepat ke server — SATU KALI ping, ukur latency ─────────
  // Return false kalau:
  //   (a) tidak bisa terhubung sama sekali (timeout/error), ATAU
  //   (b) bisa terhubung tapi latency > 1500ms — jaringan terlalu lambat untuk
  //       transaksi finansial yang aman, lebih baik ditolak daripada hang lama.
  async ping(timeoutMs = 2500) {
    const start = Date.now();
    try {
      await Promise.race([
        getDocFromServer(doc(firestore, "bazaarpos", "bzr_settings")),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ]);
      const latency = Date.now() - start;
      return latency <= 1500; // false kalau lambat > 1.5 detik
    } catch (e) {
      return false;
    }
  },

  // ── Update saldo pelanggan secara ATOMIK — SATU KALI PERCOBAAN, TANPA RETRY ──
  //
  // MENGAPA TIDAK BOLEH RETRY:
  // Ketika kita melakukan Promise.race antara runTransaction dan timeout, lalu
  // timeout menang → client membatalkan PENANTIAN-nya, tapi runTransaction di
  // Firestore SDK terus jalan di background dan bisa saja commit ke server.
  // Kalau kita retry, kita akan memiliki DUA runTransaction yang berjalan
  // bersamaan — keduanya membaca saldo SEBELUM satupun commit, sehingga
  // keduanya menambah saldo dari titik yang sama → saldo bertambah DUA KALI
  // dari satu aksi kasir. Inilah bug "top up masuk 3x" yang terjadi di lapangan.
  //
  // DENGAN 1x PERCOBAAN: paling buruk, 1 transaksi "ghost" commit tapi kasir
  // lihat pesan "Gagal". Kasir cek riwayat → ternyata sudah masuk → tidak perlu
  // ulangi. Jauh lebih aman daripada 3 transaksi masuk tanpa sadar.
  async updateCustomerBalance(customerId, deltaOrFn, buildLogEntry, extraCustFields = {}) {
    const operationId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const custRef = doc(firestore, "bazaarpos", "bzr_customers");
    const logRef = doc(firestore, "bazaarpos", "bzr_wallet_logs");
    let resultCust = null;
    let resultLog = null;

    await runTransaction(firestore, async (transaction) => {
      const custSnap = await transaction.get(custRef);
      const logSnap = await transaction.get(logRef);
      const customers = custSnap.exists() ? JSON.parse(custSnap.data().value) : [];
      const walletLogs = logSnap.exists() ? JSON.parse(logSnap.data().value) : [];

      const idx = customers.findIndex(c => c.id === customerId);
      if (idx === -1) throw new Error("Pelanggan tidak ditemukan (mungkin baru dihapus).");

      // Proteksi idempotency: kalau operasi ini sudah commit sebelumnya (jaringan
      // lambat → client timeout → tapi server sudah commit), jangan ulangi delta.
      const existingLog = walletLogs.find(l => l.operationId === operationId);
      if (existingLog) {
        resultCust = customers[idx];
        resultLog = existingLog;
        return;
      }

      const balBefore = customers[idx].balance;
      const balAfter = typeof deltaOrFn === "function" ? deltaOrFn(balBefore) : balBefore + deltaOrFn;
      if (balAfter < 0) {
        throw new Error(`Saldo tidak cukup! Saldo saat ini: Rp ${balBefore.toLocaleString("id-ID")} (mungkin sudah berubah sejak halaman dibuka).`);
      }

      customers[idx] = { ...customers[idx], ...extraCustFields, balance: balAfter };
      const logEntry = buildLogEntry(balBefore, balAfter);
      if (logEntry) logEntry.operationId = operationId;
      const newLogs = logEntry ? [logEntry, ...walletLogs] : walletLogs;

      transaction.set(custRef, { value: JSON.stringify(customers), updatedAt: new Date().toISOString() });
      if (logEntry) {
        transaction.set(logRef, { value: JSON.stringify(newLogs), updatedAt: new Date().toISOString() });
      }
      resultCust = customers[idx];
      resultLog = logEntry;
    });

    return { customer: resultCust, logEntry: resultLog };
  },

  // ── Tambah pelanggan baru ATOMIK — SATU KALI PERCOBAAN, TANPA RETRY ──────────
  // Alasan sama seperti updateCustomerBalance di atas.
  async addNewCustomer(newCustomer, buildLogEntry) {
    const operationId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const custRef = doc(firestore, "bazaarpos", "bzr_customers");
    const logRef = doc(firestore, "bazaarpos", "bzr_wallet_logs");

    await runTransaction(firestore, async (transaction) => {
      const custSnap = await transaction.get(custRef);
      const logSnap = await transaction.get(logRef);
      const customers = custSnap.exists() ? JSON.parse(custSnap.data().value) : [];
      const walletLogs = logSnap.exists() ? JSON.parse(logSnap.data().value) : [];

      const dup = customers.find(c => c.phone === newCustomer.phone);
      if (dup) {
        if (dup.createdOpId === operationId) return; // hasil percobaan kita sendiri
        throw new Error("Nomor HP sudah terdaftar (mungkin baru saja didaftarkan device lain).");
      }
      const newCustomers = [...customers, { ...newCustomer, createdOpId: operationId }];
      const logEntry = buildLogEntry();
      if (logEntry) logEntry.operationId = operationId;
      const newLogs = logEntry ? [logEntry, ...walletLogs] : walletLogs;
      transaction.set(custRef, { value: JSON.stringify(newCustomers), updatedAt: new Date().toISOString() });
      if (logEntry) {
        transaction.set(logRef, { value: JSON.stringify(newLogs), updatedAt: new Date().toISOString() });
      }
    });

    return true;
  },
};
