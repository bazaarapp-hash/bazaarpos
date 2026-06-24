import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { db } from "./firebase";

// ─── Fonts & Global Style ─────────────────────────────────────────────────────93
const _fl = document.createElement("link");
_fl.href = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Sora:wght@400;600;700&display=swap";
_fl.rel = "stylesheet"; document.head.appendChild(_fl);
const _gs = document.createElement("style");
_gs.textContent = `
  *{font-family:'Plus Jakarta Sans',sans-serif;box-sizing:border-box}
  h1,h2,h3{font-family:'Sora',sans-serif}
  ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:#f1f1f1}
  ::-webkit-scrollbar-thumb{background:#f97316;border-radius:3px}
  @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  @keyframes slideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
  @keyframes pop{0%{transform:scale(.9);opacity:0}100%{transform:scale(1);opacity:1}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  @keyframes slideDown{from{opacity:0;transform:translateY(-100%)}to{opacity:1;transform:translateY(0)}}
  .spinning{animation:spin .8s linear infinite}
  .fade-in{animation:fadeIn .35s ease forwards}
  .slide-up{animation:slideUp .4s ease forwards}
  .pop-in{animation:pop .25s ease forwards}
  .card-hover{transition:all .2s ease}
  .card-hover:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.1)}
  .btn-press:active{transform:scale(.95)}
  .pulse{animation:pulse 1.8s infinite}
  @keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}
  input[type="date"]{color:#111!important}
  input,textarea,select{color:#111!important;background:#fff!important;-webkit-text-fill-color:#111!important}
  input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus{
    -webkit-text-fill-color:#111!important;
    -webkit-box-shadow:0 0 0 1000px #fff inset!important;
    background-color:#fff!important;
  }
  @media(prefers-color-scheme:dark){
    input,textarea,select{color:#111!important;background:#fff!important}
  }
`;
document.head.appendChild(_gs);

// Placeholder lebih samar agar tidak membingungkan dengan teks yang sudah diinput
const _ph=document.createElement("style");
_ph.textContent=`
  input::placeholder,textarea::placeholder{
    color:#b0b0b0 !important;
    -webkit-text-fill-color:#b0b0b0 !important;
    opacity:1 !important;
    font-style:italic;
    font-weight:400;
  }
`;
document.head.appendChild(_ph);

// ─── Utilities ────────────────────────────────────────────────────────────────
const idr = n => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",minimumFractionDigits:0}).format(n);
const todayStr = () => new Date().toISOString().split("T")[0];
const timeStr = () => new Date().toTimeString().slice(0,5);
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const genNota = (tenantCode, allTx, kasirCode="") => {
  const d = todayStr().replace(/-/g,"");
  const todayTx = allTx.filter(t=>t.tenantCode===tenantCode&&t.date===todayStr());
  if(kasirCode){
    // Hitung urutan per kasir per hari supaya nota tidak tabrakan antar kasir
    const kasirTx = todayTx.filter(t=>t.kasirCode===kasirCode);
    const n = kasirTx.length + 1;
    return `${tenantCode}-${d}-${kasirCode}-${String(n).padStart(3,"0")}`;
  }
  const n = todayTx.length + 1;
  return `${tenantCode}-${d}-${String(n).padStart(3,"0")}`;
};

// ─── Local Backup ─────────────────────────────────────────────────────────────
function doLocalBackup(data) {
  try {
    const keys = Object.keys(localStorage).filter(k=>k.startsWith("bzr_bk_")).sort();
    while(keys.length >= 5) localStorage.removeItem(keys.shift());
    localStorage.setItem(`bzr_bk_${Date.now()}`, JSON.stringify({...data, backupTime: new Date().toISOString()}));
    return true;
  } catch { return false; }
}
function downloadBackup(data) {
  const blob = new Blob([JSON.stringify({...data, backupTime:new Date().toISOString()},null,2)],{type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url;
  a.download=`BazaarPOS_backup_${todayStr()}_${timeStr().replace(":","")}.json`;
  a.click(); URL.revokeObjectURL(url);
}
function getLocalBackups() {
  return Object.keys(localStorage).filter(k=>k.startsWith("bzr_bk_")).sort().reverse().map(k=>{
    try { const d=JSON.parse(localStorage.getItem(k)); return {key:k,time:d.backupTime}; } catch { return null; }
  }).filter(Boolean);
}

// ─── CATATAN: Sistem antrian offline (offQ) DIHAPUS ───────────────────────────
// Sebelumnya ada mekanisme "simpan transaksi di localStorage saat offline, sync
// otomatis saat online". Ini TERBUKTI BERBAHAYA: hanya catatan transaksi yang
// diantrekan, sementara potongan saldo TIDAK ikut diantrekan — kalau device gagal
// sync, transaksi hilang permanen dan saldo tidak pernah ter-update.
// Diganti dengan: cek koneksi ke server SEBELUM transaksi dimulai (db.ping()).
// Kalau server tidak terjangkau, transaksi DITOLAK LANGSUNG dengan pesan jelas,
// dan keranjang/data orderan TETAP UTUH supaya kasir tinggal coba lagi tanpa
// input ulang.

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEF = {
  bazaarName:"Bazaar 2026", receiptFooter1:"Terima kasih!", receiptFooter2:"Selamat menikmati :)",
  saUser:"superadmin", saPass:"superadmin123", resetPass:"reset123",
  autoBackup:false, backupInterval:30,
  fonnteToken:"", bazaarPhone:"",
};

// ─── Payment ──────────────────────────────────────────────────────────────────
const PAY = {
  emoney:{label:"🪙 Saldo",color:"#4c1d95",bg:"#f5f0ff",border:"#c4b5fd"},
  cash:  {label:"🪙 Saldo",color:"#4c1d95",bg:"#f5f0ff",border:"#c4b5fd"},
  wallet:{label:"🪙 Saldo",color:"#4c1d95",bg:"#f5f0ff",border:"#c4b5fd"},
};
// ─── WA Fallback Card — tombol kirim manual saat auto-kirim WA gagal ──────────
// PENTING: window.open() yang dipanggil OTOMATIS setelah `await` (jeda async)
// sering DIBLOKIR popup-blocker browser mobile — perilakunya TIDAK konsisten
// (kadang lolos, kadang diblokir), persis seperti laporan "WA kadang terkirim
// kadang tidak". Solusinya: JANGAN window.open() otomatis, tampilkan tombol
// yang harus diklik LANGSUNG oleh kasir (user-gesture asli) — ini SELALU lolos
// popup-blocker karena trigger-nya klik langsung, bukan dari kode async.
function WaFallbackCard({pending,onDismiss}){
  if(!pending)return null;
  return(
    <div style={{marginTop:10,background:"#fef3c7",border:"2px solid #fbbf24",borderRadius:12,padding:14}}>
      <p style={{margin:"0 0 8px",fontSize:13,fontWeight:700,color:"#92400e"}}>⚠️ {pending.name?`Data ${pending.name} `:""}Sudah tersimpan, tapi WA otomatis gagal terkirim (jaringan kurang baik).</p>
      <button onClick={()=>{
          const waPhone=(pending.phone||"").replace(/\D/g,"");
          const target=waPhone.startsWith("0")?"62"+waPhone.slice(1):(waPhone.startsWith("62")?waPhone:"62"+waPhone);
          window.open(`https://wa.me/${target}?text=${encodeURIComponent(pending.message)}`,"_blank");
          onDismiss();
        }}
        style={{width:"100%",padding:"11px",background:"#16a34a",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
        💬 Kirim WA Manual Sekarang
      </button>
    </div>
  );
}

function PayBadge({method}){
  const p=PAY[method]||PAY.cash;
  return <span style={{background:p.bg,color:p.color,border:`1px solid ${p.border}`,fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20}}>{p.label}</span>;
}

// ─── NetToast — pesan warning jaringan fixed di atas layar ───────────────────
// Pakai Portal ke <body> supaya selalu terlihat di posisi manapun user berada
// di halaman — tidak perlu scroll untuk melihat pesan error jaringan.
function NetToast({msg,onClose}){
  useEffect(()=>{
    if(!msg)return;
    const t=setTimeout(onClose,7000);
    return()=>clearTimeout(t);
  },[msg,onClose]);
  if(!msg)return null;
  return createPortal(
    <div style={{
      position:"fixed",top:0,left:0,right:0,zIndex:999999,
      background:"#dc2626",color:"#fff",
      padding:"13px 52px 13px 16px",
      fontSize:13,fontWeight:700,lineHeight:1.5,
      boxShadow:"0 4px 20px rgba(220,38,38,.45)",
      animation:"slideDown .25s ease",
      fontFamily:"'Plus Jakarta Sans',sans-serif",
    }}>
      ⚠️ {msg}
      <button onClick={onClose} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"rgba(255,255,255,.85)",cursor:"pointer",fontSize:20,lineHeight:1,padding:"4px",fontFamily:"inherit"}}>✕</button>
    </div>,
    document.body
  );
}

// ─── Network Badge — lampu status koneksi ke server di header ────────────────
// Strategi hybrid:
//   (a) navigator.onLine + event listener → deteksi mati TOTAL secara instan
//   (b) visibilitychange → cek ulang saat user kembali ke tab/app
//   (c) Interval ADAPTIF:
//       • Status HIJAU → 60 detik (hemat Firestore reads, jaringan sudah baik)
//       • Status MERAH → 10 detik (cepat recover saat jaringan pulih kembali)
//       Ini mengatasi kasus sinyal buruk-tapi-terhubung yang tidak memicu event
//       online/offline, sehingga badge bisa recover dalam ≤10 detik bukan ~60 detik.
function NetworkBadge({onCheckConnection}){
  const [status,setStatus]=useState(navigator.onLine?"checking":"bad");
  const statusRef=useRef(status); // ref untuk akses status terbaru di dalam closure interval

  useEffect(()=>{
    statusRef.current=status;
  },[status]);

  useEffect(()=>{
    let cancelled=false;
    let intervalId=null;

    const doCheck=async()=>{
      if(cancelled)return;
      if(!navigator.onLine){
        if(!cancelled)setStatus("bad");
        return;
      }
      if(!onCheckConnection){if(!cancelled)setStatus("good");return;}
      const ok=await onCheckConnection();
      if(cancelled)return;
      setStatus(ok?"good":"bad");
    };

    // Jadwalkan interval adaptif berdasarkan status terkini
    const scheduleNext=()=>{
      if(cancelled)return;
      clearInterval(intervalId);
      // Merah → 10 detik (cepat recover), Hijau → 60 detik (hemat reads)
      const delay=statusRef.current==="bad"?10000:60000;
      intervalId=setInterval(async()=>{
        await doCheck();
        scheduleNext(); // reschedule setiap kali cek selesai agar interval ikuti status terbaru
      },delay);
    };

    // Event: disconnect/reconnect total dari OS
    const handleOnline=()=>{setStatus("checking");doCheck();};
    const handleOffline=()=>{if(!cancelled)setStatus("bad");};

    // Event: user kembali ke tab/app → langsung cek tanpa tunggu interval
    const handleVisible=()=>{
      if(document.visibilityState==="visible")doCheck();
    };

    window.addEventListener("online",handleOnline);
    window.addEventListener("offline",handleOffline);
    document.addEventListener("visibilitychange",handleVisible);

    // Ping awal lalu mulai jadwal
    doCheck().then(scheduleNext);

    return()=>{
      cancelled=true;
      clearInterval(intervalId);
      window.removeEventListener("online",handleOnline);
      window.removeEventListener("offline",handleOffline);
      document.removeEventListener("visibilitychange",handleVisible);
    };
  },[onCheckConnection]);

  const cfg={
    good:    {color:"#22c55e",shadow:"0 0 6px #22c55e",label:"Jaringan Baik"},
    bad:     {color:"#ef4444",shadow:"0 0 6px #ef4444",label:"Jaringan Buruk"},
    checking:{color:"#9ca3af",shadow:"none",label:"Mengecek..."},
  }[status];

  return(
    <div title={cfg.label} style={{display:"flex",alignItems:"center",gap:6,background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",borderRadius:20,padding:"5px 10px"}}>
      <span style={{width:9,height:9,borderRadius:"50%",background:cfg.color,boxShadow:cfg.shadow,flexShrink:0,transition:"background .3s"}}/>
      <span style={{color:"#fff",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>{cfg.label}</span>
    </div>
  );
}

// ─── Excel Export ─────────────────────────────────────────────────────────────
function exportToExcel({filename,sheets}){
  const run=X=>{const wb=X.utils.book_new();sheets.forEach(({name,headers,rows})=>{const ws=X.utils.aoa_to_sheet([headers,...rows]);X.utils.book_append_sheet(wb,ws,name.slice(0,31));});X.writeFile(wb,filename);};
  if(window.XLSX){run(window.XLSX);return;}
  const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";s.onload=()=>run(window.XLSX);document.head.appendChild(s);
}

// ─── Export PO Excel — format per tenant dengan judul & kolom rapi ────────────
function exportPOExcel({orders, tenants, filterTenant, filterStatus}){
  const fmt=n=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",minimumFractionDigits:0}).format(n||0);

  const filtered=orders.filter(o=>{
    const tOk=filterTenant==="all"||o.tenantId===filterTenant;
    const sOk=filterStatus==="all"||(filterStatus==="pending"&&o.status==="pending")||(filterStatus==="completed"&&o.status==="completed");
    return tOk&&sOk;
  });

  const run=X=>{
    const wb=X.utils.book_new();
    const data=[];

    // ── Judul file ──
    const title=`LAPORAN PRE-ORDER${filterTenant!=="all"?" — "+(tenants.find(t=>t.id===filterTenant)?.name||""):""}`;
    data.push([title]);
    data.push([`Dicetak: ${new Date().toLocaleString("id-ID")} | Status: ${filterStatus==="all"?"Semua":filterStatus==="pending"?"Belum Selesai":"Selesai"}`]);
    data.push([]);

    // ── Kelompokkan per tenant ──
    const tenantIds=filterTenant==="all"
      ?[...new Set(filtered.map(o=>o.tenantId))]
      :[filterTenant];

    let grandTotal=0;
    let grandCount=0;

    tenantIds.forEach(tid=>{
      const tenant=tenants.find(t=>t.id===tid);
      const tOrders=filtered.filter(o=>o.tenantId===tid);
      if(tOrders.length===0)return;

      const tTotal=tOrders.reduce((s,o)=>s+o.subtotal,0);
      grandTotal+=tTotal;
      grandCount+=tOrders.length;

      // Header tenant
      data.push([`🏪 ${tenant?.name||tid} (${tenant?.code||""})`]);
      // Header kolom
      data.push(["No","Nota","Pelanggan","No WA","Menu","Qty","Harga Satuan","Subtotal Menu","Total Order","Status","Tanggal","Waktu"]);

      // Data rows
      let no=1;
      tOrders.forEach(o=>{
        o.items.forEach((it,i)=>{
          data.push([
            i===0?no:"",
            i===0?o.nota:"",
            i===0?o.customerName:"",
            i===0?o.customerPhone:"",
            it.menuName,
            it.qty,
            it.price,
            it.qty*it.price,
            i===0?o.subtotal:"",
            i===0?(o.status==="pending"?"⏳ Belum Selesai":"✅ Selesai"):"",
            i===0?o.date:"",
            i===0?o.time:"",
          ]);
        });
        no++;
      });

      // Total tenant
      data.push(["","","","","","","TOTAL "+tenant?.name,fmt(tTotal),"","","",""]);
      data.push([]); // baris kosong pemisah
    });

    // Grand total (hanya jika semua tenant)
    if(filterTenant==="all"&&tenantIds.length>1){
      data.push(["","","","","","","GRAND TOTAL ("+grandCount+" PO)",fmt(grandTotal),"","","",""]);
    }

    const ws=X.utils.aoa_to_sheet(data);

    // ── Atur lebar kolom ──
    ws["!cols"]=[
      {wch:4},  // No
      {wch:24}, // Nota
      {wch:22}, // Pelanggan
      {wch:16}, // No WA
      {wch:28}, // Menu
      {wch:6},  // Qty
      {wch:16}, // Harga Satuan
      {wch:16}, // Subtotal Menu
      {wch:16}, // Total Order
      {wch:16}, // Status
      {wch:12}, // Tanggal
      {wch:8},  // Waktu
    ];

    const fname=`Laporan-PO${filterTenant!=="all"?"-"+tenants.find(t=>t.id===filterTenant)?.name:""}.xlsx`;
    X.utils.book_append_sheet(wb,ws,"Pre-Order");
    X.writeFile(wb,fname);
  };

  if(window.XLSX){run(window.XLSX);return;}
  const s=document.createElement("script");
  s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  s.onload=()=>run(window.XLSX);
  document.head.appendChild(s);
}

// ─── Thermal Print ────────────────────────────────────────────────────────────
function printThermal({tx,tenantName,tenantCode,bazaarName="BazaarPOS",footer1="Terima kasih!",footer2="Selamat menikmati :)"}){
  const payLabel="Saldo";
  const rows=tx.items.map(it=>`
    <tr><td colspan="2" style="padding:1px 0;font-size:12px;word-break:break-word">[${it.menuCode}] ${it.menuName}</td></tr>
    <tr><td style="padding:0 0 5px;font-size:12px">  ${it.qty} x ${idr(it.price)}</td>
        <td style="text-align:right;padding:0 0 5px;font-size:12px;font-weight:700">${idr(it.qty*it.price)}</td></tr>`).join("");
  const walletInfo=tx.paymentMethod==="wallet"&&tx.walletCustomerName
    ?`<p style="margin:2px 0;font-size:11px">Pelanggan: ${tx.walletCustomerName}</p><p style="margin:2px 0;font-size:11px">Sisa Saldo: ${idr(tx.walletBalanceAfter??0)}</p>`
    :"";
  const html=`<!DOCTYPE html><html><head><title>Struk</title>
  <style>@page{size:58mm auto;margin:3mm 4mm}*{font-family:'Courier New',Courier,monospace;box-sizing:border-box}
  body{width:50mm;margin:0;padding:0;font-size:12px;color:#000}.c{text-align:center}.b{font-weight:bold}
  .d{border:none;border-top:1px dashed #000;margin:5px 0}table{width:100%;border-collapse:collapse}
  @media print{html,body{width:58mm}*{-webkit-print-color-adjust:exact}}</style></head><body>
  <p class="c b" style="font-size:14px;margin:0 0 1px">${bazaarName}</p>
  <p class="c" style="font-size:11px;margin:0 0 4px">${tenantCode} — ${tenantName}</p>
  <hr class="d"/>
  <p style="margin:2px 0;font-size:11px">No  : ${tx.nota}</p>
  <p style="margin:2px 0;font-size:11px">Tgl : ${tx.date} ${tx.time}</p>
  <p style="margin:2px 0;font-size:11px">Byr : ${payLabel}</p>
  ${walletInfo}
  <hr class="d"/><table>${rows}</table><hr class="d"/>
  <table><tr><td class="b" style="font-size:13px">TOTAL</td>
             <td class="b" style="text-align:right;font-size:13px">${idr(tx.total)}</td></tr></table>
  <hr class="d"/>
  <p class="c" style="font-size:11px;margin:4px 0 1px">${footer1}</p>
  <p class="c" style="font-size:10px;margin:0">${footer2}</p>
  <br/><br/><br/></body></html>`;
  const w=window.open("","_blank","width=320,height=700,scrollbars=no");
  if(!w){alert("Izinkan popup di browser untuk print struk!");return;}
  w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),600);
}

// ─── A4 Print ─────────────────────────────────────────────────────────────────
function printA4({title,subtitle,bodyHtml,bazaarName="BazaarPOS"}){
  const full=`<!DOCTYPE html><html><head><title>${title}</title>
  <style>@page{size:A4 portrait;margin:18mm 15mm 15mm}*{font-family:Arial,sans-serif;box-sizing:border-box}
  body{font-size:11px;color:#111;margin:0}
  .kop{text-align:center;border-bottom:3px solid #ea580c;padding-bottom:10px;margin-bottom:16px}
  .kop h1{font-size:20px;margin:0 0 2px;color:#ea580c}.kop h2{font-size:14px;margin:0 0 3px;color:#333;font-weight:600}.kop p{font-size:11px;margin:0;color:#666}
  .sec{font-size:12px;font-weight:bold;color:#ea580c;margin:14px 0 6px;border-left:4px solid #ea580c;padding-left:8px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:11px}
  thead tr th{background:#ea580c;color:#fff;padding:6px 8px;text-align:left;font-size:10px;font-weight:700}
  tbody tr td{padding:5px 8px;border-bottom:1px solid #f0f0f0;vertical-align:top}
  tbody tr:nth-child(even) td{background:#fafafa}
  tfoot tr td{padding:7px 8px;background:#fff7ed!important;font-weight:bold;border-top:2px solid #ea580c}
  .pe{color:#6d28d9;font-weight:700}.pc{color:#b45309;font-weight:700}
  .sr{display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap}
  .sb{border:1px solid #e5e7eb;border-radius:6px;padding:8px 14px;min-width:130px;flex:1}
  .sb .lbl{font-size:9px;color:#888;text-transform:uppercase;margin:0 0 2px}.sb .val{font-size:15px;font-weight:bold;color:#ea580c;margin:0}
  .sb.em .val{color:#6d28d9}.sb.cs .val{color:#b45309}
  .th{background:#fff7ed;border-left:4px solid #ea580c;padding:8px 12px;margin:14px 0 5px;border-radius:0 6px 6px 0}
  .th h3{margin:0 0 2px;font-size:13px;color:#1c0a00}.th p{margin:0;font-size:10px;color:#6b7280}
  @media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
  <div class="kop"><h1>🏪 ${bazaarName}</h1><h2>${title}</h2><p>${subtitle}</p></div>
  ${bodyHtml}</body></html>`;
  const w=window.open("","_blank");
  if(!w){alert("Izinkan popup untuk print!");return;}
  w.document.write(full);w.document.close();w.focus();setTimeout(()=>w.print(),700);
}

// ─── Generate Receipt Image (Canvas → JPEG) ──────────────────────────────────
async function generateReceiptImage({tx, tenantName, tenantCode, bazaarName="BazaarPOS", footer1="Terima kasih!", footer2="Selamat menikmati :)"}){
  const W=400;
  const lineH=22;
  const pad=24;
  const itemCount=tx.items.length;
  // Hitung tinggi canvas dinamis
  const H=120+(itemCount*lineH)+180;

  const canvas=document.createElement("canvas");
  canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");

  // Background putih
  ctx.fillStyle="#ffffff";
  ctx.fillRect(0,0,W,H);

  // Header bar
  const grad=ctx.createLinearGradient(0,0,W,70);
  grad.addColorStop(0,"#431407"); grad.addColorStop(1,"#ea580c");
  ctx.fillStyle=grad; ctx.fillRect(0,0,W,72);

  // Bazaar name
  ctx.fillStyle="#ffffff"; ctx.font="bold 18px Arial"; ctx.textAlign="center";
  ctx.fillText(bazaarName,W/2,28);
  // Tenant
  ctx.font="13px Arial"; ctx.fillStyle="rgba(255,255,255,0.85)";
  ctx.fillText(`${tenantCode} — ${tenantName}`,W/2,52);

  // Garis putus-putus
  const dashes=(y)=>{ctx.setLineDash([6,4]);ctx.strokeStyle="#e5e7eb";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(W-pad,y);ctx.stroke();ctx.setLineDash([]);};

  // Info nota
  let y=92;
  ctx.font="12px Arial"; ctx.textAlign="left"; ctx.fillStyle="#374151";
  ctx.fillText(`No  : ${tx.nota}`,pad,y); y+=18;
  ctx.fillText(`Tgl : ${tx.date} ${tx.time}`,pad,y); y+=18;
  ctx.fillText(`Byr : Saldo`,pad,y); y+=18;
  if(tx.walletCustomerName){ctx.fillText(`Plgn: ${tx.walletCustomerName}`,pad,y);y+=18;}
  dashes(y+4); y+=16;

  // Items
  tx.items.forEach(it=>{
    ctx.fillStyle="#374151"; ctx.font="12px Arial"; ctx.textAlign="left";
    const label=`[${it.menuCode}] ${it.menuName} x${it.qty}`;
    ctx.fillText(label,pad,y);
    const price=new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",minimumFractionDigits:0}).format(it.qty*it.price);
    ctx.textAlign="right"; ctx.font="bold 12px Arial"; ctx.fillStyle="#1c0a00";
    ctx.fillText(price,W-pad,y);
    y+=lineH;
  });

  dashes(y+4); y+=16;

  // Total
  ctx.fillStyle="#ea580c"; ctx.font="bold 16px Arial"; ctx.textAlign="left";
  ctx.fillText("TOTAL",pad,y);
  const total=new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",minimumFractionDigits:0}).format(tx.total);
  ctx.textAlign="right"; ctx.font="bold 18px Arial";
  ctx.fillText(total,W-pad,y); y+=24;

  // Sisa saldo
  if(tx.walletBalanceAfter!=null){
    ctx.fillStyle="#7c3aed"; ctx.font="12px Arial"; ctx.textAlign="center";
    const sisa=new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",minimumFractionDigits:0}).format(tx.walletBalanceAfter);
    ctx.fillText(`Sisa Saldo: ${sisa}`,W/2,y); y+=20;
  }

  dashes(y+4); y+=18;

  // Footer
  ctx.fillStyle="#6b7280"; ctx.font="13px Arial"; ctx.textAlign="center";
  ctx.fillText(footer1,W/2,y); y+=18;
  ctx.font="12px Arial"; ctx.fillStyle="#9ca3af";
  ctx.fillText(footer2,W/2,y);

  // JPEG dengan quality 0.75 → ukuran file kecil
  return canvas.toDataURL("image/jpeg",0.75);
}

// ─── Send Receipt Image via Fonnte atau Web Share ─────────────────────────────
async function sendReceiptImage({dataUrl, phone, token, caption="Struk belanja 🧾", onStatus}){
  const blob=await (await fetch(dataUrl)).blob();
  const file=new File([blob],"struk.jpg",{type:"image/jpeg"});

  // ── 1. Fonnte API (kirim otomatis ke WA pelanggan) ──────────────────────────
  if(token&&phone){
    try{
      const target=phone.startsWith("0")?"62"+phone.slice(1):phone.replace(/\D/g,"");
      const form=new FormData();
      form.append("target",target);
      form.append("message",caption);
      form.append("file",file,"struk.jpg");
      const r=await fetch("https://api.fonnte.com/send",{
        method:"POST",
        headers:{"Authorization":token},
        body:form,
      });
      const d=await r.json();
      if(d.status===true||d.status==="true"){
        onStatus&&onStatus("✅ Struk gambar terkirim ke WhatsApp pelanggan!");
        return "fonnte";
      }
    }catch(e){console.error("Fonnte image:",e);}
  }

  // ── 2. Web Share API (native share Android/iOS Chrome) ─────────────────────
  if(typeof navigator.share==="function"){
    try{
      // Coba share dengan file gambar
      if(navigator.canShare&&navigator.canShare({files:[file]})){
        await navigator.share({files:[file],title:"Struk Belanja",text:caption});
        onStatus&&onStatus("✅ Struk gambar dibagikan via WhatsApp!");
        return "webshare";
      }
    }catch(e){
      if(e.name==="AbortError") return "cancelled";
      console.error("Web share:",e);
    }
  }

  // ── 3. Download gambar + instruksi ─────────────────────────────────────────
  // Buat object URL agar file bisa didownload (lebih kecil dari dataURL)
  const objUrl=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=objUrl; a.download="struk.jpg"; a.click();
  setTimeout(()=>URL.revokeObjectURL(objUrl),3000);

  onStatus&&onStatus("📥 Gambar struk didownload. Kirim manual ke WhatsApp pelanggan.");
  return "download";
}

// ─── Print QR Card Thermal 80mm ───────────────────────────────────────────────
function printQRCard({customer, bazaarName="BazaarPOS", walletLogs=[]}){
  const lastTopUp=(walletLogs||[]).filter(l=>l.customerId===customer.id&&l.type==="topup")
    .sort((a,b)=>(b.timestamp||"").localeCompare(a.timestamp||""))[0];
  // QR berisi customer ID (aman, tidak expose nomor HP)
  const qrUrl=`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(customer.id)}&bgcolor=ffffff&color=000000&margin=8`;
  const fmt=n=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",minimumFractionDigits:0}).format(n||0);

  const html=`<!DOCTYPE html><html><head><title>Kartu QR ${customer.name}</title>
  <style>
    @page{size:80mm auto;margin:5mm 6mm}
    *{font-family:'Courier New',Courier,monospace;box-sizing:border-box}
    body{width:68mm;margin:0;padding:0;color:#000}
    .c{text-align:center}.b{font-weight:bold}
    .d{border:none;border-top:2px dashed #000;margin:8px 0}
    @media print{html,body{width:80mm}*{-webkit-print-color-adjust:exact}}
  </style></head><body>
  <p class="c b" style="font-size:18px;margin:0 0 3px">🏪 ${bazaarName}</p>
  <p class="c" style="font-size:14px;margin:0 0 5px">Kartu Saldo Pelanggan</p>
  <hr class="d"/>
  <p class="b" style="font-size:18px;margin:3px 0">${customer.name}</p>
  <p style="margin:3px 0;font-size:16px">📱 ${customer.phone}</p>
  <hr class="d"/>
  <p style="margin:3px 0;font-size:16px">💰 Saldo :</p>
  <p class="b" style="font-size:20px;margin:2px 0 6px">${fmt(customer.balance)}</p>
  ${lastTopUp?`<p style="margin:3px 0;font-size:16px">📅 Top Up : ${new Date(lastTopUp.timestamp).toLocaleDateString("id-ID")}</p><p style="margin:3px 0;font-size:16px">👤 Admin  : ${lastTopUp.adminName||"Admin"}</p>`:""}
  <hr class="d"/>
  <p class="c" style="font-size:14px;margin:5px 0 8px">Tunjukkan QR ini saat transaksi</p>
  <div class="c"><img src="${qrUrl}" width="210" height="210" style="display:block;margin:0 auto;border:2px solid #000"/></div>
  <hr class="d"/>
  <p class="c" style="font-size:18px;margin:4px 0">ID: ${customer.id.slice(0,8).toUpperCase()}</p>
  <p class="c" style="font-size:18px;margin:3px 0">Dicetak: ${new Date().toLocaleString("id-ID")}</p>
  <br/><br/>
  </body></html>`;

  const w=window.open("","_blank","width=420,height=750,scrollbars=no");
  if(!w){alert("Izinkan popup untuk cetak kartu!");return;}
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(()=>w.print(),1200);
}

async function connectBTPrinter(){
  if(!navigator.bluetooth){alert("Browser ini tidak mendukung Web Bluetooth. Gunakan Chrome di Android.");return null;}
  try{
    const device=await navigator.bluetooth.requestDevice({
      acceptAllDevices:true,
      optionalServices:["000018f0-0000-1000-8000-00805f9b34fb","0000ffe0-0000-1000-8000-00805f9b34fb"]
    });
    const server=await device.gatt.connect();
    return {device,server,name:device.name||"Printer BT"};
  }catch(e){
    if(e.name!=="NotFoundError") alert("Gagal koneksi Bluetooth: "+e.message);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═════════════════════════════════════════════════════════════════════════════
// ─── MainApp: aplikasi utama (superadmin/admin/tenant) dengan realtime subscriptions ──
function MainApp(){
  const [screen,setScreen]=useState("login");
  const [session,setSession]=useState(null);
  const [tenants,setTenants]=useState([]);
  const [menus,setMenus]=useState([]);
  const [transactions,setTransactions]=useState([]);
  const [settings,setSettings]=useState(DEF);
  const [admins,setAdmins]=useState([]);
  const [alerts,setAlerts]=useState([]);
  const [customers,setCustomers]=useState([]);
  const [walletLogs,setWalletLogs]=useState([]);
  const [orders,setOrders]=useState([]);
  const [loaded,setLoaded]=useState(false);
  const bkRef=useRef(null);

  // ── Session persistence: hindari ter-logout saat refresh tidak sengaja ──────
  // Pakai sessionStorage (bukan localStorage) supaya tetap aman: sesi hilang
  // otomatis kalau tab/browser benar-benar ditutup, tapi BERTAHAN saat refresh.
  const SESSION_KEY="bzr_session";
  const saveSessionToStorage=(type,data)=>{
    try{
      const ref=type==="superadmin"?{type,username:data.username}:{type,id:data.id};
      sessionStorage.setItem(SESSION_KEY,JSON.stringify(ref));
    }catch(e){ console.error("Gagal simpan sesi:",e); }
  };
  const clearSessionStorage=()=>{ try{ sessionStorage.removeItem(SESSION_KEY); }catch(e){} };

  // Pulihkan sesi setelah data fresh dari server selesai dimuat (supaya validasi
  // admin/tenant pakai data TERBARU, bukan data lama yang mungkin sudah berubah/dihapus)
  const sessionRestoredRef=useRef(false);
  useLayoutEffect(()=>{
    if(!loaded||sessionRestoredRef.current)return;
    sessionRestoredRef.current=true;
    try{
      const raw=sessionStorage.getItem(SESSION_KEY);
      if(!raw)return;
      const ref=JSON.parse(raw);
      if(ref.type==="superadmin"){
        if(ref.username===settings.saUser){ setSession({type:"superadmin",data:{username:ref.username}}); setScreen("superadmin"); }
        else clearSessionStorage(); // username SuperAdmin sudah diubah — minta login ulang
      } else if(ref.type==="admin"){
        const a=admins.find(x=>x.id===ref.id);
        if(a){ setSession({type:"admin",data:a}); setScreen("admin"); }
        else clearSessionStorage(); // admin sudah dihapus
      } else if(ref.type==="tenant"){
        const t=tenants.find(x=>x.id===ref.id);
        if(t){ setSession({type:"tenant",data:t}); setScreen("tenant"); }
        else clearSessionStorage(); // tenant sudah dihapus
      }
    }catch(e){ console.error("Gagal pulihkan sesi:",e); clearSessionStorage(); }
  },[loaded]);

  useEffect(()=>{
    // Real-time subscriptions — semua panel update otomatis saat ada perubahan
    let count=0; const total=9;
    const checkLoaded=()=>{count++;if(count>=total)setLoaded(true);};

    const u1=db.subscribe("bzr_tenants",    v=>{setTenants(v||[]);             checkLoaded();});
    const u2=db.subscribe("bzr_menus",      v=>{setMenus(v||[]);               checkLoaded();});
    const u3=db.subscribe("bzr_transactions",v=>{setTransactions(v||[]);       checkLoaded();});
    const u4=db.subscribe("bzr_settings",   v=>{setSettings({...DEF,...(v||{})});checkLoaded();});
    const u5=db.subscribe("bzr_admins",     v=>{setAdmins(v||[]);              checkLoaded();});
    const u6=db.subscribe("bzr_alerts",     v=>{setAlerts(v||[]);              checkLoaded();});
    const u7=db.subscribe("bzr_customers",  v=>{setCustomers(v||[]);           checkLoaded();});
    const u8=db.subscribe("bzr_wallet_logs",v=>{setWalletLogs(v||[]);          checkLoaded();});
    const u9=db.subscribe("bzr_orders",     v=>{setOrders(v||[]);              checkLoaded();});

    return()=>{u1();u2();u3();u4();u5();u6();u7();u8();u9();};
  },[]);

  useEffect(()=>{
    clearInterval(bkRef.current);
    if(!settings.autoBackup)return;
    bkRef.current=setInterval(()=>doLocalBackup({tenants,menus,transactions,settings,admins,customers,walletLogs,orders}),(settings.backupInterval||30)*60*1000);
    return()=>clearInterval(bkRef.current);
  },[settings.autoBackup,settings.backupInterval,tenants,menus,transactions,admins]);


  // ── Migrasi satu kali: pulihkan data offline LAMA (dari versi sebelum perbaikan ini) ──
  // Sistem antrian offline lama sudah dihapus, tapi kalau ada device yang masih
  // menyimpan data tertunda di localStorage dari versi lama, coba selamatkan sekali.
  useEffect(()=>{
    (async()=>{
      try{
        const raw=localStorage.getItem("bzr_offq");
        if(!raw)return;
        const q=JSON.parse(raw);
        if(!Array.isArray(q)||!q.length){localStorage.removeItem("bzr_offq");return;}
        const fresh=await db.get("bzr_transactions")||[];
        const merged=[...fresh,...q.filter(qt=>!fresh.find(t=>t.id===qt.id))];
        await db.set("bzr_transactions",merged);
        setTransactions(merged);
        localStorage.removeItem("bzr_offq");
        alert(`⚠️ Ditemukan ${q.length} transaksi lama yang belum tersinkron (dari versi aplikasi sebelumnya) dan sudah berhasil dipulihkan ke database.\n\nPENTING: Cek manual apakah saldo pelanggan terkait transaksi ini sudah benar, karena potongan saldo untuk transaksi lama ini mungkin TIDAK ikut tersimpan saat itu.`);
      }catch(e){ console.error("Gagal pulihkan data offline lama:",e); }
    })();
  },[]);

  const saveTenants=async d=>{setTenants(d);await db.set("bzr_tenants",d);};
  const saveMenus=async d=>{await db.set("bzr_menus",d);setMenus(d);};
  const saveTx=async d=>{await db.set("bzr_transactions",d);setTransactions(d);};
  const saveSettings=async d=>{await db.set("bzr_settings",d);setSettings(d);};
  const saveAdmins=async d=>{await db.set("bzr_admins",d);setAdmins(d);};
  const saveAlerts=async d=>{await db.set("bzr_alerts",d);setAlerts(d);};
  const saveCustomers=async d=>{await db.set("bzr_customers",d);setCustomers(d);};
  const saveWalletLogs=async d=>{await db.set("bzr_wallet_logs",d);setWalletLogs(d);};
  const saveOrders=async d=>{await db.set("bzr_orders",d);setOrders(d);};

  // ── Update saldo pelanggan ATOMIK (anti race-condition) ──────────────────────
  // Dipakai untuk: top up, bayar transaksi (potong saldo), refund, kosongkan saldo.
  // Server Firestore yang menjamin baca-ubah-tulis terjadi tanpa celah antar device.
  const updateCustomerBalance=async(customerId,deltaOrFn,buildLogEntry,extraCustFields={})=>{
    const {customer:updatedCust,logEntry}=await db.updateCustomerBalance(customerId,deltaOrFn,buildLogEntry,extraCustFields);
    // Sinkronkan state lokal supaya UI langsung update tanpa nunggu snapshot listener
    setCustomers(prev=>prev.map(c=>c.id===customerId?updatedCust:c));
    if(logEntry) setWalletLogs(prev=>[logEntry,...prev]);
    return updatedCust;
  };
  // ── Tambah pelanggan baru ATOMIK (top up pelanggan baru) ─────────────────────
  const addNewCustomerAtomic=async(newCustomer,buildLogEntry)=>{
    await db.addNewCustomer(newCustomer,buildLogEntry);
    setCustomers(prev=>[...prev,newCustomer]);
  };
  // ── Cek koneksi ke server SEBELUM transaksi apapun dimulai ──────────────────
  // Kalau gagal terhubung, transaksi ditolak cepat (~4 detik) dengan pesan jelas,
  // tanpa kehilangan data orderan/keranjang yang sudah diisi.
  const checkConnection=async()=>db.ping();
  const [refreshing,setRefreshing]=useState(false);
  const doRefresh=async()=>{
    setRefreshing(true);
    try{
      const t=await db.get("bzr_tenants")||[];
      const m=await db.get("bzr_menus")||[];
      const tx=await db.get("bzr_transactions")||[];
      const s=await db.get("bzr_settings")||{};
      const a=await db.get("bzr_admins")||[];
      const al=await db.get("bzr_alerts")||[];
      const cu=await db.get("bzr_customers")||[];
      const wl=await db.get("bzr_wallet_logs")||[];
      setTenants(t);setMenus(m);setTransactions(tx);
      setSettings({...DEF,...s});setAdmins(a);setAlerts(al);
      setCustomers(cu);setWalletLogs(wl);
    }catch(e){console.error("Refresh error:",e);}
    setTimeout(()=>setRefreshing(false),800);
  };

  const logout=()=>{setSession(null);setScreen("login");clearSessionStorage();};

  const restoreBackup=async(bk)=>{
    const newTenants    = Array.isArray(bk.tenants)      ? bk.tenants      : tenants;
    const newMenus      = Array.isArray(bk.menus)        ? bk.menus        : menus;
    const newTx         = Array.isArray(bk.transactions) ? bk.transactions  : transactions;
    const newAdmins     = Array.isArray(bk.admins)       ? bk.admins       : admins;
    const newSettings   = bk.settings ? {...DEF,...bk.settings} : settings;
    const newCustomers  = Array.isArray(bk.customers)    ? bk.customers    : customers;
    const newWalletLogs = Array.isArray(bk.walletLogs)   ? bk.walletLogs   : walletLogs;
    const newOrders     = Array.isArray(bk.orders)       ? bk.orders       : orders;

    // Update state lokal dulu (UI langsung responsif)
    setTenants(newTenants); setMenus(newMenus); setTransactions(newTx);
    setAdmins(newAdmins);   setSettings(newSettings);
    setCustomers(newCustomers); setWalletLogs(newWalletLogs); setOrders(newOrders);

    // Simpan semua ke Firestore
    await db.set("bzr_tenants",     newTenants);
    await db.set("bzr_menus",       newMenus);
    await db.set("bzr_transactions",newTx);
    await db.set("bzr_admins",      newAdmins);
    await db.set("bzr_settings",    newSettings);
    await db.set("bzr_customers",   newCustomers);
    await db.set("bzr_wallet_logs", newWalletLogs);
    await db.set("bzr_orders",      newOrders);
  };

  const unreadAlerts=alerts.filter(a=>!a.read);

  const commonProps={
    tenants,menus,transactions,settings,admins,customers,walletLogs,orders,
    alerts:unreadAlerts, allAlerts:alerts,
    onSaveTenants:saveTenants, onSaveMenus:saveMenus, onSaveTx:saveTx,
    onSaveSettings:saveSettings, onSaveAdmins:saveAdmins, onSaveAlerts:saveAlerts,
    onSaveCustomers:saveCustomers, onSaveWalletLogs:saveWalletLogs, onSaveOrders:saveOrders,
    onUpdateCustomerBalance:updateCustomerBalance, onAddNewCustomer:addNewCustomerAtomic,
    onCheckConnection:checkConnection,
    onRestoreBackup:restoreBackup, onRefresh:doRefresh, refreshing,
    onLogout:logout,
  };

  if(!loaded) return(
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#fff7ed,#fed7aa)",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}><div style={{fontSize:48,marginBottom:12}}>🏪</div>
        <p style={{color:"#ea580c",fontWeight:700,fontSize:18}}>Memuat BazaarPOS…</p></div>
    </div>);

  if(screen==="superadmin") return <SuperAdminDashboard {...commonProps}/>;
  if(screen==="admin") return <AdminDashboard {...commonProps} adminData={session?.data}/>;
  if(screen==="tenant"&&session) return(
    <TenantApp tenant={session.data}
      menus={menus.filter(m=>m.tenantId===session.data.id)} allMenus={menus}
      transactions={transactions.filter(t=>t.tenantId===session.data.id)}
      allTransactions={transactions} settings={settings}
      customers={customers} walletLogs={walletLogs} orders={orders}
      onSaveMenus={saveMenus} onSaveTx={saveTx}
      onSaveCustomers={saveCustomers} onSaveWalletLogs={saveWalletLogs} onSaveOrders={saveOrders}
      onUpdateCustomerBalance={updateCustomerBalance}
      onCheckConnection={checkConnection}
      onSaveAlerts={saveAlerts} alerts={alerts}
      onRefresh={doRefresh} refreshing={refreshing}
      onLogout={logout}/>);

  return <LoginScreen tenants={tenants} admins={admins} settings={settings}
    onLogin={(type,data)=>{setSession({type,data});setScreen(type);saveSessionToStorage(type,data);}}/>;
}

// ─── App: titik masuk utama — cek dulu apakah ini link kartu pelanggan publik ──
// Kalau ya, JANGAN mount MainApp (yang subscribe realtime ke 9 koleksi sekaligus)
// — cukup load halaman kartu yang ringan, sekali fetch saat dibuka/refresh saja.
export default function App(){
  const urlParams=new URLSearchParams(window.location.search);
  const cardParam=urlParams.get("card");
  if(cardParam) return <CustomerCardPageLoader phone={cardParam}/>;
  return <MainApp/>;
}


// ═════════════════════════════════════════════════════════════════════════════
// LOGIN
// ═════════════════════════════════════════════════════════════════════════════
function LoginScreen({tenants,admins,settings,onLogin}){
  const [mode,setMode]=useState("select");
  const [saUser,setSaUser]=useState(""); const [saPass,setSaPass]=useState("");
  const [adUser,setAdUser]=useState(""); const [adPass,setAdPass]=useState("");
  const [tCode,setTCode]=useState(""); const [tPass,setTPass]=useState("");
  const [errMsg,setErrMsg]=useState(""); // pesan error popup
  const [shake,setShake]=useState(false);

  const showErr=(msg)=>{
    setErrMsg(msg);
    setShake(true);
    setTimeout(()=>setShake(false),500);
  };
  const clearErr=()=>setErrMsg("");

  const inp=(accent="#ea580c")=>({width:"100%",border:`2px solid ${errMsg?"#fca5a5":"#e5e7eb"}`,borderRadius:14,padding:"14px 18px",fontSize:15,outline:"none",transition:"border-color .2s",fontFamily:"'Plus Jakarta Sans',sans-serif",color:"#111"});
  const btnStyle=(bg="#ea580c",c="#fff")=>({width:"100%",padding:"15px 24px",background:bg,color:c,border:c==="#ea580c"?"2px solid #ea580c":"none",borderRadius:14,fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"'Plus Jakarta Sans',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:10});

  const loginSA=()=>{
    if(!saUser.trim()||!saPass.trim()){showErr("Username dan password tidak boleh kosong.");return;}
    if(saUser===settings.saUser&&saPass===settings.saPass) onLogin("superadmin",{username:saUser});
    else showErr("Username atau password Super Admin salah.");
  };
  const loginAdmin=()=>{
    if(!adUser.trim()||!adPass.trim()){showErr("Username dan password tidak boleh kosong.");return;}
    const a=admins.find(x=>x.username===adUser.trim());
    if(!a) showErr(`Username "${adUser.trim()}" tidak ditemukan.`);
    else if(a.password!==adPass) showErr("Password Admin salah. Coba lagi.");
    else onLogin("admin",a);
  };
  const loginTenant=()=>{
    if(!tCode.trim()||!tPass.trim()){showErr("Kode tenant dan kode akses tidak boleh kosong.");return;}
    const t=tenants.find(x=>x.code===tCode.trim().toUpperCase());
    if(!t) showErr(`Kode tenant "${tCode.trim().toUpperCase()}" tidak ditemukan.`);
    else if(t.password!==tPass) showErr("Kode akses salah. Coba lagi.");
    else{
      // Kredensial OK — tanya nama kasir sebelum masuk
      setKasirTenant(t);
      setKasirName("");
      setMode("kasir_input");
      clearErr();
    }
  };
  const [kasirTenant,setKasirTenant]=useState(null);
  const [kasirName,setKasirName]=useState("");
  const confirmKasir=()=>{
    const name=kasirName.trim()||"Kasir";
    // Simpan kasir ke sessionStorage, bisa dibaca TenantApp
    try{sessionStorage.setItem(`bzr_kasir_${kasirTenant.id}`,name);}catch(e){}
    onLogin("tenant",kasirTenant);
  };

  const goBack=(m)=>{setMode(m);clearErr();setSaUser("");setSaPass("");setAdUser("");setAdPass("");setTCode("");setTPass("");};

  // Warna aksen per mode
  const accentColor=mode==="admin"?"#7c3aed":mode==="tenant"?"#16a34a":"#ea580c";

  return(
    <div style={{minHeight:"100vh",background:"linear-gradient(145deg,#431407,#9a3412 40%,#c2410c 70%,#ea580c)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{position:"fixed",top:-80,right:-80,width:300,height:300,borderRadius:"50%",background:"rgba(255,255,255,.05)"}}/>
      <div style={{position:"fixed",bottom:-60,left:-60,width:250,height:250,borderRadius:"50%",background:"rgba(255,255,255,.04)"}}/>
      <div style={{background:"#fff",borderRadius:24,boxShadow:"0 24px 80px rgba(0,0,0,.3)",padding:40,width:"100%",maxWidth:420,animation:"slideUp .4s ease"}}>

        {/* Header */}
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:52,lineHeight:1,marginBottom:8}}>🏪</div>
          <h1 style={{fontSize:28,fontWeight:800,color:"#1c0a00",margin:0}}>BazaarPOS</h1>
          {settings.bazaarName&&<p style={{color:"#ea580c",fontSize:15,marginTop:6,fontWeight:700}}>{settings.bazaarName}</p>}
          <p style={{color:"#92400e",fontSize:12,margin:"4px 0 0",fontWeight:500}}>Sistem Manajemen Bazaar & Foodcourt</p>
        </div>

        {/* Error popup inline */}
        {errMsg&&(
          <div className="pop-in" style={{background:"#fef2f2",border:"1.5px solid #fca5a5",borderRadius:14,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"flex-start",gap:10}}>
            <span style={{fontSize:20,lineHeight:1,flexShrink:0}}>❌</span>
            <div style={{flex:1}}>
              <p style={{margin:0,fontWeight:700,color:"#dc2626",fontSize:14}}>{errMsg}</p>
              <p style={{margin:"3px 0 0",color:"#9ca3af",fontSize:12}}>Periksa kembali dan coba lagi.</p>
            </div>
            <button onClick={clearErr} style={{background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:18,lineHeight:1,padding:0,flexShrink:0}}>✕</button>
          </div>
        )}

        {/* Pilih mode */}
        {mode==="select"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
          <button onClick={()=>setMode("superadmin")} style={btnStyle()} onMouseOver={e=>e.currentTarget.style.background="#c2410c"} onMouseOut={e=>e.currentTarget.style.background="#ea580c"}>
            <span style={{fontSize:20}}>👑</span> Super Admin
          </button>
          <button onClick={()=>setMode("admin")} style={btnStyle("#7c3aed")} onMouseOver={e=>e.currentTarget.style.background="#6d28d9"} onMouseOut={e=>e.currentTarget.style.background="#7c3aed"}>
            <span style={{fontSize:20}}>🔑</span> Admin
          </button>
          <button onClick={()=>setMode("tenant")} style={btnStyle("#fff","#ea580c")} onMouseOver={e=>e.currentTarget.style.background="#fff7ed"} onMouseOut={e=>e.currentTarget.style.background="#fff"}>
            <span style={{fontSize:20}}>🍽️</span> Tenant
          </button>
        </div>}

        {/* Super Admin login */}
        {mode==="superadmin"&&(
          <div style={{display:"flex",flexDirection:"column",gap:12,animation:shake?"shake .4s ease":undefined}}>
            <p style={{textAlign:"center",fontWeight:700,fontSize:17,color:"#1c0a00",margin:"0 0 4px"}}>👑 Login Super Admin</p>
            <input placeholder="Username" value={saUser}
              onChange={e=>{setSaUser(e.target.value);clearErr();}}
              onKeyDown={e=>e.key==="Enter"&&loginSA()}
              onFocus={e=>e.target.style.borderColor="#ea580c"} onBlur={e=>e.target.style.borderColor=errMsg?"#fca5a5":"#e5e7eb"}
              style={inp()}/>
            <input type="password" placeholder="Password" value={saPass}
              onChange={e=>{setSaPass(e.target.value);clearErr();}}
              onKeyDown={e=>e.key==="Enter"&&loginSA()}
              onFocus={e=>e.target.style.borderColor="#ea580c"} onBlur={e=>e.target.style.borderColor=errMsg?"#fca5a5":"#e5e7eb"}
              style={inp()}/>
            <button onClick={loginSA} style={btnStyle()}
              onMouseOver={e=>e.currentTarget.style.background="#c2410c"} onMouseOut={e=>e.currentTarget.style.background="#ea580c"}>
              Masuk
            </button>
            <button onClick={()=>goBack("select")} style={{background:"none",border:"none",color:"#6b7280",cursor:"pointer",fontSize:14,padding:6}}>← Kembali</button>
          </div>
        )}

        {/* Admin login */}
        {mode==="admin"&&(
          <div style={{display:"flex",flexDirection:"column",gap:12,animation:shake?"shake .4s ease":undefined}}>
            <p style={{textAlign:"center",fontWeight:700,fontSize:17,color:"#1c0a00",margin:"0 0 4px"}}>🔑 Login Admin</p>
            <input placeholder="Username Admin" value={adUser}
              onChange={e=>{setAdUser(e.target.value);clearErr();}}
              onKeyDown={e=>e.key==="Enter"&&loginAdmin()}
              onFocus={e=>e.target.style.borderColor="#7c3aed"} onBlur={e=>e.target.style.borderColor=errMsg?"#fca5a5":"#e5e7eb"}
              style={inp("#7c3aed")}/>
            <input type="password" placeholder="Password" value={adPass}
              onChange={e=>{setAdPass(e.target.value);clearErr();}}
              onKeyDown={e=>e.key==="Enter"&&loginAdmin()}
              onFocus={e=>e.target.style.borderColor="#7c3aed"} onBlur={e=>e.target.style.borderColor=errMsg?"#fca5a5":"#e5e7eb"}
              style={inp("#7c3aed")}/>
            <button onClick={loginAdmin} style={btnStyle("#7c3aed")}
              onMouseOver={e=>e.currentTarget.style.background="#6d28d9"} onMouseOut={e=>e.currentTarget.style.background="#7c3aed"}>
              Masuk
            </button>
            <button onClick={()=>goBack("select")} style={{background:"none",border:"none",color:"#6b7280",cursor:"pointer",fontSize:14,padding:6}}>← Kembali</button>
          </div>
        )}

        {/* Tenant login */}
        {mode==="tenant"&&(
          <div style={{display:"flex",flexDirection:"column",gap:12,animation:shake?"shake .4s ease":undefined}}>
            <p style={{textAlign:"center",fontWeight:700,fontSize:17,color:"#1c0a00",margin:"0 0 4px"}}>🍽️ Login Tenant</p>
            <input placeholder="Kode Tenant (contoh: T001)" value={tCode}
              onChange={e=>{setTCode(e.target.value.toUpperCase());clearErr();}}
              onKeyDown={e=>e.key==="Enter"&&loginTenant()}
              onFocus={e=>e.target.style.borderColor="#16a34a"} onBlur={e=>e.target.style.borderColor=errMsg?"#fca5a5":"#e5e7eb"}
              style={inp("#16a34a")}/>
            <input type="password" placeholder="Kode Akses" value={tPass}
              onChange={e=>{setTPass(e.target.value);clearErr();}}
              onKeyDown={e=>e.key==="Enter"&&loginTenant()}
              onFocus={e=>e.target.style.borderColor="#16a34a"} onBlur={e=>e.target.style.borderColor=errMsg?"#fca5a5":"#e5e7eb"}
              style={inp("#16a34a")}/>
            <button onClick={loginTenant} style={btnStyle("#16a34a")}
              onMouseOver={e=>e.currentTarget.style.background="#15803d"} onMouseOut={e=>e.currentTarget.style.background="#16a34a"}>
              Masuk
            </button>
            <button onClick={()=>goBack("select")} style={{background:"none",border:"none",color:"#6b7280",cursor:"pointer",fontSize:14,padding:6}}>← Kembali</button>
          </div>
        )}

        {/* ── Step 2: Input nama kasir setelah kredensial berhasil ── */}
        {mode==="kasir_input"&&kasirTenant&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{textAlign:"center",marginBottom:4}}>
              <div style={{fontSize:36,marginBottom:6}}>👤</div>
              <p style={{fontWeight:800,fontSize:17,color:"#1c0a00",margin:0}}>Siapa yang bertugas?</p>
              <p style={{color:"#6b7280",fontSize:13,margin:"4px 0 0"}}>{kasirTenant.name} ({kasirTenant.code})</p>
            </div>
            <div>
              <label style={{display:"block",fontWeight:700,color:"#374151",fontSize:13,marginBottom:6}}>Nama / Kode Kasir</label>
              <input placeholder="Contoh: Kasir 1, Budi, K2, dll."
                value={kasirName}
                onChange={e=>setKasirName(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&confirmKasir()}
                autoFocus
                onFocus={e=>e.target.style.borderColor="#16a34a"} onBlur={e=>e.target.style.borderColor="#e5e7eb"}
                style={inp("#16a34a")}/>
              <p style={{fontSize:11,color:"#9ca3af",margin:"5px 0 0"}}>
                Digunakan sebagai prefix nota transaksi. Kosongkan jika hanya 1 kasir.
              </p>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>{setMode("tenant");clearErr();}}
                style={{flex:1,padding:"12px",background:"#f9fafb",color:"#374151",border:"1px solid #e5e7eb",borderRadius:12,fontWeight:600,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                ← Kembali
              </button>
              <button onClick={confirmKasir}
                style={{flex:2,padding:"12px",background:"#16a34a",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
                onMouseOver={e=>e.currentTarget.style.background="#15803d"} onMouseOut={e=>e.currentTarget.style.background="#16a34a"}>
                ✅ Mulai Bertugas
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ALERT POPUP (shared admin component)
// ═════════════════════════════════════════════════════════════════════════════
function AlertPopup({alerts,onDismiss}){
  if(!alerts.length) return null;
  return(
    <div className="pop-in" style={{position:"fixed",top:16,right:16,zIndex:9999,background:"#fff",border:"2px solid #dc2626",borderRadius:18,padding:"14px 18px",maxWidth:340,boxShadow:"0 8px 32px rgba(220,38,38,.3)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <p style={{margin:0,fontWeight:800,color:"#dc2626",fontSize:14}}>🆘 Darurat dari Tenant!</p>
        <button onClick={onDismiss} style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:18,lineHeight:1}}>✕</button>
      </div>
      {alerts.map(a=>(
        <div key={a.id} style={{background:"#fef2f2",borderRadius:10,padding:"9px 12px",marginBottom:8}}>
          <p style={{margin:"0 0 2px",fontWeight:700,color:"#1c0a00",fontSize:13}}>{a.tenantName} <span style={{color:"#9ca3af",fontWeight:400,fontSize:12}}>({a.tenantCode})</span></p>
          <p style={{margin:"0 0 3px",color:"#374151",fontSize:13}}>{a.message}</p>
          <p style={{margin:0,color:"#9ca3af",fontSize:11}}>{a.time}</p>
        </div>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUPER ADMIN DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════
function SuperAdminDashboard(props){
  const {tenants,transactions,settings,alerts,allAlerts,onSaveAlerts,onSaveSettings,onRefresh,refreshing,onLogout,onCheckConnection}=props;
  const [tab,setTab]=useState("tenants");
  const [filterDate,setFilterDate]=useState(todayStr());
  const [editBazaar,setEditBazaar]=useState(false);
  const [bazaarInput,setBazaarInput]=useState(settings.bazaarName||"");
  const [showAlertPop,setShowAlertPop]=useState(true);
  const {BackConfirmModal}=useBackConfirm(true);
  const todayTx=transactions.filter(t=>t.date===todayStr()&&!t.refunded);

  const tabs=[
    {k:"tenants",i:"🏪",l:"Tenant"},{k:"admins",i:"🔑",l:"Admin"},
    {k:"wallet",i:"💰",l:"Kasir Top Up"},{k:"po",i:"📦",l:"Pre-Order"},
    {k:"transactions",i:"📋",l:"Transaksi"},{k:"report",i:"📑",l:"Laporan"},
    {k:"summary",i:"📊",l:"Rekap"},{k:"settings",i:"⚙️",l:"Pengaturan"},
    {k:"backup",i:"💾",l:"Backup"},{k:"reset",i:"🗑️",l:"Reset Data"},
  ];

  const saveBazaar=async()=>{
    try{ await onSaveSettings({...settings,bazaarName:bazaarInput}); setEditBazaar(false); }
    catch(e){ alert("❌ GAGAL MENYIMPAN! "+e.message); }
  };
  const dismissAlerts=async()=>{await onSaveAlerts(allAlerts.map(a=>({...a,read:true})));setShowAlertPop(false);};

  return(
    <div style={{minHeight:"100vh",background:"#fafaf9"}}>
      <BackConfirmModal/>
      {showAlertPop&&<AlertPopup alerts={alerts} onDismiss={dismissAlerts}/>}
      <div style={{background:"linear-gradient(90deg,#431407,#ea580c)",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:"0 4px 20px rgba(234,88,12,.3)",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:26}}>👑</span>
          <div><h1 style={{color:"#fff",fontSize:18,fontWeight:800,margin:0}}>BazaarPOS — Super Admin</h1>
            <p style={{color:"#fed7aa",fontSize:11,margin:0}}>Akses Penuh Sistem</p></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          {editBazaar?(
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <input value={bazaarInput} onChange={e=>setBazaarInput(e.target.value)}
                style={{border:"2px solid #fed7aa",borderRadius:10,padding:"6px 12px",fontSize:14,fontWeight:700,background:"rgba(255,255,255,.15)",color:"#fff",outline:"none",width:180}}/>
              <button onClick={saveBazaar} style={{background:"#16a34a",color:"#fff",border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontWeight:700,fontSize:13}}>✓</button>
              <button onClick={()=>setEditBazaar(false)} style={{background:"rgba(255,255,255,.2)",color:"#fff",border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:13}}>✕</button>
            </div>
          ):(
            <div style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={()=>{setBazaarInput(settings.bazaarName||"");setEditBazaar(true);}}>
              <span style={{color:"#fff",fontSize:17,fontWeight:800}}>{settings.bazaarName||"—"}</span>
              <span style={{fontSize:13,color:"#fecaca"}}>✏️</span>
            </div>
          )}
          {alerts.length>0&&<button onClick={()=>setShowAlertPop(true)} className="pulse" style={{background:"#dc2626",color:"#fff",border:"none",borderRadius:10,padding:"7px 14px",cursor:"pointer",fontWeight:700,fontSize:13}}>🆘 {alerts.length}</button>}
          <NetworkBadge onCheckConnection={onCheckConnection}/>
          <button onClick={onRefresh} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",borderRadius:10,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:600}} title="Refresh" className={refreshing?"spinning":""}>🔄</button>
          <button onClick={()=>{if(window.confirm("Yakin ingin keluar dari aplikasi?"))onLogout();}} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",borderRadius:10,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:600}}>Keluar</button>
        </div>
      </div>
      <div style={{background:"#fff",borderBottom:"1px solid #f3f4f6",padding:"10px 20px",display:"flex",gap:20,overflowX:"auto"}}>
        {[{l:"Tenant",v:tenants.length,c:"#ea580c"},{l:"Tx Hari Ini",v:todayTx.length,c:"#0284c7"},{l:"Omzet Hari Ini",v:idr(todayTx.reduce((s,t)=>s+t.total,0)),c:"#16a34a"}].map(s=>(
          <div key={s.l} style={{whiteSpace:"nowrap"}}><p style={{color:"#6b7280",fontSize:12,margin:0,fontWeight:500}}>{s.l}</p><p style={{color:s.c,fontSize:17,fontWeight:800,margin:"2px 0 0"}}>{s.v}</p></div>
        ))}
      </div>
      <div style={{background:"#fff",borderBottom:"1px solid #f3f4f6",display:"flex",padding:"0 12px",overflowX:"auto"}}>
        {tabs.map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k)} style={{padding:"13px 14px",background:"none",border:"none",borderBottom:tab===t.k?"3px solid #ea580c":"3px solid transparent",color:tab===t.k?"#ea580c":"#6b7280",fontWeight:tab===t.k?700:500,cursor:"pointer",fontSize:13,whiteSpace:"nowrap"}}>
            {t.i} {t.l}
          </button>
        ))}
      </div>
      <div style={{padding:20,maxWidth:1100,margin:"0 auto"}} className="fade-in">
        {tab==="tenants"&&<AdminTenants {...props}/>}
        {tab==="admins"&&<AdminUsers {...props}/>}
        {tab==="wallet"&&<KasirTopUp {...props} adminData={{name:"Super Admin",username:"superadmin"}} isSuperAdmin={true}/>}
        {tab==="po"&&<POManager {...props} adminData={{name:"Super Admin"}} isSuperAdmin={true} onSaveMenus={props.onSaveMenus}/>}
        {tab==="transactions"&&<AdminTransactions {...props} filterDate={filterDate} setFilterDate={setFilterDate} isSuperAdmin={true} adminData={{name:"Super Admin"}}/>}
        {tab==="report"&&<AdminTenantReport {...props} filterDate={filterDate} setFilterDate={setFilterDate}/>}
        {tab==="summary"&&<AdminSummary {...props} filterDate={filterDate} setFilterDate={setFilterDate}/>}
        {tab==="settings"&&<SettingsPanel {...props}/>}
        {tab==="backup"&&<BackupPanel {...props} isSuperAdmin={true}/>}
        {tab==="reset"&&<ResetPanel {...props}/>}      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN BIASA DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════
function AdminDashboard(props){
  const {tenants,transactions,settings,alerts,allAlerts,onSaveAlerts,adminData,onRefresh,refreshing,onLogout,onCheckConnection}=props;
  const [tab,setTab]=useState("tenants");
  const [filterDate,setFilterDate]=useState(todayStr());
  const {BackConfirmModal}=useBackConfirm(true);
  const [showAlertPop,setShowAlertPop]=useState(true);
  const todayTx=transactions.filter(t=>t.date===todayStr()&&!t.refunded);
  const tabs=[
    {k:"tenants",i:"🏪",l:"Tenant"},{k:"wallet",i:"💰",l:"Kasir Top Up"},
    {k:"po",i:"📦",l:"Pre-Order"},
    {k:"transactions",i:"📋",l:"Transaksi"},
    {k:"report",i:"📑",l:"Laporan"},{k:"summary",i:"📊",l:"Rekap"},{k:"backup",i:"💾",l:"Backup"},
  ];
  const dismissAlerts=async()=>{await onSaveAlerts(allAlerts.map(a=>({...a,read:true})));setShowAlertPop(false);};

  return(
    <div style={{minHeight:"100vh",background:"#fafaf9"}}>
      <BackConfirmModal/>
      {showAlertPop&&<AlertPopup alerts={alerts} onDismiss={dismissAlerts}/>}
      <div style={{background:"linear-gradient(90deg,#4c1d95,#7c3aed)",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:"0 4px 20px rgba(124,58,237,.3)",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:26}}>🔑</span>
          <div><h1 style={{color:"#fff",fontSize:18,fontWeight:800,margin:0}}>BazaarPOS — Admin</h1>
            <p style={{color:"#ddd6fe",fontSize:11,margin:0}}>{adminData?.name||adminData?.username||"Admin"}</p></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{color:"#fff",fontSize:16,fontWeight:800}}>{settings.bazaarName}</span>
          {alerts.length>0&&<button onClick={()=>setShowAlertPop(true)} className="pulse" style={{background:"#dc2626",color:"#fff",border:"none",borderRadius:10,padding:"7px 14px",cursor:"pointer",fontWeight:700,fontSize:13}}>🆘 {alerts.length}</button>}
          <NetworkBadge onCheckConnection={onCheckConnection}/>
          <button onClick={onRefresh} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",borderRadius:10,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:600}} title="Refresh" className={refreshing?"spinning":""}>🔄</button>
          <button onClick={()=>{if(window.confirm("Yakin ingin keluar dari aplikasi?"))onLogout();}} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",borderRadius:10,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:600}}>Keluar</button>
        </div>
      </div>
      <div style={{background:"#fff",borderBottom:"1px solid #f3f4f6",padding:"10px 20px",display:"flex",gap:20,overflowX:"auto"}}>
        {[{l:"Tenant",v:tenants.length,c:"#7c3aed"},{l:"Tx Hari Ini",v:todayTx.length,c:"#0284c7"},{l:"Omzet Hari Ini",v:idr(todayTx.reduce((s,t)=>s+t.total,0)),c:"#16a34a"}].map(s=>(
          <div key={s.l} style={{whiteSpace:"nowrap"}}><p style={{color:"#6b7280",fontSize:12,margin:0,fontWeight:500}}>{s.l}</p><p style={{color:s.c,fontSize:17,fontWeight:800,margin:"2px 0 0"}}>{s.v}</p></div>
        ))}
      </div>
      <div style={{background:"#fff",borderBottom:"1px solid #f3f4f6",display:"flex",padding:"0 12px",overflowX:"auto"}}>
        {tabs.map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k)} style={{padding:"13px 14px",background:"none",border:"none",borderBottom:tab===t.k?"3px solid #7c3aed":"3px solid transparent",color:tab===t.k?"#7c3aed":"#6b7280",fontWeight:tab===t.k?700:500,cursor:"pointer",fontSize:13,whiteSpace:"nowrap"}}>
            {t.i} {t.l}
          </button>
        ))}
      </div>
      <div style={{padding:20,maxWidth:1100,margin:"0 auto"}} className="fade-in">
        {tab==="tenants"&&<AdminTenants {...props}/>}
        {tab==="wallet"&&<KasirTopUp {...props}/>}
        {tab==="transactions"&&<AdminTransactions {...props} filterDate={filterDate} setFilterDate={setFilterDate} adminData={adminData}/>}
        {tab==="po"&&<POManager {...props} adminData={adminData}/>}
        {tab==="report"&&<AdminTenantReport {...props} filterDate={filterDate} setFilterDate={setFilterDate}/>}
        {tab==="summary"&&<AdminSummary {...props} filterDate={filterDate} setFilterDate={setFilterDate}/>}
        {tab==="backup"&&<BackupPanel {...props} isSuperAdmin={false}/>}
      </div>
    </div>
  );
}

// ─── Admin Users ──────────────────────────────────────────────────────────────
function AdminUsers({admins,onSaveAdmins}){
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState({username:"",password:"",name:"",isPOManager:false});
  const openAdd=()=>{setForm({username:"",password:"",name:"",isPOManager:false});setEditing(null);setShowForm(true);};
  const openEdit=a=>{setForm({username:a.username,password:a.password,name:a.name,isPOManager:!!a.isPOManager});setEditing(a.id);setShowForm(true);};
  const save=async()=>{
    if(!form.username||!form.password||!form.name){alert("Semua field harus diisi!");return;}
    if(!editing&&admins.find(a=>a.username===form.username)){alert("Username sudah ada!");return;}
    try{
      await onSaveAdmins(editing?admins.map(a=>a.id===editing?{...a,...form}:a):[...admins,{id:uid(),...form}]);
      setShowForm(false);
    }catch(e){
      alert(`❌ GAGAL MENYIMPAN! Data admin tidak tersimpan. Cek koneksi, lalu coba lagi.\n(${e.message})`);
    }
  };
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div><h2 style={{margin:0,fontSize:20,fontWeight:800,color:"#1c0a00"}}>Kelola Admin</h2>
          <p style={{color:"#9ca3af",margin:"4px 0 0",fontSize:13}}>{admins.length} admin terdaftar</p></div>
        <button onClick={openAdd} style={{background:"#7c3aed",color:"#fff",border:"none",borderRadius:12,padding:"10px 18px",fontWeight:700,cursor:"pointer",fontSize:13}}>+ Tambah Admin</button>
      </div>
      {showForm&&<Modal title={editing?"Edit Admin":"Tambah Admin Baru"} onClose={()=>setShowForm(false)} accent="#7c3aed">
        <FI label="Nama Lengkap" placeholder="Nama Admin" value={form.name} onChange={v=>setForm({...form,name:v})} accent="#7c3aed"/>
        <FI label="Username" placeholder="admin01" value={form.username} onChange={v=>setForm({...form,username:v})} disabled={!!editing} accent="#7c3aed"/>
        <FI label="Password" placeholder="Password" value={form.password} onChange={v=>setForm({...form,password:v})} accent="#7c3aed"/>
        {/* Hak akses Manager PO */}
        <div style={{background:"#f5f0ff",borderRadius:12,padding:"12px 16px",marginBottom:14}}>
          <label style={{display:"flex",alignItems:"flex-start",gap:12,cursor:"pointer",userSelect:"none"}}>
            <input type="checkbox" checked={form.isPOManager} onChange={e=>setForm({...form,isPOManager:e.target.checked})}
              style={{width:18,height:18,marginTop:2,cursor:"pointer",accentColor:"#7c3aed"}}/>
            <div>
              <p style={{margin:0,fontWeight:700,color:"#4c1d95",fontSize:14}}>📦 Manager PO</p>
              <p style={{margin:"3px 0 0",color:"#7c3aed",fontSize:12}}>Admin ini bisa mengatur batas kuota PO di setiap menu tenant.</p>
            </div>
          </label>
        </div>
        <div style={{display:"flex",gap:12,marginTop:8}}>
          <button onClick={()=>setShowForm(false)} style={btnSec}>Batal</button>
          <button onClick={save} style={{...btnSec,background:"#7c3aed",color:"#fff",border:"none"}}>Simpan</button>
        </div>
      </Modal>}
      {admins.length===0?<EmptyState icon="🔑" text="Belum ada admin terdaftar."/>:
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
          {admins.map(a=>(
            <div key={a.id} className="card-hover" style={{background:"#fff",border:"1px solid #f3f4f6",borderRadius:16,padding:20,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                <div style={{width:44,height:44,borderRadius:12,background:"#f5f3ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🔑</div>
                <div>
                  <p style={{fontWeight:800,fontSize:16,color:"#1c0a00",margin:0}}>{a.name}</p>
                  <p style={{color:"#7c3aed",fontSize:12,margin:"2px 0 0",fontWeight:600}}>@{a.username}</p>
                </div>
              </div>
              {/* Badge Manager PO */}
              {a.isPOManager&&(
                <div style={{background:"#f5f0ff",border:"1px solid #c4b5fd",borderRadius:8,padding:"5px 10px",marginBottom:10,display:"inline-block"}}>
                  <span style={{fontSize:12,color:"#4c1d95",fontWeight:700}}>📦 Manager PO</span>
                </div>
              )}
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>openEdit(a)} style={{flex:1,padding:"8px",background:"#eff6ff",color:"#2563eb",border:"none",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:13}}>✏️ Edit</button>
                <button onClick={async()=>{if(window.confirm("Hapus admin ini?")){try{await onSaveAdmins(admins.filter(x=>x.id!==a.id));}catch(e){alert("❌ GAGAL HAPUS! "+e.message);}}}} style={{flex:1,padding:"8px",background:"#fef2f2",color:"#dc2626",border:"none",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:13}}>🗑️ Hapus</button>
              </div>
            </div>
          ))}
        </div>}
    </div>
  );
}

// ─── Admin Tenants ────────────────────────────────────────────────────────────
function AdminTenants({tenants,transactions,menus,onSaveTenants}){
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState({code:"",name:"",password:""});
  const [viewMenuOf,setViewMenuOf]=useState(null); // tenant object yang sedang dilihat menunya

  const openAdd=()=>{setForm({code:"",name:"",password:""});setEditing(null);setShowForm(true);};
  const openEdit=t=>{setForm({code:t.code,name:t.name,password:t.password});setEditing(t.id);setShowForm(true);};
  const save=async()=>{
    if(!form.code||!form.name||!form.password){alert("Semua field harus diisi!");return;}
    if(!editing&&tenants.find(t=>t.code===form.code)){alert("Kode tenant sudah ada!");return;}
    try{
      await onSaveTenants(editing?tenants.map(t=>t.id===editing?{...t,...form}:t):[...tenants,{id:uid(),...form}]);
      setShowForm(false);
    }catch(e){
      alert(`❌ GAGAL MENYIMPAN! Data tenant tidak tersimpan. Cek koneksi, lalu coba lagi.\n(${e.message})`);
    }
  };
  const del=async id=>{
    if(transactions.some(t=>t.tenantId===id)){alert("❌ Tenant tidak bisa dihapus karena sudah memiliki data transaksi!");return;}
    if(!window.confirm("Hapus tenant ini?"))return;
    try{ await onSaveTenants(tenants.filter(t=>t.id!==id)); }
    catch(e){ alert("❌ GAGAL HAPUS! "+e.message); }
  };

  return(
    <div>
      {/* ── Modal Daftar Menu Tenant ── */}
      {viewMenuOf&&(()=>{
        const tenantMenus=(menus||[]).filter(m=>m.tenantId===viewMenuOf.id);
        const todayTx=transactions.filter(t=>t.tenantId===viewMenuOf.id&&t.date===todayStr()&&!t.refunded);
        const totalOmzet=todayTx.reduce((s,t)=>s+t.total,0);
        // Hitung qty terjual per menu (semua waktu)
        const soldQty={};
        transactions.filter(t=>t.tenantId===viewMenuOf.id)
          .forEach(tx=>tx.items.forEach(it=>{soldQty[it.menuCode]=(soldQty[it.menuCode]||0)+it.qty;}));
        return(
          <Modal title="" onClose={()=>setViewMenuOf(null)}>
            {/* Header tenant */}
            <div style={{background:"linear-gradient(135deg,#431407,#ea580c)",borderRadius:14,padding:"16px 18px",marginBottom:16,display:"flex",alignItems:"center",gap:14}}>
              <div style={{width:48,height:48,borderRadius:14,background:"rgba(255,255,255,.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>🍽️</div>
              <div>
                <span style={{background:"rgba(255,255,255,.25)",color:"#fff",fontSize:11,fontWeight:800,padding:"2px 10px",borderRadius:20}}>{viewMenuOf.code}</span>
                <p style={{color:"#fff",fontWeight:800,fontSize:17,margin:"6px 0 2px"}}>{viewMenuOf.name}</p>
                <p style={{color:"#fed7aa",fontSize:12,margin:0}}>{tenantMenus.length} menu terdaftar</p>
              </div>
            </div>

            {/* Statistik singkat */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              <div style={{background:"#fff7ed",borderRadius:12,padding:"10px 14px",textAlign:"center"}}>
                <p style={{margin:0,color:"#9ca3af",fontSize:11,fontWeight:600}}>Transaksi Hari Ini</p>
                <p style={{margin:"4px 0 0",color:"#ea580c",fontWeight:900,fontSize:20}}>{todayTx.length}</p>
              </div>
              <div style={{background:"#f0fdf4",borderRadius:12,padding:"10px 14px",textAlign:"center"}}>
                <p style={{margin:0,color:"#9ca3af",fontSize:11,fontWeight:600}}>Omzet Hari Ini</p>
                <p style={{margin:"4px 0 0",color:"#16a34a",fontWeight:900,fontSize:16}}>{idr(totalOmzet)}</p>
              </div>
            </div>

            {/* Daftar menu */}
            <p style={{fontWeight:700,color:"#374151",fontSize:13,margin:"0 0 10px"}}>📋 Daftar Menu</p>
            {tenantMenus.length===0
              ?<div style={{textAlign:"center",padding:"28px 0",color:"#9ca3af"}}>
                <div style={{fontSize:36,marginBottom:8}}>🍽️</div>
                <p style={{margin:0,fontSize:13}}>Tenant ini belum menambahkan menu.</p>
              </div>
              :<div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:340,overflowY:"auto",paddingRight:4}}>
                {tenantMenus.map((m,i)=>(
                  <div key={m.id} style={{display:"flex",alignItems:"center",gap:12,background:"#f9fafb",borderRadius:12,padding:"11px 14px",border:"1px solid #f3f4f6"}}>
                    {/* Nomor urut */}
                    <div style={{width:28,height:28,borderRadius:8,background:"#fff7ed",border:"1px solid #fed7aa",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,color:"#ea580c",fontSize:13,flexShrink:0}}>{i+1}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3}}>
                        <span style={{background:"#fff7ed",color:"#ea580c",fontSize:10,fontWeight:800,padding:"2px 7px",borderRadius:10,border:"1px solid #fed7aa",whiteSpace:"nowrap"}}>{m.code}</span>
                        <span style={{fontWeight:700,color:"#1c0a00",fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{color:"#16a34a",fontWeight:800,fontSize:14}}>{idr(m.price)}</span>
                        {soldQty[m.code]&&<span style={{color:"#6b7280",fontSize:11}}>• Terjual: <strong>{soldQty[m.code]}</strong> pcs</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>}

            <button onClick={()=>setViewMenuOf(null)}
              style={{width:"100%",padding:"12px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif",marginTop:16}}
              onMouseOver={e=>e.currentTarget.style.background="#e5e7eb"} onMouseOut={e=>e.currentTarget.style.background="#f3f4f6"}>
              Tutup
            </button>
          </Modal>
        );
      })()}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div><h2 style={{margin:0,fontSize:20,fontWeight:800,color:"#1c0a00"}}>Daftar Tenant</h2>
          <p style={{color:"#9ca3af",margin:"4px 0 0",fontSize:13}}>{tenants.length} tenant terdaftar</p></div>
        <button onClick={openAdd} style={{background:"#ea580c",color:"#fff",border:"none",borderRadius:12,padding:"10px 18px",fontWeight:700,cursor:"pointer",fontSize:13}} onMouseOver={e=>e.currentTarget.style.background="#c2410c"} onMouseOut={e=>e.currentTarget.style.background="#ea580c"}>+ Tambah Tenant</button>
      </div>

      {showForm&&<Modal title={editing?"Edit Tenant":"Tambah Tenant Baru"} onClose={()=>setShowForm(false)}>
        <FI label="Kode Tenant" placeholder="T001" value={form.code} onChange={v=>setForm({...form,code:v.toUpperCase()})} disabled={!!editing}/>
        <FI label="Nama Tenant" placeholder="Warung Sate Madura" value={form.name} onChange={v=>setForm({...form,name:v})}/>
        <FI label="Kode Akses" placeholder="Password untuk login" value={form.password} onChange={v=>setForm({...form,password:v})}/>
        <div style={{display:"flex",gap:12,marginTop:8}}>
          <button onClick={()=>setShowForm(false)} style={btnSec}>Batal</button>
          <button onClick={save} style={btnOrg}>Simpan</button>
        </div>
      </Modal>}

      {tenants.length===0?<EmptyState icon="🏪" text="Belum ada tenant."/>:
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
          {tenants.map(t=>{
            const hasTx=transactions.some(tx=>tx.tenantId===t.id);
            const menuCount=(menus||[]).filter(m=>m.tenantId===t.id).length;
            return(
              <div key={t.id} style={{background:"#fff",border:"1px solid #f3f4f6",borderRadius:18,padding:22,boxShadow:"0 2px 8px rgba(0,0,0,.06)",transition:"all .2s"}}>
                {/* Area klik untuk lihat menu — seluruh bagian atas card */}
                <div onClick={()=>setViewMenuOf(t)} style={{cursor:"pointer"}}
                  onMouseOver={e=>e.currentTarget.parentElement.style.boxShadow="0 8px 24px rgba(234,88,12,.15)"}
                  onMouseOut={e=>e.currentTarget.parentElement.style.boxShadow="0 2px 8px rgba(0,0,0,.06)"}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:10}}>
                    <div>
                      <span style={{background:"#fff7ed",color:"#ea580c",fontSize:12,fontWeight:800,padding:"4px 10px",borderRadius:20,border:"1px solid #fed7aa"}}>{t.code}</span>
                      <p style={{fontWeight:800,fontSize:17,color:"#1c0a00",margin:"10px 0 4px"}}>{t.name}</p>
                      <p style={{color:"#9ca3af",fontSize:13,margin:0}}>Akses: {"●".repeat(Math.min(t.password.length,8))}</p>
                    </div>
                    <div style={{width:46,height:46,borderRadius:14,background:"#fff7ed",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🍽️</div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
                    {hasTx&&<span style={{background:"#f0fdf4",color:"#16a34a",fontSize:11,fontWeight:600,padding:"3px 9px",borderRadius:10}}>✓ Ada transaksi</span>}
                    <span style={{background:"#fff7ed",color:"#ea580c",fontSize:11,fontWeight:600,padding:"3px 9px",borderRadius:10}}>🍽️ {menuCount} menu</span>
                  </div>
                  {/* Hint klik */}
                  <div style={{background:"#f9fafb",borderRadius:10,padding:"7px 12px",display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:12}}>
                    <span style={{fontSize:13}}>👁️</span>
                    <span style={{color:"#6b7280",fontSize:12,fontWeight:600}}>Klik untuk lihat daftar menu</span>
                  </div>
                </div>
                {/* Tombol aksi */}
                <div style={{display:"flex",gap:8}}>
                  <button onClick={e=>{e.stopPropagation();openEdit(t);}} style={{flex:1,padding:"9px",background:"#eff6ff",color:"#2563eb",border:"none",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:13}}>✏️ Edit</button>
                  <button onClick={e=>{e.stopPropagation();del(t.id);}} title={hasTx?"Tidak bisa dihapus — sudah ada transaksi":""} style={{flex:1,padding:"9px",background:hasTx?"#f9fafb":"#fef2f2",color:hasTx?"#9ca3af":"#dc2626",border:"none",borderRadius:10,cursor:hasTx?"not-allowed":"pointer",fontWeight:600,fontSize:13}}>🗑️ {hasTx?"Terkunci":"Hapus"}</button>
                </div>
              </div>
            );
          })}
        </div>}
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
function SettingsPanel({settings,onSaveSettings}){
  const [form,setForm]=useState({...settings});
  const save=async()=>{await onSaveSettings(form);alert("✅ Pengaturan berhasil disimpan!");};
  return(
    <div style={{maxWidth:600}}>
      <h2 style={{margin:"0 0 20px",fontSize:20,fontWeight:800,color:"#1c0a00"}}>⚙️ Pengaturan Sistem</h2>
      <Sec label="🏪 Nama Kegiatan Bazaar">
        <FI label="Nama Bazaar / Event" placeholder="Bazaar Ramadhan 2026" value={form.bazaarName||""} onChange={v=>setForm({...form,bazaarName:v})}/>
      </Sec>
      <Sec label="🖨️ Teks Footer Struk Thermal">
        <FI label="Baris 1" placeholder="Terima kasih!" value={form.receiptFooter1||""} onChange={v=>setForm({...form,receiptFooter1:v})}/>
        <FI label="Baris 2" placeholder="Selamat menikmati :)" value={form.receiptFooter2||""} onChange={v=>setForm({...form,receiptFooter2:v})}/>
        <div style={{background:"#f9fafb",borderRadius:12,padding:14,marginTop:4,textAlign:"center"}}>
          <p style={{color:"#6b7280",fontSize:12,margin:"0 0 6px",fontWeight:600}}>Preview:</p>
          <p style={{fontFamily:"'Courier New',monospace",fontSize:12,margin:0}}>{form.receiptFooter1||"—"}</p>
          <p style={{fontFamily:"'Courier New',monospace",fontSize:11,margin:"2px 0 0",color:"#6b7280"}}>{form.receiptFooter2||"—"}</p>
        </div>
      </Sec>
      <Sec label="📱 WhatsApp (Fonnte API)">
        <FI label="Fonnte API Token" placeholder="Token dari fonnte.com" value={form.fonnteToken||""} onChange={v=>setForm({...form,fonnteToken:v})}/>
        <FI label="Nomor WA Bazaar (pengirim)" placeholder="628123456789" value={form.bazaarPhone||""} onChange={v=>setForm({...form,bazaarPhone:v})}/>
        <div style={{background:"#f0f9ff",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#0284c7"}}>
          💡 Daftar di <strong>fonnte.com</strong> → hubungkan nomor WA → copy API Token ke sini.
          Diperlukan untuk kirim notifikasi saldo otomatis ke pelanggan.
        </div>
      </Sec>
      <Sec label="🔐 Keamanan Akun">
        <FI label="Username Super Admin" placeholder="superadmin" value={form.saUser||""} onChange={v=>setForm({...form,saUser:v})}/>
        <FI label="Password Super Admin" placeholder="Password baru" value={form.saPass||""} onChange={v=>setForm({...form,saPass:v})} type="password"/>
        <FI label="Password Reset Data" placeholder="Password khusus reset" value={form.resetPass||""} onChange={v=>setForm({...form,resetPass:v})} type="password"/>
      </Sec>
      <button onClick={save} style={{...btnOrg,width:"100%",padding:"14px"}} onMouseOver={e=>e.currentTarget.style.background="#c2410c"} onMouseOut={e=>e.currentTarget.style.background="#ea580c"}>💾 Simpan Pengaturan</button>
    </div>
  );
}

// ─── Backup Panel ─────────────────────────────────────────────────────────────
function BackupPanel({tenants,menus,transactions,settings,admins,customers,walletLogs,orders,onSaveSettings,onRestoreBackup,isSuperAdmin}){
  const [backups,setBackups]=useState(getLocalBackups());
  const [restoring,setRestoring]=useState(false);
  const [previewData,setPreviewData]=useState(null);
  const [previewSrc,setPreviewSrc]=useState("");
  const [restoreStep,setRestoreStep]=useState(0); // 0=preview, 1=konfirmasi, 2=selesai
  const [restoreErr,setRestoreErr]=useState("");
  const [restoredSummary,setRestoredSummary]=useState(null);
  const [backupMsg,setBackupMsg]=useState("");
  const fileRef=useRef(null);
  // Semua koleksi ikut di-backup
  const data={tenants,menus,transactions,settings,admins,customers,walletLogs,orders};

  // ── Backup manual ──────────────────────────────────────────────────────────
  const manual=()=>{
    const ok=doLocalBackup(data);
    setBackups(getLocalBackups());
    setBackupMsg(ok?"✅ Backup lokal berhasil disimpan!":"❌ Gagal menyimpan backup.");
    setTimeout(()=>setBackupMsg(""),3500);
  };

  // ── Baca backup lokal untuk preview ───────────────────────────────────────
  const previewLocal=(key)=>{
    try{
      const raw=localStorage.getItem(key);
      if(!raw){setRestoreErr("Data backup tidak ditemukan di browser.");return;}
      const parsed=JSON.parse(raw);
      setPreviewData(parsed);
      setPreviewSrc(`local:${key}`);
      setRestoreStep(0);setRestoreErr("");
    }catch{setRestoreErr("Gagal membaca backup lokal.");}
  };

  // ── Upload file .json ──────────────────────────────────────────────────────
  const handleFileUpload=(e)=>{
    const file=e.target.files[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      try{
        const parsed=JSON.parse(ev.target.result);
        if(!parsed.tenants&&!parsed.transactions){setRestoreErr("File bukan backup BazaarPOS yang valid!");return;}
        setPreviewData(parsed);setPreviewSrc("file");
        setRestoreStep(0);setRestoreErr("");
      }catch{setRestoreErr("File tidak bisa dibaca. Pastikan format .json yang benar.");}
    };
    reader.readAsText(file);
    e.target.value="";
  };

  // ── Eksekusi restore atomik ────────────────────────────────────────────────
  const doRestore=async()=>{
    if(!previewData)return;
    setRestoring(true);setRestoreErr("");
    try{
      await onRestoreBackup(previewData);
      // Simpan summary sebelum reset previewData
      setRestoredSummary({
        tenants:(previewData.tenants||[]).length,
        menus:(previewData.menus||[]).length,
        transactions:(previewData.transactions||[]).length,
        admins:(previewData.admins||[]).length,
        customers:(previewData.customers||[]).length,
        walletLogs:(previewData.walletLogs||[]).length,
        orders:(previewData.orders||[]).length,
        backupTime:previewData.backupTime,
      });
      setRestoreStep(2);
    }catch(e){
      setRestoreErr("Gagal restore: "+e.message);
    }
    setRestoring(false);
  };

  const cancelPreview=()=>{
    setPreviewData(null);setPreviewSrc("");
    setRestoreStep(0);setRestoreErr("");setRestoredSummary(null);
  };

  const bkNum=i=>backups.findIndex(b=>`local:${b.key}`===previewSrc)===i;

  return(
    <div style={{maxWidth:640}}>
      <h2 style={{margin:"0 0 20px",fontSize:20,fontWeight:800,color:"#1c0a00"}}>💾 Backup & Restore Data</h2>

      {/* ── Backup Otomatis ── */}
      <Sec label="⚡ Backup Otomatis">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <div>
            <p style={{margin:0,fontWeight:600,color:"#374151"}}>Auto Backup ke Browser</p>
            <p style={{margin:"2px 0 0",color:"#9ca3af",fontSize:12}}>Simpan otomatis ke localStorage browser</p>
          </div>
          <button onClick={async()=>{try{await onSaveSettings({...settings,autoBackup:!settings.autoBackup});}catch(e){alert("❌ Gagal simpan: "+e.message);}}}
            style={{padding:"8px 18px",background:settings.autoBackup?"#16a34a":"#f3f4f6",color:settings.autoBackup?"#fff":"#6b7280",border:"none",borderRadius:20,fontWeight:700,cursor:"pointer",fontSize:13,transition:"all .2s"}}>
            {settings.autoBackup?"🟢 Aktif":"⚫ Nonaktif"}
          </button>
        </div>
        {settings.autoBackup&&(
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <label style={{fontSize:13,color:"#374151",fontWeight:600}}>Interval</label>
            <select value={settings.backupInterval||30} onChange={async e=>{try{await onSaveSettings({...settings,backupInterval:parseInt(e.target.value)});}catch(err){alert("❌ Gagal simpan: "+err.message);}}}
              style={{border:"2px solid #e5e7eb",borderRadius:10,padding:"8px 12px",fontSize:14,color:"#111",outline:"none",cursor:"pointer"}}>
              {[5,10,15,30,60].map(v=><option key={v} value={v}>{v} menit</option>)}
            </select>
          </div>
        )}
      </Sec>

      {/* ── Backup Manual ── */}
      <Sec label="🖐️ Backup Manual">
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          <button onClick={manual} style={{...btnOrg,flex:1,padding:"12px"}}
            onMouseOver={e=>e.currentTarget.style.background="#c2410c"} onMouseOut={e=>e.currentTarget.style.background="#ea580c"}>
            💾 Simpan ke Browser
          </button>
          <button onClick={()=>downloadBackup(data)}
            style={{flex:1,padding:"12px",background:"#0284c7",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
            📥 Download .json
          </button>
        </div>
        {backupMsg&&(
          <div className="pop-in" style={{marginTop:12,padding:"10px 14px",borderRadius:12,background:backupMsg.startsWith("✅")?"#f0fdf4":"#fef2f2",border:`1px solid ${backupMsg.startsWith("✅")?"#bbf7d0":"#fca5a5"}`,color:backupMsg.startsWith("✅")?"#16a34a":"#dc2626",fontWeight:600,fontSize:13}}>
            {backupMsg}
          </div>
        )}
        <p style={{color:"#9ca3af",fontSize:12,margin:"10px 0 0"}}>💡 Download .json untuk backup di luar browser — lebih aman untuk jangka panjang.</p>
      </Sec>

      {/* ── Riwayat Backup Lokal ── */}
      <Sec label="📂 Riwayat Backup Lokal (Maks. 5)">
        {backups.length===0
          ?<EmptyState icon="📂" text="Belum ada backup lokal."/>
          :<div style={{display:"flex",flexDirection:"column",gap:8}}>
            {backups.map((b,i)=>(
              <div key={b.key} style={{background:"#f9fafb",borderRadius:12,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div>
                  <p style={{margin:0,fontWeight:700,color:"#1c0a00",fontSize:14}}>Backup #{i+1}</p>
                  <p style={{margin:"2px 0 0",color:"#9ca3af",fontSize:12}}>{new Date(b.time).toLocaleString("id-ID")}</p>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{background:"#f0fdf4",color:"#16a34a",fontSize:12,fontWeight:600,padding:"4px 10px",borderRadius:10}}>✓ Tersimpan</span>
                  {isSuperAdmin&&(
                    <button onClick={()=>previewLocal(b.key)}
                      style={{padding:"7px 14px",background:"#fff7ed",color:"#ea580c",border:"1px solid #fed7aa",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:12,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
                      onMouseOver={e=>e.currentTarget.style.background="#fef3c7"} onMouseOut={e=>e.currentTarget.style.background="#fff7ed"}>
                      🔄 Restore
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>}
      </Sec>

      {/* ── Restore dari File (Super Admin only) ── */}
      {isSuperAdmin&&(
        <Sec label="📤 Restore dari File .json">
          <p style={{color:"#6b7280",fontSize:13,margin:"0 0 14px"}}>Upload file backup <code style={{background:"#f3f4f6",padding:"2px 6px",borderRadius:6}}>.json</code> yang pernah didownload.</p>
          <input ref={fileRef} type="file" accept=".json" onChange={handleFileUpload} style={{display:"none"}}/>
          <button onClick={()=>fileRef.current&&fileRef.current.click()}
            style={{width:"100%",padding:"13px",background:"#f5f3ff",color:"#7c3aed",border:"2px dashed #c4b5fd",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
            onMouseOver={e=>e.currentTarget.style.background="#ede9fe"} onMouseOut={e=>e.currentTarget.style.background="#f5f3ff"}>
            📂 Pilih File Backup .json
          </button>
          {restoreErr&&!previewData&&(
            <div className="pop-in" style={{marginTop:12,padding:"10px 14px",borderRadius:12,background:"#fef2f2",border:"1px solid #fca5a5",color:"#dc2626",fontWeight:600,fontSize:13}}>
              ❌ {restoreErr}
            </div>
          )}
        </Sec>
      )}

      {/* ── Preview & Konfirmasi Restore ── */}
      {previewData&&restoreStep===0&&(
        <div className="pop-in" style={{background:"#fff",border:"2px solid #f97316",borderRadius:18,padding:22,boxShadow:"0 8px 32px rgba(249,115,22,.2)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
            <div>
              <p style={{fontWeight:800,color:"#ea580c",fontSize:16,margin:"0 0 4px"}}>🔍 Preview Data Backup</p>
              <p style={{color:"#6b7280",fontSize:12,margin:0}}>
                Sumber: {previewSrc==="file"?"File .json yang diupload":`Backup lokal #${backups.findIndex(b=>`local:${b.key}`===previewSrc)+1}`}
              </p>
            </div>
            <button onClick={cancelPreview} style={{background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:20,lineHeight:1,padding:0}}>✕</button>
          </div>

          {/* Statistik isi backup */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
            {[
              {l:"Tenant",     v:(previewData.tenants||[]).length,      c:"#ea580c",i:"🏪"},
              {l:"Menu",       v:(previewData.menus||[]).length,        c:"#16a34a",i:"🍽️"},
              {l:"Transaksi",  v:(previewData.transactions||[]).length, c:"#0284c7",i:"📋"},
              {l:"Admin",      v:(previewData.admins||[]).length,       c:"#7c3aed",i:"🔑"},
              {l:"Pelanggan",  v:(previewData.customers||[]).length,    c:"#ea580c",i:"👥"},
              {l:"Log Saldo",  v:(previewData.walletLogs||[]).length,   c:"#16a34a",i:"🪙"},
              {l:"Pre-Order",  v:(previewData.orders||[]).length,       c:"#0284c7",i:"📦"},
              {l:"",v:"",c:"",i:""},
            ].filter(s=>s.l).map(s=>(
              <div key={s.l} style={{background:"#f9fafb",borderRadius:12,padding:"10px 8px",textAlign:"center"}}>
                <div style={{fontSize:18,marginBottom:4}}>{s.i}</div>
                <p style={{margin:0,fontWeight:800,color:s.c,fontSize:17}}>{s.v}</p>
                <p style={{margin:"2px 0 0",color:"#6b7280",fontSize:11}}>{s.l}</p>
              </div>
            ))}
          </div>

          {previewData.backupTime&&(
            <div style={{background:"#f0fdf4",borderRadius:10,padding:"9px 14px",marginBottom:14}}>
              <p style={{margin:0,fontSize:13,color:"#374151"}}>📅 Waktu backup: <strong>{new Date(previewData.backupTime).toLocaleString("id-ID")}</strong></p>
            </div>
          )}

          <div style={{background:"#fef2f2",borderRadius:10,padding:"10px 14px",marginBottom:16}}>
            <p style={{margin:0,fontSize:13,color:"#dc2626",fontWeight:600}}>⚠️ Data saat ini akan <strong>digantikan sepenuhnya</strong>. Tindakan ini tidak bisa dibatalkan.</p>
          </div>

          {restoreErr&&(
            <div style={{background:"#fef2f2",borderRadius:10,padding:"9px 14px",marginBottom:14,color:"#dc2626",fontSize:13,fontWeight:600}}>
              ❌ {restoreErr}
            </div>
          )}

          <div style={{display:"flex",gap:12}}>
            <button onClick={cancelPreview} style={{...btnSec,flex:1}}>Batal</button>
            <button onClick={()=>setRestoreStep(1)}
              style={{flex:2,padding:"13px",background:"#ea580c",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
              onMouseOver={e=>e.currentTarget.style.background="#c2410c"} onMouseOut={e=>e.currentTarget.style.background="#ea580c"}>
              🔄 Lanjut ke Konfirmasi →
            </button>
          </div>
        </div>
      )}

      {/* ── Konfirmasi akhir sebelum restore ── */}
      {previewData&&restoreStep===1&&(
        <div className="pop-in" style={{background:"#fff",border:"2px solid #dc2626",borderRadius:18,padding:22,boxShadow:"0 8px 32px rgba(220,38,38,.2)"}}>
          <div style={{textAlign:"center",marginBottom:18}}>
            <div style={{fontSize:48,marginBottom:8}}>🚨</div>
            <h3 style={{margin:0,fontSize:17,fontWeight:800,color:"#dc2626"}}>Konfirmasi Restore</h3>
            <p style={{color:"#374151",fontSize:14,margin:"10px 0 0"}}>Semua data saat ini (<strong>{transactions.length} transaksi</strong>, <strong>{tenants.length} tenant</strong>) akan digantikan.</p>
            <p style={{color:"#9ca3af",fontSize:13,margin:"6px 0 0"}}>Tindakan ini <strong>tidak dapat dibatalkan</strong>.</p>
          </div>
          {restoreErr&&(
            <div style={{background:"#fef2f2",borderRadius:10,padding:"9px 14px",marginBottom:14,color:"#dc2626",fontSize:13,fontWeight:600}}>
              ❌ {restoreErr}
            </div>
          )}
          <div style={{display:"flex",gap:12}}>
            <button onClick={()=>setRestoreStep(0)} style={{...btnSec,flex:1}}>← Kembali</button>
            <button onClick={doRestore} disabled={restoring}
              style={{flex:2,padding:"13px",background:restoring?"#9ca3af":"#dc2626",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:restoring?"not-allowed":"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif",transition:"background .2s"}}
              onMouseOver={e=>{if(!restoring)e.currentTarget.style.background="#b91c1c";}} onMouseOut={e=>{if(!restoring)e.currentTarget.style.background="#dc2626";}}>
              {restoring?"⏳ Memulihkan data...":"🔄 RESTORE SEKARANG"}
            </button>
          </div>
        </div>
      )}

      {/* ── Selesai ── */}
      {restoreStep===2&&restoredSummary&&(
        <div className="pop-in" style={{background:"#fff",border:"2px solid #dcfce7",borderRadius:18,padding:32,textAlign:"center"}}>
          <div style={{fontSize:56,marginBottom:12}}>✅</div>
          <h3 style={{margin:"0 0 8px",fontSize:18,fontWeight:800,color:"#16a34a"}}>Restore Berhasil!</h3>
          <p style={{color:"#6b7280",fontSize:14,margin:"0 0 6px"}}>Semua data telah dipulihkan.</p>
          {restoredSummary.backupTime&&<p style={{color:"#9ca3af",fontSize:13,margin:"0 0 16px"}}>Dari backup: <strong>{new Date(restoredSummary.backupTime).toLocaleString("id-ID")}</strong></p>}
          <div style={{background:"#f0fdf4",borderRadius:12,padding:"12px 16px",marginBottom:20,textAlign:"left"}}>
            {[
              {l:"Tenant",     v:restoredSummary.tenants,      i:"🏪"},
              {l:"Menu",       v:restoredSummary.menus,        i:"🍽️"},
              {l:"Transaksi",  v:restoredSummary.transactions,  i:"📋"},
              {l:"Admin",      v:restoredSummary.admins,       i:"🔑"},
              {l:"Pelanggan",  v:restoredSummary.customers,    i:"👥"},
              {l:"Log Saldo",  v:restoredSummary.walletLogs,   i:"🪙"},
              {l:"Pre-Order",  v:restoredSummary.orders,       i:"📦"},
            ].map(s=>(
              <div key={s.l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:13,borderBottom:"1px dashed #dcfce7"}}>
                <span style={{color:"#374151"}}>{s.i} {s.l}</span>
                <span style={{fontWeight:700,color:"#16a34a"}}>{s.v} item dipulihkan</span>
              </div>
            ))}
          </div>
          <div style={{background:"#eff6ff",borderRadius:10,padding:"10px 14px",marginBottom:16}}>
            <p style={{margin:0,fontSize:13,color:"#2563eb",fontWeight:600}}>💡 Data sudah aktif. Buka tab lain untuk memverifikasi.</p>
          </div>
          <button onClick={cancelPreview}
            style={{width:"100%",padding:"13px",background:"#16a34a",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
            onMouseOver={e=>e.currentTarget.style.background="#15803d"} onMouseOut={e=>e.currentTarget.style.background="#16a34a"}>
            ✓ Selesai — Tutup
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Reset Panel ──────────────────────────────────────────────────────────────
function ResetPanel({transactions,tenants,menus,customers,walletLogs,orders,settings,onSaveTx,onSaveTenants,onSaveMenus,onSaveCustomers,onSaveWalletLogs,onSaveOrders}){
  const [pass,setPass]=useState("");
  const [unlocked,setUnlocked]=useState(false);
  const [mode,setMode]=useState(null);    // "tx" | "full" | "tenant"
  const [step,setStep]=useState(0);       // 0=idle,1=confirm1,2=confirm2,3=done
  const [loading,setLoading]=useState(false);
  const [doneMsg,setDoneMsg]=useState("");

  const txCount=transactions.length;
  const custCount=customers?.length||0;
  const tenantCount=tenants?.length||0;
  const menuCount=menus?.length||0;
  const txCleared=txCount===0;

  const tryUnlock=()=>{
    if(pass.trim()===(settings?.resetPass||"reset123")){setUnlocked(true);setPass("");setStep(0);setMode(null);}
    else alert("❌ Password reset salah!");
  };

  const doReset=async()=>{
    setLoading(true);
    try{
      if(mode==="tx"){
        await onSaveTx([]);
        await onSaveOrders([]);
        setDoneMsg(`✅ ${txCount} transaksi & ${orders?.length||0} data PO berhasil dihapus.`);
      } else if(mode==="full"){
        await onSaveTx([]);
        await onSaveOrders([]);
        await onSaveCustomers([]);
        await onSaveWalletLogs([]);
        setDoneMsg(`✅ Reset penuh selesai. Transaksi, PO, pelanggan & saldo dihapus.`);
      } else if(mode==="tenant"){
        await onSaveTenants([]);
        await onSaveMenus([]);
        setDoneMsg(`✅ ${tenantCount} tenant & ${menuCount} menu berhasil dihapus.`);
      }
      setStep(3);
    }catch(e){ alert("❌ Gagal reset: "+e.message); }
    setLoading(false);
  };

  const lockBack=()=>{setUnlocked(false);setStep(0);setMode(null);setPass("");setDoneMsg("");};
  const startMode=(m)=>{setMode(m);setStep(1);};

  // Info per mode
  const poCount=orders?.length||0;
  const modeInfo={
    tx:{icon:"📋",label:"Reset Transaksi & PO",color:"#ea580c",border:"#fed7aa",bg:"#fff7ed",
      desc:`Hapus semua transaksi (${txCount}) dan data Pre-Order (${poCount}). Data pelanggan & saldo tetap.`,
      confirm:`${txCount} transaksi dan ${poCount} data PO akan dihapus permanen.`},
    full:{icon:"🔥",label:"Reset Penuh (Event Baru)",color:"#dc2626",border:"#fca5a5",bg:"#fef2f2",
      desc:`Hapus SEMUA transaksi (${txCount}), PO (${poCount}), pelanggan (${custCount}), dan riwayat saldo. Gunakan untuk memulai event baru dari awal.`,
      confirm:`${txCount} transaksi, ${poCount} PO, ${custCount} pelanggan & semua riwayat saldo akan dihapus PERMANEN.`},
    tenant:{icon:"🏪",label:"Reset Tenant & Menu",color:"#7c3aed",border:"#c4b5fd",bg:"#f5f0ff",
      desc:`Hapus semua tenant (${tenantCount}) dan menu (${menuCount}). Hanya aktif setelah transaksi dikosongkan.`,
      confirm:`${tenantCount} tenant dan ${menuCount} menu akan dihapus permanen.`,
      disabled:!txCleared,
      disabledMsg:`Tidak bisa dihapus — masih ada ${txCount} transaksi aktif. Reset transaksi dulu.`},
  };

  return(
    <div style={{maxWidth:560}}>
      <h2 style={{margin:"0 0 6px",fontSize:20,fontWeight:800,color:"#dc2626"}}>🗑️ Reset Data</h2>
      <p style={{color:"#6b7280",fontSize:13,margin:"0 0 20px"}}>Hapus data sistem secara permanen. Gunakan dengan sangat hati-hati.</p>

      {/* ── TERKUNCI ── */}
      {!unlocked&&(
        <div style={{background:"#fff",borderRadius:18,padding:24,boxShadow:"0 2px 12px rgba(0,0,0,.06)"}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:52}}>🔒</div>
            <p style={{fontWeight:700,color:"#374151",margin:"8px 0 4px"}}>Panel ini dikunci</p>
            <p style={{color:"#9ca3af",fontSize:13,margin:0}}>Masukkan password reset untuk melanjutkan</p>
          </div>
          <FI label="Password Reset" placeholder="Masukkan password reset" value={pass} onChange={setPass} type="password" accent="#dc2626"/>
          <button onClick={tryUnlock}
            style={{width:"100%",padding:"13px",background:"#dc2626",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
            onMouseOver={e=>e.currentTarget.style.background="#b91c1c"} onMouseOut={e=>e.currentTarget.style.background="#dc2626"}>
            🔓 Buka Panel
          </button>
        </div>
      )}

      {/* ── TERBUKA — PILIH MODE ── */}
      {unlocked&&step===0&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {Object.entries(modeInfo).map(([k,m])=>(
            <div key={k} style={{background:"#fff",border:`2px solid ${m.border}`,borderRadius:16,padding:18}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap",marginBottom:10}}>
                <div style={{flex:1}}>
                  <p style={{margin:"0 0 4px",fontWeight:800,color:m.color,fontSize:15}}>{m.icon} {m.label}</p>
                  <p style={{margin:0,color:"#6b7280",fontSize:13}}>{m.desc}</p>
                  {m.disabled&&<p style={{margin:"6px 0 0",color:"#9ca3af",fontSize:12,fontWeight:600}}>🔒 {m.disabledMsg}</p>}
                </div>
              </div>
              <button onClick={()=>!m.disabled&&startMode(k)} disabled={m.disabled}
                style={{width:"100%",padding:"11px",background:m.disabled?"#f3f4f6":m.bg,color:m.disabled?"#9ca3af":m.color,border:`1px solid ${m.disabled?"#e5e7eb":m.border}`,borderRadius:10,fontWeight:700,cursor:m.disabled?"not-allowed":"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                {m.disabled?"🔒 Tidak Tersedia":`${m.icon} Lanjut Reset ${m.label}`}
              </button>
            </div>
          ))}
          <button onClick={lockBack}
            style={{padding:"12px",background:"#f3f4f6",color:"#6b7280",border:"none",borderRadius:12,fontWeight:600,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
            🔒 Kunci Panel
          </button>
        </div>
      )}

      {/* ── KONFIRMASI 1 ── */}
      {unlocked&&step===1&&mode&&(
        <div className="pop-in" style={{background:"#fff",borderRadius:18,padding:24,border:`2px solid ${modeInfo[mode].border}`}}>
          <div style={{textAlign:"center",marginBottom:18}}>
            <div style={{fontSize:48,marginBottom:8}}>⚠️</div>
            <h3 style={{margin:0,fontSize:18,fontWeight:800,color:modeInfo[mode].color}}>Konfirmasi — {modeInfo[mode].label}</h3>
            <p style={{color:"#374151",fontSize:14,margin:"10px 0 0"}}>{modeInfo[mode].confirm}</p>
            <p style={{color:"#9ca3af",fontSize:13,margin:"6px 0 0"}}>Tindakan ini <strong>tidak dapat dibatalkan.</strong></p>
          </div>
          <div style={{display:"flex",gap:12}}>
            <button onClick={()=>setStep(0)} style={{...btnSec,flex:1}}>Batal</button>
            <button onClick={()=>setStep(2)}
              style={{flex:1,padding:"13px",background:modeInfo[mode].color,color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
              Ya, Lanjutkan →
            </button>
          </div>
        </div>
      )}

      {/* ── KONFIRMASI 2 ── */}
      {unlocked&&step===2&&mode&&(
        <div className="pop-in" style={{background:"#fff",borderRadius:18,padding:24,border:"2px solid #dc2626"}}>
          <div style={{textAlign:"center",marginBottom:18}}>
            <div style={{fontSize:48,marginBottom:8}}>🚨</div>
            <h3 style={{margin:0,fontSize:18,fontWeight:800,color:"#dc2626"}}>Konfirmasi Akhir</h3>
            <p style={{color:"#dc2626",fontSize:14,margin:"10px 0 0",fontWeight:700}}>{modeInfo[mode].confirm}</p>
            <p style={{color:"#9ca3af",fontSize:13,margin:"6px 0 0"}}>Ini adalah konfirmasi terakhir sebelum data dihapus.</p>
          </div>
          <div style={{display:"flex",gap:12}}>
            <button onClick={()=>setStep(0)} style={{...btnSec,flex:1}}>Batalkan</button>
            <button onClick={doReset} disabled={loading}
              style={{flex:1,padding:"13px",background:loading?"#9ca3af":"#dc2626",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:loading?"not-allowed":"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
              {loading?"⏳ Menghapus...":"🗑️ HAPUS SEKARANG"}
            </button>
          </div>
        </div>
      )}

      {/* ── SELESAI ── */}
      {unlocked&&step===3&&(
        <div className="pop-in" style={{background:"#fff",borderRadius:18,padding:32,border:"2px solid #dcfce7",textAlign:"center"}}>
          <div style={{fontSize:56,marginBottom:12}}>✅</div>
          <h3 style={{margin:"0 0 8px",fontSize:18,fontWeight:800,color:"#16a34a"}}>Reset Berhasil!</h3>
          <p style={{color:"#6b7280",fontSize:14,margin:"0 0 20px"}}>{doneMsg}</p>
          <button onClick={lockBack}
            style={{width:"100%",padding:"13px",background:"#16a34a",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
            onMouseOver={e=>e.currentTarget.style.background="#15803d"} onMouseOut={e=>e.currentTarget.style.background="#16a34a"}>
            🔒 Kunci Panel
          </button>
        </div>
      )}
    </div>
  );
}

// ─── WA Signature helper ──────────────────────────────────────────────────────
function waSignature(issuedBy){
  return `---------------------------\n📝 Diterbitkan: ${issuedBy||"Sistem"}\n🕐 Waktu: ${new Date().toLocaleString("id-ID")}`;
}

// ─── PO Quota Helpers ─────────────────────────────────────────────────────────
function getPOUsed(menuId, orders){
  return (orders||[]).filter(o=>o.status!=="cancelled")
    .reduce((s,o)=>{const it=o.items.find(i=>i.menuId===menuId);return s+(it?it.qty:0);},0);
}
function getPORemaining(menu, orders){
  if(!menu?.poLimit) return null;
  return Math.max(0, menu.poLimit - getPOUsed(menu.id, orders));
}
function POQuotaBadge({menu, orders, size=12}){
  const remaining=getPORemaining(menu, orders);
  if(remaining===null) return null;
  const pct=menu.poLimit>0?remaining/menu.poLimit:0;
  const color=remaining===0?"#dc2626":pct<=0.2?"#f97316":"#16a34a";
  return(
    <span style={{background:remaining===0?"#fef2f2":pct<=0.2?"#fff7ed":"#f0fdf4",color,border:`1px solid ${remaining===0?"#fca5a5":pct<=0.2?"#fed7aa":"#bbf7d0"}`,borderRadius:20,padding:"1px 7px",fontSize:size,fontWeight:700,display:"inline-block"}}>
      {remaining===0?"❌ Habis":`Sisa: ${remaining}`}
    </span>
  );
}

// ─── WhatsApp Sender via Fonnte ───────────────────────────────────────────────
async function sendWhatsApp({token, phone, message, timeoutMs=8000}){
  if(!token||!phone||!message) return false;
  try{
    // Format nomor: 08xxx → 628xxx, hilangkan karakter non-digit
    let target=phone.replace(/\D/g,"");
    if(target.startsWith("0")) target="62"+target.slice(1);
    if(!target.startsWith("62")) target="62"+target;

    // Fonnte butuh form-data, bukan JSON
    const form=new FormData();
    form.append("target", target);
    form.append("message", message);
    form.append("countryCode", "62");

    // Timeout eksplisit — fetch() browser TIDAK punya batas waktu bawaan, jadi kalau
    // jaringan "kurang baik" (bukan benar-benar mati), request bisa menggantung lama
    // tanpa pernah resolve/reject, membuat proses kirim WA terasa macet.
    const controller=new AbortController();
    const timeoutId=setTimeout(()=>controller.abort(),timeoutMs);
    let res;
    try{
      res=await fetch("https://api.fonnte.com/send",{
        method:"POST",
        headers:{"Authorization":token},
        body:form,
        signal:controller.signal,
      });
    }finally{
      clearTimeout(timeoutId);
    }
    const d=await res.json();
    console.log("Fonnte response:", d);
    return d.status===true||d.status==="true"||d.status==="200"||d.detail?.includes("success")||false;
  }catch(e){
    console.error("WA error:",e);
    return false;
  }
}

// ─── Generate Customer Card (Canvas → JPEG dataURL) ──────────────────────────
function generateCustomerCard({customer, bazaarName}){
  return new Promise((resolve)=>{
    const canvas = document.createElement("canvas");
    canvas.width=800; canvas.height=420;
    const ctx = canvas.getContext("2d");

    // Background gradient
    const grad = ctx.createLinearGradient(0,0,800,420);
    grad.addColorStop(0,"#1c0a00"); grad.addColorStop(1,"#ea580c");
    ctx.fillStyle=grad; ctx.roundRect(0,0,800,420,24); ctx.fill();

    // White card area
    ctx.fillStyle="rgba(255,255,255,0.95)";
    ctx.roundRect(20,20,760,380,18); ctx.fill();

    // Header
    ctx.fillStyle="#ea580c";
    ctx.font="bold 28px Arial"; ctx.textAlign="left";
    ctx.fillText("🏪 "+bazaarName, 36, 65);
    ctx.fillStyle="#6b7280";
    ctx.font="16px Arial";
    ctx.fillText("Kartu Saldo Pelanggan", 36, 90);

    // Divider
    ctx.strokeStyle="#f3f4f6"; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(36,105); ctx.lineTo(764,105); ctx.stroke();

    // Customer info
    ctx.fillStyle="#1c0a00";
    ctx.font="bold 32px Arial"; ctx.textAlign="left";
    ctx.fillText(customer.name, 36, 150);
    ctx.fillStyle="#6b7280";
    ctx.font="20px Arial";
    ctx.fillText("📱 "+customer.phone, 36, 185);

    // Balance box
    ctx.fillStyle="#fff7ed";
    ctx.roundRect(36, 210, 340, 90, 12); ctx.fill();
    ctx.strokeStyle="#fed7aa"; ctx.lineWidth=2;
    ctx.roundRect(36,210,340,90,12); ctx.stroke();
    ctx.fillStyle="#9ca3af"; ctx.font="14px Arial";
    ctx.fillText("Saldo Tersedia", 56, 237);
    ctx.fillStyle="#ea580c"; ctx.font="bold 34px Arial";
    const balStr = new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",minimumFractionDigits:0}).format(customer.balance);
    ctx.fillText(balStr, 56, 280);

    // QR code via qrserver API (load as image)
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(customer.phone)}&bgcolor=ffffff&color=1c0a00`;
    const qrImg = new Image();
    qrImg.crossOrigin="anonymous";
    qrImg.onload=()=>{
      // QR background
      ctx.fillStyle="#f9fafb";
      ctx.roundRect(560,130,200,200,12); ctx.fill();
      ctx.drawImage(qrImg,570,140,180,180);
      ctx.fillStyle="#6b7280"; ctx.font="13px Arial"; ctx.textAlign="center";
      ctx.fillText("Scan untuk transaksi",660,350);

      // Footer
      ctx.fillStyle="#9ca3af"; ctx.font="13px Arial"; ctx.textAlign="left";
      ctx.fillText("ID: "+customer.id.slice(0,8).toUpperCase(), 36, 365);
      ctx.textAlign="right";
      ctx.fillText("Dicetak: "+new Date().toLocaleString("id-ID"), 764, 365);

      resolve(canvas.toDataURL("image/jpeg",0.92));
    };
    qrImg.onerror=()=>{
      // Tanpa QR jika gagal load
      ctx.fillStyle="#9ca3af"; ctx.font="13px Arial"; ctx.textAlign="left";
      ctx.fillText("ID: "+customer.id.slice(0,8).toUpperCase(), 36, 365);
      resolve(canvas.toDataURL("image/jpeg",0.92));
    };
    qrImg.src=qrUrl;
  });
}

// ─── Kasir Top Up ─────────────────────────────────────────────────────────────
function KasirTopUp({customers,walletLogs,settings,admins,adminData,onSaveCustomers,onSaveWalletLogs,onUpdateCustomerBalance,onAddNewCustomer,onCheckConnection,isSuperAdmin}){
  // ─ State ─────────────────────────────────────────────────────────────────────
  const [tab,setTab]=useState("customers");
  const [form,setForm]=useState({phone:"",name:"",amount:""});
  const [payMethod,setPayMethod]=useState("cash"); // "cash" | "transfer"
  const [photoCapture,setPhotoCapture]=useState(null); // base64 gambar bukti transfer (lokal device)
  const photoInputRef=useRef(null);
  const videoCamRef=useRef(null);   // live camera preview
  const streamRef=useRef(null);     // MediaStream reference
  const [showCamera,setShowCamera]=useState(false);
  const [search,setSearch]=useState("");
  const [sending,setSending]=useState(false);
  const submittingRef=useRef(false);
  const [pendingWaResend,setPendingWaResend]=useState(null);
  const [netToast,setNetToast]=useState(""); // pesan jaringan fixed di atas layar
  const [msg,setMsg]=useState("");
  const [filterDate,setFilterDate]=useState(todayStr());
  const [showPinModal,setShowPinModal]=useState(null);
  const [histView,setHistView]=useState("mine"); // "mine" | "global" | "byadmin"
  const [histAdminSel,setHistAdminSel]=useState("");
  const [expandedProof,setExpandedProof]=useState(null); // log.id yang sedang ditampilkan fotonya
  const [showScanSearch,setShowScanSearch]=useState(false);
  const [scanSearchErr,setScanSearchErr]=useState("");
  const videoSRef=useRef(null);
  const scanSRef=useRef(null);

  // ─ Cegah refresh saat proses sedang berjalan ─────────────────────────────────
  useEffect(()=>{
    if(!sending)return;
    const handler=e=>{e.preventDefault();e.returnValue="";return "";};
    window.addEventListener("beforeunload",handler);
    return()=>window.removeEventListener("beforeunload",handler);
  },[sending]);

  const showMsg=(m,dur=4000)=>{setMsg(m);setTimeout(()=>setMsg(""),dur);};

  // ─ Foto bukti transfer — disimpan di localStorage device saja ────────────────
  const capturePhoto=e=>{
    const file=e.target.files?.[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const img=new Image();
      img.onload=()=>{
        const MAX=640; let w=img.width,h=img.height;
        if(w>MAX){h=Math.round(h*MAX/w);w=MAX;}
        else if(h>MAX){w=Math.round(w*MAX/h);h=MAX;}
        const canvas=document.createElement("canvas");
        canvas.width=w;canvas.height=h;
        canvas.getContext("2d").drawImage(img,0,0,w,h);
        setPhotoCapture(canvas.toDataURL("image/jpeg",0.65));
      };
      img.src=ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  const savePhoto=(logId,photo)=>{try{localStorage.setItem(`bzr_photo_${logId}`,photo);}catch(e){console.warn("Gagal simpan foto:",e);}};
  const getPhoto=(logId)=>{try{return localStorage.getItem(`bzr_photo_${logId}`);}catch(e){return null;}};
  const deletePhoto=(logId)=>{try{localStorage.removeItem(`bzr_photo_${logId}`);}catch(e){}};

  // ─ Kamera langsung (getUserMedia) — bekerja di HP DAN laptop/PC berkamera ─────
  const openCamera=async()=>{
    setShowCamera(true);
    try{
      // Coba kamera belakang dulu (HP), otomatis fallback ke webcam (laptop/PC)
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
      streamRef.current=stream;
      if(videoCamRef.current){videoCamRef.current.srcObject=stream;videoCamRef.current.play();}
    }catch(e1){
      try{
        // Fallback: kamera manapun yang tersedia (webcam laptop/PC)
        const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
        streamRef.current=stream;
        if(videoCamRef.current){videoCamRef.current.srcObject=stream;videoCamRef.current.play();}
      }catch(e2){
        setShowCamera(false);
        showMsg("❌ Gagal akses kamera: "+e2.message+". Gunakan tombol 'Pilih File' sebagai alternatif.",6000);
      }
    }
  };
  const closeCamera=()=>{
    if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null;}
    setShowCamera(false);
  };
  const captureFromCamera=()=>{
    const video=videoCamRef.current; if(!video)return;
    // Ambil frame dari video, kompres, simpan ke state
    const raw=document.createElement("canvas");
    raw.width=video.videoWidth; raw.height=video.videoHeight;
    raw.getContext("2d").drawImage(video,0,0);
    const MAX=640; let w=raw.width,h=raw.height;
    if(w>MAX){h=Math.round(h*MAX/w);w=MAX;} else if(h>MAX){w=Math.round(w*MAX/h);h=MAX;}
    const final=document.createElement("canvas"); final.width=w; final.height=h;
    final.getContext("2d").drawImage(raw,0,0,w,h);
    setPhotoCapture(final.toDataURL("image/jpeg",0.65));
    closeCamera();
  };

  // ─ Export Excel riwayat top up + koreksi ────────────────────────────────────
  const exportExcel=(logs,filename)=>{
    const headers=["No","Tipe","Tanggal","Waktu","Nama Pelanggan","No. HP","Nominal (Rp)","Saldo Setelah (Rp)","Admin","Metode Bayar","Keterangan"];
    const esc=s=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const thStyle='style="background:#16a34a;color:#fff;padding:6px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;font-weight:bold;"';
    const tdStyle='style="padding:5px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;"';
    const tdRedStyle='style="padding:5px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;background:#fef2f2;color:#dc2626;"';
    const tdSumStyle='style="padding:6px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;background:#f0fdf4;font-weight:bold;"';

    // Baris data
    const dataRows=logs.map((l,i)=>{
      const isKoreksi=l.type==="adjustment";
      const td=isKoreksi?tdRedStyle:tdStyle;
      const tipe=isKoreksi?"✂️ KOREKSI":"💰 Top Up";
      const metode=isKoreksi?"—":(l.payMethod==="transfer"?"Transfer/QRIS":"Tunai");
      const ket=isKoreksi?(l.note||l.nota||"Koreksi saldo"):"";
      return `<tr>
        <td ${td}>${i+1}</td>
        <td ${td}>${esc(tipe)}</td>
        <td ${td}>${esc(l.date||"")}</td>
        <td ${td}>${esc(l.time||"")}</td>
        <td ${td}>${esc(l.customerName||"")}</td>
        <td ${td}>${esc(l.customerPhone||"")}</td>
        <td ${td}>${isKoreksi?"-":""}${esc(l.amount||0)}</td>
        <td ${td}>${esc(l.balanceAfter||0)}</td>
        <td ${td}>${esc(l.adminName||"")}</td>
        <td ${td}>${esc(metode)}</td>
        <td ${td}>${esc(ket)}</td>
      </tr>`;
    });

    // Baris ringkasan di akhir
    const topUpRows=logs.filter(l=>l.type==="topup");
    const koreksiRows=logs.filter(l=>l.type==="adjustment");
    const sumCash=topUpRows.filter(l=>!l.payMethod||l.payMethod==="cash").reduce((s,l)=>s+l.amount,0);
    const sumTransfer=topUpRows.filter(l=>l.payMethod==="transfer").reduce((s,l)=>s+l.amount,0);
    const sumGross=sumCash+sumTransfer;
    const sumKoreksi=koreksiRows.reduce((s,l)=>s+l.amount,0);
    const sumNet=sumGross-sumKoreksi;

    const summaryRows=`
      <tr><td colspan="11" style="padding:4px;border:none;"></td></tr>
      <tr>
        <td colspan="6" ${tdSumStyle}>💵 Total Tunai</td>
        <td colspan="5" ${tdSumStyle}>${sumCash.toLocaleString("id-ID")}</td>
      </tr>
      <tr>
        <td colspan="6" ${tdSumStyle}>💳 Total Transfer/QRIS</td>
        <td colspan="5" ${tdSumStyle}>${sumTransfer.toLocaleString("id-ID")}</td>
      </tr>
      <tr>
        <td colspan="6" style="padding:6px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;font-weight:bold;background:#fff7ed;">GROSS Total Top Up</td>
        <td colspan="5" style="padding:6px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;font-weight:bold;background:#fff7ed;">${sumGross.toLocaleString("id-ID")}</td>
      </tr>
      ${sumKoreksi>0?`<tr>
        <td colspan="6" style="padding:6px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;font-weight:bold;background:#fef2f2;color:#dc2626;">✂️ Total Koreksi (${koreksiRows.length}x)</td>
        <td colspan="5" style="padding:6px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;font-weight:bold;background:#fef2f2;color:#dc2626;">-${sumKoreksi.toLocaleString("id-ID")}</td>
      </tr>
      <tr>
        <td colspan="6" style="padding:6px 10px;border:2px solid #16a34a;font-family:Arial;font-size:12pt;font-weight:bold;background:#f0fdf4;color:#14532d;">✅ NET BERSIH</td>
        <td colspan="5" style="padding:6px 10px;border:2px solid #16a34a;font-family:Arial;font-size:12pt;font-weight:bold;background:#f0fdf4;color:#14532d;">${sumNet.toLocaleString("id-ID")}</td>
      </tr>`:""}
    `;

    const tbl=`<table>
      <tr>${headers.map(h=>`<th ${thStyle}>${esc(h)}</th>`).join("")}</tr>
      ${dataRows.join("")}
      ${summaryRows}
    </table>`;
    const html=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"/><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Riwayat Top Up</x:Name></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>${tbl}</body></html>`;
    const blob=new Blob(["\uFEFF"+html],{type:"application/vnd.ms-excel;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=filename.replace(/\.csv$/i,".xls");a.click();
    URL.revokeObjectURL(url);
  };

  // ─ Hapus & kosongkan saldo (SuperAdmin only) ─────────────────────────────────
  const deleteCustomer=async(c)=>{
    if(c.balance>0){showMsg(`❌ Saldo ${c.name} masih ${idr(c.balance)}. Kosongkan saldo dulu sebelum hapus.`);return;}
    if(!window.confirm(`Hapus pelanggan "${c.name}" (${c.phone})?\nTindakan ini permanen.`))return;
    const online=await onCheckConnection();
    if(!online){setNetToast("Transaksi Gagal, Jaringan Kurang Baik. Silahkan coba lagi setelah jaringan baik.");return;}
    try{
      await onSaveCustomers(customers.filter(x=>x.id!==c.id));
      showMsg(`✅ Pelanggan ${c.name} berhasil dihapus & TERSIMPAN.`);
    }catch(e){showMsg(`❌ GAGAL MENYIMPAN! Pelanggan TIDAK terhapus. Cek koneksi, lalu coba lagi. (${e.message})`,8000);}
  };

  const kosongkanSaldo=async(c)=>{
    if(c.balance===0){showMsg(`ℹ️ Saldo ${c.name} sudah 0.`);return;}
    if(!window.confirm(`Kosongkan saldo ${c.name}?\nSaldo saat ini ${idr(c.balance)} akan diset ke Rp 0.\nTindakan ini tidak bisa dibatalkan.`))return;
    const online=await onCheckConnection();
    if(!online){setNetToast("Transaksi Gagal, Jaringan Kurang Baik. Silahkan coba lagi setelah jaringan baik.");return;}
    try{
      await onUpdateCustomerBalance(c.id,()=>0,
        (balBefore)=>({id:uid(),customerId:c.id,customerPhone:c.phone,customerName:c.name,
          type:"adjustment",amount:balBefore,balanceBefore:balBefore,balanceAfter:0,
          nota:"ADJUST-"+todayStr(),tenantId:"",tenantName:"",
          adminName:adminData?.name||"Super Admin",
          timestamp:new Date().toISOString(),date:todayStr(),time:timeStr()})
      );
      showMsg(`✅ Saldo ${c.name} berhasil dikosongkan & TERSIMPAN (Rp 0).`);
    }catch(e){showMsg(`❌ GAGAL MENYIMPAN! Saldo TIDAK dikosongkan. Cek koneksi, lalu coba lagi. (${e.message})`,8000);}
  };

  // ── Kurangi Saldo (SuperAdmin only) — untuk koreksi error top up ganda ────────
  const [kurangiModal,setKurangiModal]=useState(null); // customer object yang sedang diproses
  const [kurangiAmount,setKurangiAmount]=useState("");
  const [kurangiAlasan,setKurangiAlasan]=useState("");
  const [kurangiLoading,setKurangiLoading]=useState(false);

  const doKurangiSaldo=async()=>{
    if(!kurangiModal)return;
    const amount=parseInt(kurangiAmount.replace(/\./g,"").replace(/\D/g,""));
    if(isNaN(amount)||amount<=0){showMsg("❌ Nominal pengurangan tidak valid!");return;}
    if(amount>kurangiModal.balance){showMsg(`❌ Tidak bisa kurangi ${idr(amount)} — saldo hanya ${idr(kurangiModal.balance)}.`);return;}
    if(!kurangiAlasan.trim()){showMsg("❌ Alasan pengurangan wajib diisi!");return;}
    const alasan=kurangiAlasan.trim();
    if(!window.confirm(
      `Kurangi saldo ${kurangiModal.name}?\n\n• Dikurangi  : ${idr(amount)}\n• Saldo saat ini : ${idr(kurangiModal.balance)}\n• Saldo setelah  : ${idr(kurangiModal.balance-amount)}\n• Alasan     : ${alasan}\n\nTindakan ini dicatat di riwayat transaksi dan tidak bisa dibatalkan.`
    ))return;
    const online=await onCheckConnection();
    if(!online){setNetToast("Transaksi Gagal, Jaringan Kurang Baik. Silahkan coba lagi setelah jaringan baik.");return;}
    setKurangiLoading(true);
    try{
      await onUpdateCustomerBalance(
        kurangiModal.id,
        -amount,
        (balBefore,balAfter)=>({
          id:uid(),customerId:kurangiModal.id,customerPhone:kurangiModal.phone,customerName:kurangiModal.name,
          type:"adjustment",amount,balanceBefore:balBefore,balanceAfter:balAfter,
          nota:"KOREKSI-"+todayStr(),tenantId:"",tenantName:"",
          adminName:adminData?.name||"Super Admin",
          note:alasan,
          timestamp:new Date().toISOString(),date:todayStr(),time:timeStr(),
        })
      );
      showMsg(`✅ Saldo ${kurangiModal.name} berhasil dikurangi ${idr(amount)} & TERSIMPAN.`);
      setKurangiModal(null);setKurangiAmount("");setKurangiAlasan("");
    }catch(e){
      showMsg(`❌ GAGAL! Saldo TIDAK berubah. Cek koneksi, lalu coba lagi. (${e.message})`,8000);
    }
    setKurangiLoading(false);
  };

  // ─ QR scanner untuk cari pelanggan ───────────────────────────────────────────
  const startScanSearch=async()=>{
    setScanSearchErr("");setShowScanSearch(true);
    if(!window.jsQR){await new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";s.onload=res;s.onerror=rej;document.head.appendChild(s);});}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
      if(videoSRef.current){videoSRef.current.srcObject=stream;videoSRef.current.play();
        scanSRef.current=setInterval(()=>{
          if(!videoSRef.current||!window.jsQR)return;
          const cv=document.createElement("canvas");cv.width=videoSRef.current.videoWidth;cv.height=videoSRef.current.videoHeight;
          const ctx=cv.getContext("2d");ctx.drawImage(videoSRef.current,0,0);
          const code=window.jsQR(ctx.getImageData(0,0,cv.width,cv.height).data,cv.width,cv.height);
          if(code&&code.data){
            const sc=code.data.trim();
            const found=customers.find(c=>c.id===sc)||customers.find(c=>c.phone===sc.replace(/\D/g,""));
            if(found){setSearch(found.name);closeScanSearch();}
            else{setScanSearchErr("QR tidak dikenali");closeScanSearch();}
          }
        },500);
      }
    }catch(e){setScanSearchErr("Gagal akses kamera: "+e.message);}
  };
  const closeScanSearch=()=>{
    clearInterval(scanSRef.current);
    if(videoSRef.current?.srcObject){videoSRef.current.srcObject.getTracks().forEach(t=>t.stop());videoSRef.current.srcObject=null;}
    setShowScanSearch(false);
  };

  // ─ Proses Top Up ─────────────────────────────────────────────────────────────
  const handleTopUp=async()=>{
    if(submittingRef.current)return;
    if(!form.phone.trim()||!form.name.trim()){showMsg("❌ Nomor WA dan nama harus diisi!");return;}
    const amount=parseInt(form.amount);
    if(isNaN(amount)||amount<=0){showMsg("❌ Nominal top up tidak valid!");return;}
    const phone=form.phone.trim().replace(/\D/g,"");

    // Deteksi duplikat "lunak" dalam 90 detik terakhir
    const recentDup=(walletLogs||[]).find(l=>{
      if(l.type!=="topup"||l.customerPhone!==phone||l.amount!==amount)return false;
      const ageMs=Date.now()-new Date(l.timestamp).getTime();
      return ageMs>=0&&ageMs<90000;
    });
    if(recentDup){
      const ageSec=Math.round((Date.now()-new Date(recentDup.timestamp).getTime())/1000);
      const proceed=window.confirm(
        `⚠️ PERINGATAN DUPLIKAT!\n\nTop up ${idr(amount)} untuk nomor ${phone} BARU SAJA tercatat ${ageSec} detik lalu (oleh ${recentDup.adminName||"admin"}).\n\nSaldo BISA SUDAH masuk. Cek dulu saldo pelanggan sebelum lanjut!\n\nTekan OK HANYA JIKA ini top up BARU yang berbeda.`
      );
      if(!proceed){showMsg("⛔ Top up dibatalkan — terdeteksi kemungkinan duplikat.",8000);return;}
    }

    submittingRef.current=true; setSending(true); setPendingWaResend(null);

    // ── UI timeout: kalau transaksi tidak selesai dalam 12 detik, unlock UI ──────
    // Transaksi di Firestore mungkin masih jalan di background — kasir diarahkan
    // cek riwayat dulu sebelum mencoba ulang supaya tidak double top up.
    const uiTimeoutId=setTimeout(()=>{
      if(submittingRef.current){
        setSending(false); submittingRef.current=false;
        setForm({phone:"",name:"",amount:""}); setPayMethod("cash"); setPhotoCapture(null);
        setNetToast("Transaksi Gagal, Silahkan cek riwayat transaksi dan refresh saldo di link pelanggan");
      }
    },12000);

    const online=await onCheckConnection();
    if(!online){
      setSending(false);submittingRef.current=false;
      setNetToast("Top Up Gagal, Jaringan Kurang Baik. Silahkan coba lagi setelah jaringan baik.");
      return;
    }

    const existingCust=customers.find(c=>c.phone===phone);
    const adminName=adminData?.name||adminData?.username||"Super Admin";
    let updCust, balBefore, balAfter, isNew;
    const logId=uid(); // pre-generate untuk foto

    try{
      if(existingCust){
        isNew=false;
        const result=await onUpdateCustomerBalance(
          existingCust.id, amount,
          (bBefore,bAfter)=>({
            id:logId,customerId:existingCust.id,customerPhone:existingCust.phone,customerName:form.name.trim(),
            type:"topup",amount,balanceBefore:bBefore,balanceAfter:bAfter,
            adminName,payMethod, // ← metode bayar
            timestamp:new Date().toISOString(),date:todayStr(),time:timeStr(),
          }),
          {name:form.name.trim()}
        );
        updCust=result; balBefore=result.balance-amount; balAfter=result.balance;
      } else {
        isNew=true;
        const pin=String(Math.floor(1000+Math.random()*9000));
        updCust={id:uid(),phone,name:form.name.trim(),balance:amount,pin,createdAt:new Date().toISOString()};
        balBefore=0; balAfter=amount;
        await onAddNewCustomer(updCust,()=>({
          id:logId,customerId:updCust.id,customerPhone:phone,customerName:updCust.name,
          type:"topup",amount,balanceBefore:0,balanceAfter:amount,
          adminName,payMethod, // ← metode bayar
          timestamp:new Date().toISOString(),date:todayStr(),time:timeStr(),
        }));
      }
    }catch(e){
      clearTimeout(uiTimeoutId);
      console.error("Top up gagal simpan:",e);
      setNetToast("Transaksi Gagal, Silahkan cek riwayat transaksi dan refresh saldo di link pelanggan");
      setSending(false);submittingRef.current=false;
      return;
    }

    // ── Saldo TERSIMPAN — lepas kunci, reset form, simpan foto bukti ────────────
    clearTimeout(uiTimeoutId);
    if(payMethod==="transfer"&&photoCapture) savePhoto(logId,photoCapture);
    setSending(false); submittingRef.current=false;
    setForm({phone:"",name:"",amount:""}); setPayMethod("cash"); setPhotoCapture(null);
    showMsg(`✅ Top up berhasil & TERSIMPAN!${isNew?` PIN: ${updCust.pin} (sampaikan ke pelanggan)`:""}${payMethod==="transfer"?" • Transfer/QRIS":""}. Mengirim WA...`,4000);

    const cardLink=`${window.location.origin}${window.location.pathname}?card=${updCust.id}`;
    const waMsg=`🏪 *${settings.bazaarName||"BazaarPOS"}*\n\nHalo *${updCust.name}*! 👋\n\n✅ *Top Up Berhasil*\n💰 Nominal   : ${idr(amount)}\n📊 Saldo Lama: ${idr(balBefore)}\n🪙 Saldo Baru: ${idr(balAfter)}\n💳 Metode    : ${payMethod==="transfer"?"Transfer/QRIS":"Tunai"}\n\n🔗 *Kartu Saldo Kamu:*\n${cardLink}\n\n_(Simpan link ini untuk cek saldo & QR Code)_\n\nTerima kasih! 🙏\n${waSignature(adminName)}`;

    let waSent=false;
    if(settings.fonnteToken){
      waSent=await sendWhatsApp({token:settings.fonnteToken,phone:updCust.phone,message:waMsg});
      if(!waSent){await new Promise(r=>setTimeout(r,1000));waSent=await sendWhatsApp({token:settings.fonnteToken,phone:updCust.phone,message:waMsg});}
    }
    if(!waSent) setPendingWaResend({phone:updCust.phone,message:waMsg,name:updCust.name});
    showMsg(`✅ Top up berhasil & TERSIMPAN!${isNew?` PIN: ${updCust.pin}`:""} ${waSent?"WA terkirim!":"⚠️ WA GAGAL — tekan kirim manual di bawah."}`,waSent?5000:10000);
  };

  const handleDownloadCard=async(cust)=>{
    const dataUrl=await generateCustomerCard({customer:cust,bazaarName:settings.bazaarName||"BazaarPOS"});
    const link=document.createElement("a"); link.href=dataUrl; link.download=`Kartu_${cust.name.replace(/\s+/g,"_")}.jpg`; link.click();
  };

  // ─ Computed values ────────────────────────────────────────────────────────────
  const adminName=adminData?.name||adminData?.username||"Super Admin";

  // Header stats
  const myLogsToday=(walletLogs||[]).filter(l=>l.type==="topup"&&l.date===todayStr()&&l.adminName===adminName);
  const myTopUpToday=myLogsToday.reduce((s,l)=>s+l.amount,0);
  const myCashToday=myLogsToday.filter(l=>!l.payMethod||l.payMethod==="cash").reduce((s,l)=>s+l.amount,0);
  const myTransferToday=myLogsToday.filter(l=>l.payMethod==="transfer").reduce((s,l)=>s+l.amount,0);
  const myCashCount=myLogsToday.filter(l=>!l.payMethod||l.payMethod==="cash").length;
  const myTransferCount=myLogsToday.filter(l=>l.payMethod==="transfer").length;
  // Koreksi (adjustment) hari ini — dicatat terpisah, bukan dikurangi dari gross top up
  const myKoreksiToday=(walletLogs||[]).filter(l=>l.type==="adjustment"&&l.date===todayStr()&&l.adminName===adminName&&(l.nota||"").startsWith("KOREKSI"));
  const myKoreksiTotal=myKoreksiToday.reduce((s,l)=>s+l.amount,0);

  const globalLogsToday=(walletLogs||[]).filter(l=>l.type==="topup"&&l.date===todayStr());
  const globalTopUpToday=globalLogsToday.reduce((s,l)=>s+l.amount,0);
  const globalCashToday=globalLogsToday.filter(l=>!l.payMethod||l.payMethod==="cash").reduce((s,l)=>s+l.amount,0);
  const globalTransferToday=globalLogsToday.filter(l=>l.payMethod==="transfer").reduce((s,l)=>s+l.amount,0);
  // Koreksi global hari ini
  const globalKoreksiToday=(walletLogs||[]).filter(l=>l.type==="adjustment"&&l.date===todayStr()&&(l.nota||"").startsWith("KOREKSI"));
  const globalKoreksiTotal=globalKoreksiToday.reduce((s,l)=>s+l.amount,0);

  // History filter — top up + koreksi (adjustment KOREKSI-*) digabung
  const allTopUpLogs=(walletLogs||[]).filter(l=>
    l.type==="topup" ||
    (l.type==="adjustment"&&(l.nota||"").startsWith("KOREKSI"))
  );
  const baseHistLogs=isSuperAdmin
    ?(histView==="mine"?allTopUpLogs.filter(l=>l.adminName===adminName)
      :histView==="global"?allTopUpLogs
      :allTopUpLogs.filter(l=>l.adminName===histAdminSel))
    :allTopUpLogs.filter(l=>l.adminName===adminName);
  const filteredHistLogs=baseHistLogs.filter(l=>l.date===filterDate).sort((a,b)=>(b.time||"").localeCompare(a.time||""));

  const cashTotal=filteredHistLogs.filter(l=>l.type==="topup"&&(!l.payMethod||l.payMethod==="cash")).reduce((s,l)=>s+l.amount,0);
  const transferTotal=filteredHistLogs.filter(l=>l.type==="topup"&&l.payMethod==="transfer").reduce((s,l)=>s+l.amount,0);
  const koreksiTotal=filteredHistLogs.filter(l=>l.type==="adjustment").reduce((s,l)=>s+l.amount,0);
  const grossTotal=cashTotal+transferTotal;
  const netTotal=grossTotal-koreksiTotal;

  const filteredSearch=customers.filter(c=>
    c.name.toLowerCase().includes(search.toLowerCase())||c.phone.includes(search)
  );

  // Nama admin unik dari semua log top up (untuk dropdown SuperAdmin)
  const adminNamesInLogs=[...new Set(allTopUpLogs.filter(l=>l.adminName).map(l=>l.adminName))].sort();

  // ─ Render ─────────────────────────────────────────────────────────────────────
  return(
    <div>
      {/* ── Modal PIN ── */}
      {showPinModal&&(
        <Modal title="🔐 PIN Pelanggan" onClose={()=>setShowPinModal(null)} accent="#7c3aed">
          <div style={{background:"#f5f0ff",borderRadius:14,padding:"20px",textAlign:"center",marginBottom:14}}>
            <p style={{margin:"0 0 4px",color:"#7c3aed",fontSize:14,fontWeight:700}}>👤 {showPinModal.name}</p>
            <p style={{margin:"0 0 14px",color:"#6b7280",fontSize:13}}>📱 {showPinModal.phone}</p>
            <p style={{margin:"0 0 10px",color:"#374151",fontSize:13,fontWeight:600}}>PIN Transaksi</p>
            <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:6}}>
              {(showPinModal.pin||"----").split("").map((d,i)=>(
                <div key={i} style={{width:52,height:64,background:"#fff",border:"2px solid #7c3aed",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:900,color:"#4c1d95",boxShadow:"0 2px 8px rgba(124,58,237,.2)"}}>
                  {d}
                </div>
              ))}
            </div>
            {!showPinModal.pin&&<p style={{color:"#dc2626",fontSize:12,margin:"8px 0 0"}}>PIN belum ada. Lakukan top up untuk generate PIN.</p>}
          </div>
          <div style={{background:"#fef3c7",border:"1px solid #fbbf24",borderRadius:10,padding:"10px 14px",marginBottom:14}}>
            <p style={{margin:0,fontSize:13,color:"#92400e",fontWeight:600}}>⚠️ Sampaikan PIN langsung ke pelanggan, jangan kirim via chat publik.</p>
          </div>
          <p style={{color:"#6b7280",fontSize:13,margin:"0 0 14px",textAlign:"center"}}>Saldo: <strong style={{color:"#16a34a"}}>{idr(showPinModal.balance)}</strong></p>
          <button onClick={()=>setShowPinModal(null)} style={{width:"100%",padding:"12px",background:"#7c3aed",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>Tutup</button>
        </Modal>
      )}

      <NetToast msg={netToast} onClose={()=>setNetToast("")}/>

      {/* ── Modal Kurangi Saldo (SuperAdmin only) ── */}
      {kurangiModal&&(
        <Modal title="✂️ Kurangi Saldo" onClose={()=>{if(!kurangiLoading){setKurangiModal(null);setKurangiAmount("");setKurangiAlasan("");}}} accent="#dc2626">
          {/* Info pelanggan */}
          <div style={{background:"#f9fafb",borderRadius:12,padding:"12px 16px",marginBottom:16}}>
            <p style={{margin:0,fontWeight:800,fontSize:15,color:"#1c0a00"}}>{kurangiModal.name}</p>
            <p style={{margin:"2px 0 0",color:"#6b7280",fontSize:13}}>📱 {kurangiModal.phone}</p>
            <p style={{margin:"6px 0 0",color:"#374151",fontSize:13,fontWeight:600}}>
              Saldo saat ini: <strong style={{color:"#16a34a",fontSize:15}}>{idr(kurangiModal.balance)}</strong>
            </p>
          </div>

          {/* Peringatan konteks */}
          <div style={{background:"#fef3c7",border:"1px solid #fbbf24",borderRadius:10,padding:"10px 14px",marginBottom:16}}>
            <p style={{margin:0,fontSize:12,color:"#92400e",fontWeight:700}}>⚠️ Gunakan untuk koreksi saldo akibat error transaksi (misal: top up masuk 2× karena jaringan tidak stabil). Perubahan tercatat di riwayat sebagai "KOREKSI" dan tidak bisa diurungkan.</p>
          </div>

          {/* Input nominal */}
          <div style={{marginBottom:14}}>
            <label style={{display:"block",fontWeight:700,color:"#374151",fontSize:13,marginBottom:6}}>Nominal yang Dikurangi (Rp)</label>
            <div style={{position:"relative"}}>
              <input
                inputMode="numeric" autoComplete="off"
                placeholder="50.000"
                value={(()=>{const d=kurangiAmount.replace(/\D/g,"");return d?d.replace(/\B(?=(\d{3})+(?!\d))/g,"."):""})()}
                onChange={e=>setKurangiAmount(e.target.value.replace(/\./g,"").replace(/\D/g,""))}
                style={{width:"100%",border:"2px solid #fca5a5",borderRadius:11,padding:"11px 46px 11px 14px",fontSize:14,outline:"none",fontFamily:"'Plus Jakarta Sans',sans-serif",color:"#111",boxSizing:"border-box"}}
                onFocus={e=>e.target.style.borderColor="#dc2626"} onBlur={e=>e.target.style.borderColor="#fca5a5"}
                disabled={kurangiLoading}
              />
              <span style={{position:"absolute",right:13,top:"50%",transform:"translateY(-50%)",fontSize:12,fontWeight:700,color:"#9ca3af",pointerEvents:"none"}}>Rp</span>
            </div>
            {/* Preview saldo setelah dikurangi */}
            {kurangiAmount&&!isNaN(parseInt(kurangiAmount))&&(()=>{
              const amt=parseInt(kurangiAmount);
              const after=kurangiModal.balance-amt;
              return(
                <div style={{marginTop:8,background:after<0?"#fef2f2":"#f0fdf4",borderRadius:10,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:13,color:"#6b7280",fontWeight:600}}>Saldo setelah dikurangi</span>
                  <span style={{fontSize:14,fontWeight:900,color:after<0?"#dc2626":"#14532d"}}>{after<0?"❌ Melebihi saldo!":idr(after)}</span>
                </div>
              );
            })()}
          </div>

          {/* Alasan (wajib) */}
          <div style={{marginBottom:18}}>
            <label style={{display:"block",fontWeight:700,color:"#374151",fontSize:13,marginBottom:6}}>Alasan Pengurangan <span style={{color:"#dc2626"}}>*</span></label>
            <textarea
              placeholder="Contoh: Koreksi top up 2× akibat jaringan error tanggal 22/6 pukul 23:05"
              value={kurangiAlasan} onChange={e=>setKurangiAlasan(e.target.value)}
              rows={3} disabled={kurangiLoading}
              style={{width:"100%",border:"2px solid #e5e7eb",borderRadius:11,padding:"11px 14px",fontSize:13,outline:"none",fontFamily:"'Plus Jakarta Sans',sans-serif",color:"#111",boxSizing:"border-box",resize:"vertical"}}
              onFocus={e=>e.target.style.borderColor="#dc2626"} onBlur={e=>e.target.style.borderColor="#e5e7eb"}
            />
          </div>

          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{if(!kurangiLoading){setKurangiModal(null);setKurangiAmount("");setKurangiAlasan("");}}}
              style={{flex:1,padding:"12px",background:"#f3f4f6",color:"#374151",border:"1px solid #e5e7eb",borderRadius:12,fontWeight:700,cursor:kurangiLoading?"not-allowed":"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
              disabled={kurangiLoading}>
              Batal
            </button>
            <button onClick={doKurangiSaldo} disabled={kurangiLoading||!kurangiAmount||!kurangiAlasan.trim()||parseInt(kurangiAmount)>kurangiModal.balance}
              style={{flex:2,padding:"12px",background:kurangiLoading||!kurangiAmount||!kurangiAlasan.trim()||parseInt(kurangiAmount)>kurangiModal.balance?"#9ca3af":"#dc2626",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:kurangiLoading||!kurangiAmount||!kurangiAlasan.trim()||parseInt(kurangiAmount)>kurangiModal.balance?"not-allowed":"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              {kurangiLoading?(<><span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⏳</span> Memproses...</>):"✂️ Kurangi Saldo"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Modal Kamera Langsung (HP & Laptop/PC berkamera) ── */}
      {showCamera&&(
        <Modal title="📷 Foto Bukti Transfer/QRIS" onClose={closeCamera} accent="#0284c7">
          <p style={{color:"#6b7280",fontSize:13,margin:"0 0 10px"}}>Arahkan kamera ke bukti transfer/QRIS, lalu tekan ambil foto.</p>
          <div style={{position:"relative",borderRadius:14,overflow:"hidden",background:"#000",marginBottom:12,aspectRatio:"3/4",maxHeight:"65vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <video ref={videoCamRef} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} playsInline muted/>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={captureFromCamera}
              style={{flex:2,padding:"13px",background:"#0284c7",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
              onMouseOver={e=>e.currentTarget.style.background="#0369a1"} onMouseOut={e=>e.currentTarget.style.background="#0284c7"}>
              📸 Ambil Foto
            </button>
            <button onClick={closeCamera}
              style={{flex:1,padding:"13px",background:"#f3f4f6",color:"#374151",border:"1px solid #e5e7eb",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
              Batal
            </button>
          </div>
        </Modal>
      )}

      {/* ── Header dengan stats ── */}
      <div style={{marginBottom:16}}>
        <div style={{marginBottom:10}}>
          <h2 style={{margin:0,fontSize:20,fontWeight:800,color:"#1c0a00"}}>💰 Kasir Top Up</h2>
          <p style={{color:"#9ca3af",margin:"4px 0 0",fontSize:13}}>{customers.length} pelanggan terdaftar</p>
        </div>
        {/* Kartu stats — penuh lebar layar, SuperAdmin tampil 2 kartu berderet */}
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {/* Top Up admin ini hari ini */}
          <div style={{flex:"1 1 calc(50% - 5px)",minWidth:0,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:14,padding:"10px 14px",boxSizing:"border-box"}}>
            <p style={{margin:"0 0 3px",color:"#16a34a",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px"}}>Top Up Saya Hari Ini</p>
            <p style={{margin:"0 0 8px",color:"#14532d",fontSize:16,fontWeight:900,lineHeight:1,wordBreak:"break-all"}}>{idr(myTopUpToday)}</p>
            <div style={{display:"flex",gap:6}}>
              <div style={{flex:1,minWidth:0,background:"#fff",borderRadius:8,padding:"5px 6px",border:"1px solid #dcfce7"}}>
                <p style={{margin:0,color:"#6b7280",fontSize:10,fontWeight:600,whiteSpace:"nowrap"}}>💵 Tunai ({myCashCount}x)</p>
                <p style={{margin:"2px 0 0",color:"#16a34a",fontSize:11,fontWeight:800,wordBreak:"break-all"}}>{idr(myCashToday)}</p>
              </div>
              <div style={{flex:1,minWidth:0,background:"#fff",borderRadius:8,padding:"5px 6px",border:"1px solid #dcfce7"}}>
                <p style={{margin:0,color:"#6b7280",fontSize:10,fontWeight:600,whiteSpace:"nowrap"}}>💳 Transfer ({myTransferCount}x)</p>
                <p style={{margin:"2px 0 0",color:"#0284c7",fontSize:11,fontWeight:800,wordBreak:"break-all"}}>{idr(myTransferToday)}</p>
              </div>
            </div>
          </div>
          {/* Total global — hanya SuperAdmin */}
          {isSuperAdmin&&(
            <div style={{flex:"1 1 calc(50% - 5px)",minWidth:0,background:"#eff6ff",border:"1px solid #bae6fd",borderRadius:14,padding:"10px 14px",boxSizing:"border-box"}}>
              <p style={{margin:"0 0 3px",color:"#0284c7",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px"}}>Total Global Hari Ini</p>
              <p style={{margin:"0 0 8px",color:"#0c4a6e",fontSize:16,fontWeight:900,lineHeight:1,wordBreak:"break-all"}}>{idr(globalTopUpToday)}</p>
              <div style={{display:"flex",gap:6,marginBottom:globalKoreksiToday.length>0?8:0}}>
                <div style={{flex:1,minWidth:0,background:"#fff",borderRadius:8,padding:"5px 6px",border:"1px solid #dbeafe"}}>
                  <p style={{margin:0,color:"#6b7280",fontSize:10,fontWeight:600}}>💵 Tunai</p>
                  <p style={{margin:"2px 0 0",color:"#16a34a",fontSize:11,fontWeight:800,wordBreak:"break-all"}}>{idr(globalCashToday)}</p>
                </div>
                <div style={{flex:1,minWidth:0,background:"#fff",borderRadius:8,padding:"5px 6px",border:"1px solid #dbeafe"}}>
                  <p style={{margin:0,color:"#6b7280",fontSize:10,fontWeight:600}}>💳 Transfer</p>
                  <p style={{margin:"2px 0 0",color:"#0284c7",fontSize:11,fontWeight:800,wordBreak:"break-all"}}>{idr(globalTransferToday)}</p>
                </div>
              </div>
              {/* Koreksi global — hanya tampil kalau ada */}
              {globalKoreksiToday.length>0&&(
                <div style={{borderTop:"1px dashed #bae6fd",paddingTop:6}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{fontSize:10,color:"#dc2626",fontWeight:700}}>✂️ Koreksi ({globalKoreksiToday.length}x)</span>
                    <span style={{fontSize:11,fontWeight:800,color:"#dc2626",wordBreak:"break-all"}}>-{idr(globalKoreksiTotal)}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",borderRadius:8,padding:"5px 8px",border:"1px solid #dbeafe"}}>
                    <span style={{fontSize:10,color:"#374151",fontWeight:700}}>✅ Net Bersih</span>
                    <span style={{fontSize:12,fontWeight:900,color:"#0c4a6e",wordBreak:"break-all"}}>{idr(globalTopUpToday-globalKoreksiTotal)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {msg&&<div className="pop-in" style={{background:msg.startsWith("✅")?"#f0fdf4":msg.startsWith("⛔")||msg.startsWith("❌")?"#fef2f2":"#fef3c7",border:`1px solid ${msg.startsWith("✅")?"#bbf7d0":msg.startsWith("⛔")||msg.startsWith("❌")?"#fca5a5":"#fbbf24"}`,borderRadius:12,padding:"10px 16px",marginBottom:16,fontWeight:600,fontSize:13,color:msg.startsWith("✅")?"#16a34a":msg.startsWith("⛔")||msg.startsWith("❌")?"#dc2626":"#92400e"}}>{msg}</div>}

      {/* ── Tabs (tanpa PIN — PIN bisa dilihat di tab Pelanggan) ── */}
      <div style={{display:"flex",gap:4,marginBottom:20,background:"#f9fafb",borderRadius:14,padding:4}}>
        {[{k:"customers",i:"👥",l:"Pelanggan"},{k:"topup",i:"💳",l:"Top Up"},{k:"history",i:"📋",l:"Riwayat"}].map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k)}
            style={{flex:1,padding:"10px 6px",background:tab===t.k?"#fff":"transparent",border:"none",borderRadius:10,fontWeight:tab===t.k?700:500,color:tab===t.k?"#ea580c":"#6b7280",cursor:"pointer",fontSize:12,boxShadow:tab===t.k?"0 2px 8px rgba(0,0,0,.08)":"none",transition:"all .2s"}}>
            {t.i} {t.l}
          </button>
        ))}
      </div>

      {/* ── Tab Pelanggan ── */}
      {tab==="customers"&&(
        <div>
          {showScanSearch&&(
            <Modal title="📷 Scan QR Cari Pelanggan" onClose={closeScanSearch}>
              <p style={{color:"#6b7280",fontSize:13,margin:"0 0 10px"}}>Scan QR Code kartu pelanggan untuk mencarinya.</p>
              <div style={{position:"relative",borderRadius:14,overflow:"hidden",background:"#000",marginBottom:12,height:220}}>
                <video ref={videoSRef} style={{width:"100%",height:"100%",objectFit:"cover"}} playsInline muted/>
                <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
                  <div style={{width:160,height:160,border:"3px solid #ea580c",borderRadius:12,boxShadow:"0 0 0 2000px rgba(0,0,0,.4)"}}/>
                </div>
              </div>
              {scanSearchErr&&<p style={{color:"#dc2626",fontWeight:600,fontSize:13,textAlign:"center"}}>{scanSearchErr}</p>}
              <button onClick={closeScanSearch} style={{...btnSec,width:"100%"}}>Tutup</button>
            </Modal>
          )}

          <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
            <div style={{flex:1,position:"relative"}}>
              <input placeholder="🔍 Cari nama atau nomor WA..." value={search} onChange={e=>setSearch(e.target.value)}
                style={{width:"100%",border:"2px solid #e5e7eb",borderRadius:12,padding:"11px 14px",fontSize:14,outline:"none",color:"#111",boxSizing:"border-box",fontFamily:"'Plus Jakarta Sans',sans-serif"}}
                onFocus={e=>e.target.style.borderColor="#ea580c"} onBlur={e=>e.target.style.borderColor="#e5e7eb"}/>
              {search&&<button onClick={()=>setSearch("")} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:18}}>✕</button>}
            </div>
            <button onClick={startScanSearch} title="Scan QR pelanggan"
              style={{padding:"11px 14px",background:"#fff7ed",color:"#ea580c",border:"2px solid #fed7aa",borderRadius:12,cursor:"pointer",fontWeight:700,fontSize:16,flexShrink:0}}
              onMouseOver={e=>e.currentTarget.style.background="#fef3c7"} onMouseOut={e=>e.currentTarget.style.background="#fff7ed"}>
              📷
            </button>
          </div>

          {filteredSearch.length===0?<EmptyState icon="👥" text="Belum ada pelanggan terdaftar."/>:
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {filteredSearch.map(c=>(
                <div key={c.id} className="card-hover" style={{background:"#fff",border:"1px solid #f3f4f6",borderRadius:16,padding:"14px 18px",boxShadow:"0 2px 8px rgba(0,0,0,.05)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
                    <div>
                      <p style={{fontWeight:800,fontSize:16,color:"#1c0a00",margin:"0 0 4px"}}>{c.name}</p>
                      <p style={{color:"#6b7280",fontSize:13,margin:"0 0 6px"}}>📱 {c.phone}</p>
                      <span style={{background:c.balance>0?"#f0fdf4":"#fef2f2",color:c.balance>0?"#16a34a":"#dc2626",fontSize:13,fontWeight:800,padding:"4px 12px",borderRadius:20,border:`1px solid ${c.balance>0?"#bbf7d0":"#fca5a5"}`}}>
                        🪙 Saldo: {idr(c.balance)}
                      </span>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <button onClick={()=>{setForm({phone:c.phone,name:c.name,amount:""});setTab("topup");}}
                        style={{padding:"8px 14px",background:"#fff7ed",color:"#ea580c",border:"1px solid #fed7aa",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                        💰 Top Up
                      </button>
                      <button onClick={()=>setShowPinModal(c)}
                        style={{padding:"8px 14px",background:"#f5f0ff",color:"#7c3aed",border:"1px solid #c4b5fd",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
                        onMouseOver={e=>e.currentTarget.style.background="#ede9fe"} onMouseOut={e=>e.currentTarget.style.background="#f5f0ff"}>
                        🔐 PIN
                      </button>
                      <button onClick={()=>{
                        const link=`${window.location.origin}${window.location.pathname}?card=${c.id}`;
                        const wa=`Halo ${c.name}! Cek saldo & QR Code kamu di:\n${link}`;
                        const waPhone=c.phone.replace(/\D/g,"");
                        const target=waPhone.startsWith("0")?"62"+waPhone.slice(1):waPhone;
                        window.open(`https://wa.me/${target}?text=${encodeURIComponent(wa)}`,"_blank");
                      }}
                        style={{padding:"8px 14px",background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                        💬 Share Kartu
                      </button>
                      <button onClick={()=>printQRCard({customer:c,bazaarName:settings?.bazaarName||"BazaarPOS",walletLogs})}
                        style={{padding:"8px 14px",background:"#fff7ed",color:"#ea580c",border:"1px solid #fed7aa",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
                        onMouseOver={e=>e.currentTarget.style.background="#fef3c7"} onMouseOut={e=>e.currentTarget.style.background="#fff7ed"}>
                        🖨️ Cetak Kartu QR
                      </button>
                      <button onClick={()=>{const link=`${window.location.origin}${window.location.pathname}?card=${c.id}`;window.open(link,"_blank");}}
                        style={{padding:"8px 14px",background:"#f0f9ff",color:"#0284c7",border:"1px solid #bae6fd",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                        🪪 Lihat
                      </button>
                      {isSuperAdmin&&(
                        <>
                          <button onClick={()=>kosongkanSaldo(c)} disabled={c.balance===0}
                            style={{padding:"8px 14px",background:c.balance>0?"#fef3c7":"#f9fafb",color:c.balance>0?"#92400e":"#9ca3af",border:`1px solid ${c.balance>0?"#fbbf24":"#e5e7eb"}`,borderRadius:10,cursor:c.balance>0?"pointer":"not-allowed",fontWeight:700,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
                            onMouseOver={e=>{if(c.balance>0)e.currentTarget.style.background="#fde68a";}} onMouseOut={e=>{if(c.balance>0)e.currentTarget.style.background="#fef3c7";}}>
                            🪣 Kosongkan Saldo
                          </button>
                          <button onClick={()=>{setKurangiModal(c);setKurangiAmount("");setKurangiAlasan("");}} disabled={c.balance===0}
                            style={{padding:"8px 14px",background:c.balance>0?"#fef2f2":"#f9fafb",color:c.balance>0?"#dc2626":"#9ca3af",border:`1px solid ${c.balance>0?"#fca5a5":"#e5e7eb"}`,borderRadius:10,cursor:c.balance>0?"pointer":"not-allowed",fontWeight:700,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
                            title="Kurangi sebagian saldo untuk koreksi error transaksi"
                            onMouseOver={e=>{if(c.balance>0)e.currentTarget.style.background="#fee2e2";}} onMouseOut={e=>{if(c.balance>0)e.currentTarget.style.background="#fef2f2";}}>
                            ✂️ Kurangi Saldo
                          </button>
                          <button onClick={()=>deleteCustomer(c)}
                            style={{padding:"8px 14px",background:c.balance>0?"#f9fafb":"#fef2f2",color:c.balance>0?"#9ca3af":"#dc2626",border:`1px solid ${c.balance>0?"#e5e7eb":"#fca5a5"}`,borderRadius:10,cursor:c.balance>0?"not-allowed":"pointer",fontWeight:700,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                            🗑️ Hapus
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>}
        </div>
      )}

      {/* ── Tab Top Up ── */}
      {tab==="topup"&&(
        <div style={{maxWidth:500}}>
          <div style={{background:"#fff",borderRadius:18,padding:24,boxShadow:"0 2px 12px rgba(0,0,0,.06)",marginBottom:16}}>
            <p style={{fontWeight:700,color:"#ea580c",fontSize:14,margin:"0 0 16px",borderLeft:"4px solid #ea580c",paddingLeft:10}}>🪙 Form Top Up Saldo</p>
            <FI label="Nomor WhatsApp Pelanggan" placeholder="08123456789" value={form.phone} onChange={v=>{
              setForm({...form,phone:v});
              const found=customers.find(c=>c.phone===v.replace(/\D/g,""));
              if(found) setForm(f=>({...f,name:found.name}));
            }}/>
            <FI label="Nama Pelanggan" placeholder="Nama lengkap" value={form.name} onChange={v=>setForm({...form,name:v})}/>
            <FI label="Nominal Top Up (Rp)" placeholder="50000" value={form.amount} onChange={v=>setForm({...form,amount:v})} money/>

            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
              {[10000,20000,50000,100000].map(n=>(
                <button key={n} onClick={()=>setForm(f=>({...f,amount:String(n)}))}
                  style={{padding:"6px 14px",background:form.amount===String(n)?"#fff7ed":"#f9fafb",color:form.amount===String(n)?"#ea580c":"#6b7280",border:`1px solid ${form.amount===String(n)?"#fed7aa":"#e5e7eb"}`,borderRadius:20,cursor:"pointer",fontWeight:600,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                  {idr(n)}
                </button>
              ))}
            </div>

            {/* ── Pilihan Metode Bayar ── */}
            <p style={{fontSize:13,fontWeight:700,color:"#374151",margin:"0 0 8px"}}>Metode Pembayaran</p>
            <div style={{display:"flex",gap:10,marginBottom:16}}>
              {[{k:"cash",l:"💵 Tunai"},{k:"transfer",l:"💳 Transfer / QRIS"}].map(m=>(
                <button key={m.k} onClick={()=>{setPayMethod(m.k);if(m.k==="cash")setPhotoCapture(null);}}
                  style={{flex:1,padding:"11px",background:payMethod===m.k?"#ea580c":"#f9fafb",color:payMethod===m.k?"#fff":"#6b7280",border:`2px solid ${payMethod===m.k?"#ea580c":"#e5e7eb"}`,borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif",transition:"all .15s"}}
                  onMouseOver={e=>{if(payMethod!==m.k)e.currentTarget.style.background="#fff7ed";}} onMouseOut={e=>{if(payMethod!==m.k)e.currentTarget.style.background="#f9fafb";}}>
                  {m.l}
                </button>
              ))}
            </div>

            {/* ── Foto bukti Transfer/QRIS ── */}
            {payMethod==="transfer"&&(
              <div style={{marginBottom:16}}>
                {/* Hidden file input — untuk opsi pilih dari folder */}
                <input ref={photoInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={capturePhoto}/>
                {photoCapture?(
                  <div>
                    <p style={{fontSize:12,color:"#16a34a",fontWeight:600,margin:"0 0 8px"}}>✅ Foto bukti tersimpan (lokal device)</p>
                    <img src={photoCapture} alt="Bukti Transfer" style={{width:"100%",maxHeight:200,objectFit:"contain",borderRadius:12,border:"1px solid #e5e7eb",marginBottom:8}}/>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={openCamera}
                        style={{flex:1,padding:"9px",background:"#f0f9ff",color:"#0284c7",border:"1px solid #bae6fd",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:12,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                        📷 Foto Ulang
                      </button>
                      <button onClick={()=>photoInputRef.current?.click()}
                        style={{flex:1,padding:"9px",background:"#f5f3ff",color:"#7c3aed",border:"1px solid #c4b5fd",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:12,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                        📁 Ganti File
                      </button>
                      <button onClick={()=>setPhotoCapture(null)}
                        style={{padding:"9px 12px",background:"#fef2f2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:12,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                        🗑️
                      </button>
                    </div>
                  </div>
                ):(
                  <div>
                    <p style={{fontSize:12,color:"#6b7280",fontWeight:600,margin:"0 0 8px"}}>Bukti Transfer/QRIS (Opsional)</p>
                    <div style={{display:"flex",gap:10}}>
                      {/* Tombol utama: kamera langsung — bekerja di HP dan laptop berkamera */}
                      <button onClick={openCamera}
                        style={{flex:1,padding:"13px",background:"#f0f9ff",color:"#0284c7",border:"2px solid #bae6fd",borderRadius:12,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
                        onMouseOver={e=>e.currentTarget.style.background="#e0f2fe"} onMouseOut={e=>e.currentTarget.style.background="#f0f9ff"}>
                        📷 Buka Kamera
                      </button>
                      {/* Alternatif: pilih dari galeri / folder */}
                      <button onClick={()=>photoInputRef.current?.click()}
                        style={{flex:1,padding:"13px",background:"#f5f3ff",color:"#7c3aed",border:"2px solid #c4b5fd",borderRadius:12,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
                        onMouseOver={e=>e.currentTarget.style.background="#ede9fe"} onMouseOut={e=>e.currentTarget.style.background="#f5f3ff"}>
                        📁 Pilih File
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Preview saldo */}
            {form.phone&&form.amount&&!sending&&(()=>{
              const cleanPhone=form.phone.trim().replace(/\D/g,"");
              const found=customers.find(c=>c.phone===cleanPhone);
              const curBal=found?found.balance:0;
              const topAmt=parseInt(form.amount)||0;
              const isNewCust=!found;
              return(
                <div style={{background:"#f9fafb",borderRadius:12,padding:"14px 16px",marginBottom:14,border:"1px solid #e5e7eb"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,paddingBottom:10,borderBottom:"1px dashed #e5e7eb"}}>
                    <span style={{fontSize:14}}>{isNewCust?"🆕":"👤"}</span>
                    <span style={{fontWeight:700,color:isNewCust?"#0284c7":"#16a34a",fontSize:13}}>{isNewCust?"Pelanggan Baru":"Pelanggan Terdaftar"}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:6}}>
                    <span style={{color:"#6b7280"}}>Saldo saat ini</span>
                    <span style={{fontWeight:700,color:"#374151"}}>{idr(curBal)}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:6}}>
                    <span style={{color:"#6b7280"}}>Nominal top up</span>
                    <span style={{fontWeight:700,color:"#16a34a"}}>+ {idr(topAmt)}</span>
                  </div>
                  <div style={{borderTop:"2px solid #e5e7eb",paddingTop:8,marginTop:2}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}>
                      <span style={{fontWeight:700,color:"#1c0a00"}}>Saldo setelah top up</span>
                      <span style={{fontWeight:900,color:"#ea580c",fontSize:16}}>{idr(curBal+topAmt)}</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            <button onClick={handleTopUp} disabled={sending}
              style={{width:"100%",padding:"14px",background:sending?"#9ca3af":"#ea580c",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:sending?"not-allowed":"pointer",fontSize:15,fontFamily:"'Plus Jakarta Sans',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:10}}
              onMouseOver={e=>{if(!sending)e.currentTarget.style.background="#c2410c";}} onMouseOut={e=>{if(!sending)e.currentTarget.style.background="#ea580c";}}>
              {sending?(<><span style={{display:"inline-block",animation:"spin 1s linear infinite"}}>⏳</span> Memproses...</>):`💰 Proses Top Up ${payMethod==="transfer"?"(Transfer)":"(Tunai)"}`}
            </button>
            {sending&&(
              <div style={{marginTop:8,background:"#fef2f2",border:"2px solid #fca5a5",borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                <p style={{margin:0,fontSize:13,fontWeight:800,color:"#dc2626"}}>⚠️ JANGAN REFRESH ATAU TUTUP HALAMAN!</p>
                <p style={{margin:"3px 0 0",fontSize:11,color:"#991b1b"}}>Sedang menyimpan ke server, mohon tunggu sampai selesai</p>
              </div>
            )}
            {!settings.fonnteToken&&<p style={{textAlign:"center",color:"#f97316",fontSize:12,margin:"8px 0 0"}}>⚠️ Fonnte token belum diisi — notifikasi WA tidak akan terkirim</p>}

            {pendingWaResend&&(
              <div style={{marginTop:12,background:"#fef3c7",border:"2px solid #fbbf24",borderRadius:12,padding:14}}>
                <p style={{margin:"0 0 8px",fontSize:13,fontWeight:700,color:"#92400e"}}>⚠️ Saldo {pendingWaResend.name} sudah tersimpan, tapi WA otomatis gagal terkirim.</p>
                <button onClick={()=>{
                    const waPhone=pendingWaResend.phone.replace(/\D/g,"");
                    const target=waPhone.startsWith("0")?"62"+waPhone.slice(1):waPhone;
                    window.open(`https://wa.me/${target}?text=${encodeURIComponent(pendingWaResend.message)}`,"_blank");
                    setPendingWaResend(null);
                  }}
                  style={{width:"100%",padding:"11px",background:"#16a34a",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                  💬 Kirim WA Manual Sekarang
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab Riwayat Top Up ── */}
      {tab==="history"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:10}}>
            <h3 style={{margin:0,fontSize:16,fontWeight:800,color:"#1c0a00"}}>📋 Riwayat Top Up</h3>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <DP value={filterDate} onChange={setFilterDate}/>
              {filteredHistLogs.length>0&&(
                <button onClick={()=>exportExcel(filteredHistLogs,`TopUp_${filterDate}${isSuperAdmin&&histView==="global"?"_Global":isSuperAdmin&&histView==="byadmin"?`_${histAdminSel}`:``}.xls`)}
                  style={{padding:"8px 14px",background:"#166534",color:"#fff",border:"none",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif",display:"flex",alignItems:"center",gap:6}}
                  onMouseOver={e=>e.currentTarget.style.background="#14532d"} onMouseOut={e=>e.currentTarget.style.background="#166534"}>
                  📥 Export Excel
                </button>
              )}
            </div>
          </div>

          {/* Filter tampilan — SuperAdmin saja */}
          {isSuperAdmin&&(
            <div style={{background:"#f9fafb",borderRadius:14,padding:"12px 14px",marginBottom:14,display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}>
              <span style={{fontSize:12,fontWeight:700,color:"#6b7280",marginRight:4}}>Tampilkan:</span>
              {[{k:"mine",l:"Top Up Saya"},{k:"global",l:"Semua Admin (Global)"},{k:"byadmin",l:"Per Admin"}].map(v=>(
                <button key={v.k} onClick={()=>{setHistView(v.k);if(v.k!=="byadmin")setHistAdminSel("");}}
                  style={{padding:"6px 14px",background:histView===v.k?"#ea580c":"#fff",color:histView===v.k?"#fff":"#6b7280",border:`1px solid ${histView===v.k?"#ea580c":"#e5e7eb"}`,borderRadius:20,cursor:"pointer",fontWeight:600,fontSize:12,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                  {v.l}
                </button>
              ))}
              {histView==="byadmin"&&(
                <select value={histAdminSel} onChange={e=>setHistAdminSel(e.target.value)}
                  style={{padding:"6px 12px",border:"1px solid #e5e7eb",borderRadius:10,fontSize:13,color:"#374151",background:"#fff",cursor:"pointer",outline:"none"}}>
                  <option value="">-- Pilih Admin --</option>
                  {adminNamesInLogs.map(n=><option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </div>
          )}

          {/* Statistik */}
          {filteredHistLogs.length>0&&(
            <div style={{marginBottom:14}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8,marginBottom:(isSuperAdmin&&histView==="global"&&koreksiTotal>0)?8:0}}>
                {[
                  {l:"💵 Tunai",v:idr(cashTotal),c:"#16a34a",bg:"#f0fdf4",bc:"#bbf7d0"},
                  {l:"💳 Transfer",v:idr(transferTotal),c:"#0284c7",bg:"#eff6ff",bc:"#bae6fd"},
                  {l:"Gross Total",v:idr(grossTotal),c:"#ea580c",bg:"#fff7ed",bc:"#fed7aa"},
                ].map(s=>(
                  <div key={s.l} style={{background:s.bg,border:`1px solid ${s.bc}`,borderRadius:12,padding:"8px 6px",textAlign:"center",minWidth:0,overflow:"hidden"}}>
                    <p style={{margin:0,color:"#6b7280",fontSize:10,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.l}</p>
                    <p style={{margin:"3px 0 0",color:s.c,fontWeight:900,fontSize:12,wordBreak:"break-all"}}>{s.v}</p>
                  </div>
                ))}
              </div>
              {/* Koreksi + Net — hanya tampil di tampilan Global dan kalau ada koreksi */}
              {(isSuperAdmin&&histView==="global"&&koreksiTotal>0)&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:12,padding:"8px 10px",textAlign:"center",minWidth:0}}>
                    <p style={{margin:0,color:"#6b7280",fontSize:10,fontWeight:600}}>✂️ Koreksi</p>
                    <p style={{margin:"3px 0 0",color:"#dc2626",fontWeight:900,fontSize:12,wordBreak:"break-all"}}>-{idr(koreksiTotal)}</p>
                  </div>
                  <div style={{background:"#f0fdf4",border:"2px solid #16a34a",borderRadius:12,padding:"8px 10px",textAlign:"center",minWidth:0}}>
                    <p style={{margin:0,color:"#6b7280",fontSize:10,fontWeight:700}}>✅ Net Bersih</p>
                    <p style={{margin:"3px 0 0",color:"#14532d",fontWeight:900,fontSize:12,wordBreak:"break-all"}}>{idr(netTotal)}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Daftar transaksi */}
          {filteredHistLogs.length===0
            ?<EmptyState icon="📋" text={isSuperAdmin&&histView==="byadmin"&&!histAdminSel?"Pilih admin untuk menampilkan riwayat.":"Tidak ada transaksi top up pada tanggal ini."}/>
            :<div style={{display:"flex",flexDirection:"column",gap:8}}>
              {filteredHistLogs.map(log=>{
                const proof=getPhoto(log.id);
                const isKoreksi=log.type==="adjustment";
                return(
                  <div key={log.id} style={{background:isKoreksi?"#fff8f8":"#fff",border:`1px solid ${isKoreksi?"#fca5a5":"#f3f4f6"}`,borderRadius:14,padding:"12px 16px",boxShadow:"0 2px 6px rgba(0,0,0,.04)"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
                      <div>
                        <div style={{display:"flex",gap:6,marginBottom:5,flexWrap:"wrap",alignItems:"center"}}>
                          {isKoreksi?(
                            <span style={{background:"#fef2f2",color:"#dc2626",fontSize:11,fontWeight:700,padding:"2px 10px",borderRadius:20,border:"1px solid #fca5a5"}}>✂️ Koreksi Saldo</span>
                          ):(
                            <>
                              <span style={{background:"#f0fdf4",color:"#16a34a",fontSize:11,fontWeight:700,padding:"2px 10px",borderRadius:20,border:"1px solid #bbf7d0"}}>💰 Top Up</span>
                              <span style={{background:log.payMethod==="transfer"?"#eff6ff":"#f0fdf4",color:log.payMethod==="transfer"?"#0284c7":"#16a34a",fontSize:11,fontWeight:700,padding:"2px 10px",borderRadius:20,border:`1px solid ${log.payMethod==="transfer"?"#bae6fd":"#bbf7d0"}`}}>
                                {log.payMethod==="transfer"?"💳 Transfer":"💵 Tunai"}
                              </span>
                            </>
                          )}
                        </div>
                        <p style={{fontWeight:700,color:"#1c0a00",margin:"0 0 2px",fontSize:14}}>{log.customerName}</p>
                        <p style={{color:"#9ca3af",fontSize:12,margin:0}}>📱 {log.customerPhone} • {log.time}</p>
                        {log.adminName&&<p style={{color:"#6b7280",fontSize:11,margin:"2px 0 0"}}>👤 Admin: <strong>{log.adminName}</strong></p>}
                        {/* Alasan koreksi */}
                        {isKoreksi&&log.note&&(
                          <p style={{color:"#dc2626",fontSize:11,margin:"4px 0 0",fontStyle:"italic"}}>📝 {log.note}</p>
                        )}
                      </div>
                      <div style={{textAlign:"right"}}>
                        <p style={{fontWeight:900,color:isKoreksi?"#dc2626":"#16a34a",fontSize:16,margin:0}}>
                          {isKoreksi?"-":"+"}{idr(log.amount)}
                        </p>
                        <p style={{color:"#374151",fontSize:11,margin:"3px 0 0",fontWeight:600}}>Saldo: <strong>{idr(log.balanceAfter)}</strong></p>
                      </div>
                    </div>
                    {/* Foto bukti transfer */}
                    {proof&&!isKoreksi&&(
                      <div style={{marginTop:10,borderTop:"1px dashed #f3f4f6",paddingTop:10}}>
                        <button onClick={()=>setExpandedProof(expandedProof===log.id?null:log.id)}
                          style={{background:"none",border:"none",padding:0,cursor:"pointer",fontSize:12,color:"#0284c7",fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                          <span>📷 Bukti Transfer</span>
                          <span style={{transform:expandedProof===log.id?"rotate(180deg)":"rotate(0)",transition:"transform .2s",display:"inline-block"}}>▼</span>
                        </button>
                        {expandedProof===log.id&&(
                          <div style={{marginTop:8}}>
                            <img src={proof} alt="Bukti Transfer" style={{width:"100%",maxHeight:280,objectFit:"contain",borderRadius:10,border:"1px solid #e5e7eb"}}/>
                            <button onClick={()=>{if(window.confirm("Hapus foto bukti ini dari device?"))deletePhoto(log.id);setExpandedProof(null);}}
                              style={{marginTop:8,padding:"6px 12px",background:"#fef2f2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>
                              🗑️ Hapus Foto dari Device
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>}
        </div>
      )}
    </div>
  );
}

// ─── Pre-Order Manager (Admin & SuperAdmin) ───────────────────────────────────
// ─── Pre-Order Manager (Admin & SuperAdmin) ───────────────────────────────────
// Setiap order disimpan TERPISAH per tenant (1 sesi checkout → N order records)
// groupNota menghubungkan semua order dari sesi yang sama
function POManager({tenants,menus,customers,walletLogs,orders,settings,admins,onSaveCustomers,onSaveWalletLogs,onSaveOrders,onSaveMenus,onUpdateCustomerBalance,onCheckConnection,adminData,isSuperAdmin}){
  // Bisa edit kuota: SuperAdmin atau admin dengan flag isPOManager
  const canEditQuota=isSuperAdmin||(adminData?.isPOManager===true);
  const [subTab,setSubTab]=useState("new");
  // PO Baru
  const [custSearch,setCustSearch]=useState("");
  // Scan QR cari pelanggan
  const [showCustScan,setShowCustScan]=useState(false);
  const [custScanErr,setCustScanErr]=useState("");
  const videoCSRef=useRef(null);
  const scanCSRef=useRef(null);
  const [selCust,setSelCust]=useState(null);
  const [activeTenant,setActiveTenant]=useState(null);
  const [cart,setCart]=useState([]); // [{tenantId,tenantName,tenantCode,menuId,menuCode,menuName,price,qty}]
  const [showScanner,setShowScanner]=useState(false);
  const [scanPhone,setScanPhone]=useState("");
  const [scanError,setScanError]=useState("");
  const [pinInput,setPinInput]=useState("");
  const [pinError,setPinError]=useState("");
  const [scannedCust,setScannedCust]=useState(null);
  const [processing,setProcessing]=useState(false);
  const submittingRef=useRef(false); // proteksi anti dobel-submit (klik ganda cepat)
  const [netToast,setNetToast]=useState(""); // network toast
  const [successMsg,setSuccessMsg]=useState("");
  const [pendingWaResend,setPendingWaResend]=useState(null);
  const [cartMinimized,setCartMinimized]=useState(false);
  // PO Tercatat
  const [poSearch,setPOSearch]=useState("");
  const [poTenantFilter,setPOTenantFilter]=useState("all");
  const [verifyOrderId,setVerifyOrderId]=useState(null);
  const [showVerifyScanner,setShowVerifyScanner]=useState(false);
  const [verifyScan,setVerifyScan]=useState("");
  const [verifyError,setVerifyError]=useState("");
  const [verifyPin,setVerifyPin]=useState("");
  const [verifyPinError,setVerifyPinError]=useState("");
  // Refund / Cancel PO
  const [confirmPOAction,setConfirmPOAction]=useState(null);
  const [poActionLoading,setPOActionLoading]=useState(false);
  const videoRef=useRef(null);
  const scanRef=useRef(null);

  const total=cart.reduce((s,it)=>s+it.price*it.qty,0);
  const tenantIds=[...new Set(cart.map(it=>it.tenantId))];

  const addToCart=(menu,tenant)=>{
    // Cek kuota
    const remaining=getPORemaining(menu,orders);
    const cartItem=cart.find(c=>c.menuId===menu.id);
    const cartQty=cartItem?.qty||0;
    if(remaining!==null&&cartQty>=remaining){
      alert(`❌ Kuota PO untuk "${menu.name}" sudah habis! (Sisa: ${remaining})`);
      return;
    }
    if(cartItem) setCart(p=>p.map(c=>c.menuId===menu.id?{...c,qty:c.qty+1}:c));
    else setCart(p=>[...p,{menuId:menu.id,menuCode:menu.code,menuName:menu.name,price:menu.price,qty:1,tenantId:tenant.id,tenantCode:tenant.code,tenantName:tenant.name}]);
  };
  const updQty=(menuId,q)=>{if(q<=0)setCart(p=>p.filter(c=>c.menuId!==menuId));else setCart(p=>p.map(c=>c.menuId===menuId?{...c,qty:q}:c));};

  // QR Scanner
  const startScan=async(onFound)=>{
    window.scrollTo({top:0,behavior:"instant"});
    setScanPhone("");setScanError("");setPinInput("");setPinError("");setScannedCust(null);
    if(!window.jsQR){await new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";s.onload=res;s.onerror=rej;document.head.appendChild(s);});}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
      if(videoRef.current){videoRef.current.srcObject=stream;videoRef.current.play();
        scanRef.current=setInterval(()=>{
          if(!videoRef.current||!window.jsQR)return;
          const c=document.createElement("canvas");c.width=videoRef.current.videoWidth;c.height=videoRef.current.videoHeight;
          const ctx=c.getContext("2d");ctx.drawImage(videoRef.current,0,0);
          const code=window.jsQR(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);
          if(code&&code.data){
            const sc=code.data.trim();
            const found=(customers||[]).find(c=>c.id===sc)||(customers||[]).find(c=>c.phone===sc.replace(/\D/g,""));
            onFound(sc,found);
            stopScan();
          }
        },500);
      }
    }catch(e){setScanError("Gagal akses kamera: "+e.message);}
  };
  const stopScan=()=>{clearInterval(scanRef.current);if(videoRef.current?.srcObject){videoRef.current.srcObject.getTracks().forEach(t=>t.stop());videoRef.current.srcObject=null;}};
  const closeScanner=()=>{stopScan();setShowScanner(false);setScanPhone("");setScanError("");setPinInput("");setPinError("");setScannedCust(null);};
  const closeVerify=()=>{stopScan();setShowVerifyScanner(false);setVerifyOrderId(null);setVerifyScan("");setVerifyError("");setVerifyPin("");setVerifyPinError("");};

  // Proses checkout: buat order TERPISAH per tenant
  const handleCheckout=async()=>{
    if(submittingRef.current)return; // proteksi anti dobel-submit (klik ganda cepat)
    const cust=scannedCust||customers.find(c=>c.id===scanPhone)||customers.find(c=>c.phone===scanPhone);
    if(!cust){setScanError("Pelanggan tidak ditemukan!");return;}
    // Verifikasi: QR harus cocok dengan pelanggan yang dipilih
    if(selCust&&cust.id!==selCust.id){setScanError(`❌ QR Code bukan milik ${selCust.name}! Scan QR yang benar.`);return;}
    if(cust.pin&&pinInput!==cust.pin){setPinError("❌ PIN salah!");setPinInput("");return;}
    if(cust.balance<total){setScanError(`Saldo tidak cukup! Saldo: ${idr(cust.balance)}, Perlu: ${idr(total)}`);return;}
    submittingRef.current=true;
    setProcessing(true);

    // ── Cek koneksi server DULU. Kalau gagal, tolak cepat & keranjang tetap utuh ──
    const online=await onCheckConnection();
    if(!online){
      setProcessing(false);
      submittingRef.current=false;
      setNetToast("PO Gagal, Jaringan Kurang Baik. Silahkan coba lagi setelah jaringan baik.");
      return;
    }

    // Generate group nota
    const todayOrders=(orders||[]).filter(o=>o.date===todayStr());
    const groupSeq=String(todayOrders.reduce((max,o)=>Math.max(max,parseInt((o.groupNota||"PO-0-0").split("-").pop())||0),0)+1).padStart(3,"0");
    const groupNota=`PO-${todayStr().replace(/-/g,"")}-${groupSeq}`;
    const groupId=uid();

    // Buat 1 order record per tenant
    const newOrders=[];
    for(const tenantId of tenantIds){
      const tenant=tenants.find(t=>t.id===tenantId);
      const items=cart.filter(it=>it.tenantId===tenantId);
      const subtotal=items.reduce((s,it)=>s+it.price*it.qty,0);
      const nota=`${groupNota}/${tenant?.code||tenantId}`;
      newOrders.push({
        id:uid(), groupId, groupNota, nota,
        customerId:cust.id, customerName:cust.name, customerPhone:cust.phone,
        tenantId, tenantCode:tenant?.code||"", tenantName:tenant?.name||"",
        items:items.map(it=>({menuId:it.menuId,menuCode:it.menuCode,menuName:it.menuName,price:it.price,qty:it.qty})),
        subtotal, groupTotal:total, status:"pending", paymentStatus:"paid", // saldo langsung dipotong saat PO dibuat
        date:todayStr(), time:timeStr(), timestamp:new Date().toISOString(),
        createdBy:adminData?.name||"Admin",
      });
    }

    let balAfter;
    // ── Potong saldo DULU secara ATOMIK (paling rawan gagal: validasi saldo & race-condition) ──
    try{
      const result=await onUpdateCustomerBalance(
        cust.id,
        -total,
        (balBefore,bAfter)=>({id:uid(),customerId:cust.id,customerPhone:cust.phone,customerName:cust.name,
          type:"payment",amount:total,balanceBefore:balBefore,balanceAfter:bAfter,
          nota:groupNota,tenantId:"PO",tenantName:"Pre-Order",
          items:cart,timestamp:new Date().toISOString(),date:todayStr(),time:timeStr()})
      );
      balAfter=result.balance;
    }catch(e){
      console.error("PO checkout gagal potong saldo:",e);
      setProcessing(false);
      submittingRef.current=false; // reset supaya bisa coba lagi
      setScanError(`❌ GAGAL! ${e.message}`);
      return;
    }

    // ── Baru simpan record PO ──
    try{
      await onSaveOrders([...(orders||[]),...newOrders]);
    }catch(e){
      console.error("PO gagal simpan SETELAH saldo terpotong:",e);
      setProcessing(false);
      submittingRef.current=false; // reset supaya bisa coba lagi
      alert(`⚠️ PERHATIAN! Saldo pelanggan SUDAH terpotong (Rp ${idr(total)}), TAPI catatan PO GAGAL tersimpan.\n\nNota: ${groupNota}\nJANGAN potong saldo lagi. Screenshot pesan ini dan laporkan ke Super Admin.\n\nDetail: ${e.message}`);
      return;
    }

    // Kirim WA nota PO
    if(settings?.fonnteToken){
      const lines=tenantIds.map(tid=>{
        const t=tenants.find(x=>x.id===tid);
        const its=cart.filter(it=>it.tenantId===tid);
        return `🏪 *${t?.name||tid}*\n`+its.map(it=>`  🍽️ ${it.menuName} x${it.qty} = ${idr(it.qty*it.price)}`).join("\n");
      }).join("\n");
      const waMsg=`🏪 *${settings.bazaarName||"BazaarPOS"}*\n\n📦 *NOTA PRE-ORDER* ✅ *LUNAS*\n📋 Nota: *${groupNota}*\n👤 Nama: ${cust.name}\n📅 ${todayStr()} ${timeStr()}\n---------------------------\n${lines}\n---------------------------\n💰 *TOTAL: ${idr(total)}*\n🪙 Sisa Saldo: ${idr(balAfter)}\n\n✅ *Pembayaran LUNAS*\nAmbil pesanan saat bazaar. Terima kasih! 🙏\n${waSignature(adminData?.name||"Admin")}`;
      const _ok1=await sendWhatsApp({token:settings.fonnteToken,phone:cust.phone,message:waMsg});
      if(!_ok1){setPendingWaResend({phone:cust.phone,message:waMsg,name:cust.name});}
    }

    closeScanner();setCart([]);setSelCust(null);setProcessing(false);
    submittingRef.current=false; // reset supaya PO berikutnya bisa diproses
    setSuccessMsg(`✅ ${newOrders.length} PO (${groupNota}) berhasil & TERSIMPAN! Saldo -${idr(total)}`);
    setTimeout(()=>setSuccessMsg(""),5000);
  };

  // Verifikasi pengambilan PO (per tenant order)
  const doVerify=async()=>{
    const order=(orders||[]).find(o=>o.id===verifyOrderId);
    if(!order){setVerifyError("PO tidak ditemukan!");return;}
    const sc=verifyScan.trim();
    const cust=customers.find(c=>c.id===sc)||customers.find(c=>c.phone===sc.replace(/\D/g,""));
    if(!cust||cust.id!==order.customerId){setVerifyError("❌ QR tidak cocok dengan pelanggan PO ini!");return;}
    if(cust.pin&&verifyPin!==cust.pin){setVerifyPinError("❌ PIN salah! Coba lagi.");setVerifyPin("");return;}

    // ── Cek koneksi server DULU. Kalau gagal, tolak cepat & data PO tetap utuh ──
    const online=await onCheckConnection();
    if(!online){
      setNetToast("Verifikasi Gagal, Jaringan Kurang Baik. Silahkan coba lagi setelah jaringan baik.");
      return;
    }

    const isUnpaid=order.paymentStatus==="unpaid";
    let balAfter=null;

    // ── Potong saldo DULU secara ATOMIK jika belum lunas ──
    if(isUnpaid){
      try{
        const result=await onUpdateCustomerBalance(
          cust.id,
          -order.subtotal,
          (balBefore,bAfter)=>({id:uid(),customerId:cust.id,customerPhone:cust.phone,customerName:cust.name,
            type:"payment",amount:order.subtotal,balanceBefore:balBefore,balanceAfter:bAfter,
            nota:order.nota,tenantId:order.tenantId,tenantName:order.tenantName,
            items:order.items,timestamp:new Date().toISOString(),date:todayStr(),time:timeStr()})
        );
        balAfter=result.balance;
      }catch(e){
        console.error("Verifikasi PO gagal potong saldo:",e);
        setVerifyError(`❌ GAGAL! ${e.message}`);
        return; // STOP — saldo belum terpotong, order belum ditandai selesai
      }
    }

    // ── Baru tandai order selesai ──
    try{
      await onSaveOrders((orders||[]).map(o=>o.id===verifyOrderId?{...o,status:"completed",paymentStatus:"paid",verifiedAt:new Date().toISOString(),verifiedBy:adminData?.name||"Admin"}:o));
    }catch(e){
      console.error("Order PO gagal disimpan SETELAH saldo terpotong:",e);
      setVerifyError(`⚠️ Saldo SUDAH terpotong tapi status PO gagal diupdate! Laporkan ke Super Admin. (${e.message})`);
      return;
    }

    // ── Database sudah confirmed tersimpan, baru kirim WA ──
    if(isUnpaid){
      const _itemsUnpaid=order.items.map(it=>`  ${it.menuName} x${it.qty} = ${idr(it.qty*it.price)}`).join("\n");
      const _msg=`🏪 *${settings.bazaarName||"BazaarPOS"}*\n\n✅ *Pembayaran & Pengambilan PO*\n📋 Nota: ${order.nota}\n🏪 Tenant: ${order.tenantName}\n---------------------------\n${_itemsUnpaid}\n---------------------------\n💸 Dibayar: ${idr(order.subtotal)}\n🪙 Sisa Saldo: ${idr(balAfter)}\n\nTerima kasih! 🙏\n${waSignature(adminData?.name||"Admin")}`;
      const _ok=settings?.fonnteToken?await sendWhatsApp({token:settings.fonnteToken,phone:cust.phone,message:_msg}):false;
      if(!_ok){setPendingWaResend({phone:cust.phone,message:_msg,name:cust.name});}
    } else {
      const _items2=order.items.map(it=>`  ${it.menuName} x${it.qty} = ${idr(it.qty*it.price)}`).join("\n");
      const _msg2=`🏪 *${settings?.bazaarName||"BazaarPOS"}*\n\n✅ *Pengambilan PO Dikonfirmasi*\n📋 Nota: ${order.nota}\n🏪 Tenant: ${order.tenantName}\n👤 Pelanggan: ${cust.name}\n---------------------------\n${_items2}\n---------------------------\n💰 *TOTAL: ${idr(order.subtotal)}*\n\nTerima kasih! 🙏\n${waSignature(adminData?.name||"Admin")}`;
      const _ok2=settings?.fonnteToken?await sendWhatsApp({token:settings.fonnteToken,phone:cust.phone,message:_msg2}):false;
      if(!_ok2){setPendingWaResend({phone:cust.phone,message:_msg2,name:cust.name});}
    }
    closeVerify();
    setSuccessMsg(`✅ PO ${order.nota} (${order.tenantName}) — ${isUnpaid?"Dibayar & ":""}Selesai & Tersimpan!`);
    setTimeout(()=>setSuccessMsg(""),4000);
  };

  // Kirim ulang nota PO
  const resendPO=async(order)=>{
    const cust=customers.find(c=>c.id===order.customerId);
    if(!cust){alert("Pelanggan tidak ditemukan.");return;}
    const items=order.items.map(it=>`[${it.menuCode||""}] ${it.menuName} x${it.qty} = ${idr(it.qty*it.price)}`).join("\n");
    const waMsg=`*${settings?.bazaarName||"BazaarPOS"}*\n\nNota Pre-Order (${order.status==="pending"?"Belum Diambil":"Sudah Selesai"})\nNota: ${order.nota}\nTenant: ${order.tenantName}\nNama: ${cust.name}\nTgl: ${order.date}\n---------------------------\n${items}\n---------------------------\n*SUBTOTAL: ${idr(order.subtotal)}*\n\n${order.status==="completed"?"Pesanan sudah diambil.":"Pesanan belum diambil."}\n\nTerima kasih!\n${waSignature(adminData?.name||"Admin")}`;
    let sent=false;
    if(settings?.fonnteToken){
      sent=await sendWhatsApp({token:settings.fonnteToken,phone:cust.phone,message:waMsg});
    }
    if(!sent){
      const waPhone=cust.phone.replace(/\D/g,"");
      const target=waPhone.startsWith("0")?"62"+waPhone.slice(1):waPhone;
      window.open(`https://wa.me/${target}?text=${encodeURIComponent(waMsg)}`,"_blank");
    } else {
      alert("✅ Nota PO berhasil dikirim!");
    }
  };

  // Data PO Tercatat — filtered per tenant
  const allPending=[...(orders||[]).filter(o=>o.status==="pending")].sort((a,b)=>{const ta=a.timestamp?new Date(a.timestamp).getTime():0;const tb=b.timestamp?new Date(b.timestamp).getTime():0;return tb-ta;});
  const filteredPO=allPending.filter(o=>{
    const tenantOk=poTenantFilter==="all"||o.tenantId===poTenantFilter;
    const searchOk=!poSearch.trim()||(o.customerName.toLowerCase().includes(poSearch.toLowerCase())||o.customerPhone.replace(/\D/g,"").includes(poSearch.replace(/\D/g,""))||o.nota.toLowerCase().includes(poSearch.toLowerCase()));
    return tenantOk&&searchOk;
  });

  // ── Refund PO (sudah bayar) ──────────────────────────────────────────────
  const doRefundPO=async(order)=>{
    setPOActionLoading(true);
    // ── Cek koneksi server DULU ──
    const online=await onCheckConnection();
    if(!online){
      setPOActionLoading(false);
      setNetToast("Refund Gagal, Jaringan Kurang Baik. Silahkan coba lagi setelah jaringan baik.");
      return;
    }
    try{
      const cust=customers.find(c=>c.id===order.customerId);
      if(cust){
        const result=await onUpdateCustomerBalance(
          cust.id,
          order.subtotal, // delta: tambah (refund)
          (balBefore,balAfter)=>({id:uid(),customerId:cust.id,customerPhone:cust.phone,customerName:cust.name,
            type:"refund",amount:order.subtotal,balanceBefore:balBefore,balanceAfter:balAfter,
            nota:order.nota,tenantId:order.tenantId,tenantName:order.tenantName,
            items:order.items,timestamp:new Date().toISOString(),date:todayStr(),time:timeStr()})
        );
        const balAfter=result.balance;
        const itemsTxt=order.items.map(it=>`  ${it.menuName} x${it.qty} = ${idr(it.qty*it.price)}`).join("\n");
        const waMsg=`*${settings?.bazaarName||"BazaarPOS"}*\n\n↩️ *Refund Pre-Order*\n📋 Nota: ${order.nota}\n🏪 Tenant: ${order.tenantName}\n---------------------------\n${itemsTxt}\n---------------------------\n💰 Refund: +${idr(order.subtotal)}\n🪙 Saldo Baru: ${idr(balAfter)}\n\nMaaf atas ketidaknyamanan ini.\n${waSignature(adminData?.name||"Super Admin")}`;
        const ok=settings?.fonnteToken?await sendWhatsApp({token:settings.fonnteToken,phone:cust.phone,message:waMsg}):false;
        if(!ok){const _p=cust.phone.replace(/\D/g,"");const _t=_p.startsWith("0")?"62"+_p.slice(1):_p;window.open(`https://wa.me/${_t}?text=${encodeURIComponent(waMsg)}`,"_blank");}
      }
      await onSaveOrders((orders||[]).map(o=>o.id===order.id?{...o,status:"cancelled",cancelledAt:new Date().toISOString(),cancelledBy:adminData?.name||"Super Admin",cancelReason:"refund"}:o));
      setConfirmPOAction(null);
      setSuccessMsg(`✅ PO ${order.nota} direfund & TERSIMPAN! Saldo +${idr(order.subtotal)} dikembalikan.`);
      setTimeout(()=>setSuccessMsg(""),5000);
    }catch(e){setSuccessMsg("❌ Gagal refund: "+e.message);}
    setPOActionLoading(false);
  };

  // ── Cancel PO (belum bayar) ───────────────────────────────────────────────
  const doCancelPO=async(order)=>{
    setPOActionLoading(true);
    // ── Cek koneksi server DULU ──
    const online=await onCheckConnection();
    if(!online){
      setPOActionLoading(false);
      setNetToast("Pembatalan Gagal, Jaringan Kurang Baik. Silahkan coba lagi setelah jaringan baik.");
      return;
    }
    try{
      const cust=customers.find(c=>c.id===order.customerId);
      const itemsTxt=order.items.map(it=>`  ${it.menuName} x${it.qty} = ${idr(it.qty*it.price)}`).join("\n");
      const waMsg=`*${settings?.bazaarName||"BazaarPOS"}*\n\n❌ *Pembatalan Pre-Order*\n📋 Nota: ${order.nota}\n🏪 Tenant: ${order.tenantName}\n---------------------------\n${itemsTxt}\n---------------------------\n💰 Total: ${idr(order.subtotal)} (tidak dipotong)\n\nPesanan dibatalkan oleh admin.\nMaaf atas ketidaknyamanan ini.\n${waSignature(adminData?.name||"Super Admin")}`;
      if(cust){
        const ok=settings?.fonnteToken?await sendWhatsApp({token:settings.fonnteToken,phone:cust.phone,message:waMsg}):false;
        if(!ok){const _p=cust.phone.replace(/\D/g,"");const _t=_p.startsWith("0")?"62"+_p.slice(1):_p;window.open(`https://wa.me/${_t}?text=${encodeURIComponent(waMsg)}`,"_blank");}
      }
      await onSaveOrders((orders||[]).map(o=>o.id===order.id?{...o,status:"cancelled",cancelledAt:new Date().toISOString(),cancelledBy:adminData?.name||"Super Admin",cancelReason:"cancel"}:o));
      setConfirmPOAction(null);
      setSuccessMsg(`✅ PO ${order.nota} dibatalkan.`);
      setTimeout(()=>setSuccessMsg(""),5000);
    }catch(e){setSuccessMsg("❌ Gagal cancel: "+e.message);}
    setPOActionLoading(false);
  };

  // ── Scan QR cari pelanggan (PO Baru) ──────────────────────────────────────
  const startCustScan=async()=>{
    window.scrollTo({top:0,behavior:"instant"});
    setCustScanErr("");setShowCustScan(true);
    if(!window.jsQR){await new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";s.onload=res;s.onerror=rej;document.head.appendChild(s);});}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
      if(videoCSRef.current){videoCSRef.current.srcObject=stream;videoCSRef.current.play();
        scanCSRef.current=setInterval(()=>{
          if(!videoCSRef.current||!window.jsQR)return;
          const cv=document.createElement("canvas");cv.width=videoCSRef.current.videoWidth;cv.height=videoCSRef.current.videoHeight;
          const ctx=cv.getContext("2d");ctx.drawImage(videoCSRef.current,0,0);
          const code=window.jsQR(ctx.getImageData(0,0,cv.width,cv.height).data,cv.width,cv.height);
          if(code&&code.data){
            const sc=code.data.trim();
            const found=customers.find(c=>c.id===sc)||customers.find(c=>c.phone===sc.replace(/\D/g,""));
            if(found){setSelCust(found);setCustSearch("");closeCustScan();}
            else{setCustScanErr("QR tidak dikenali / pelanggan tidak ditemukan");closeCustScan();}
          }
        },500);
      }
    }catch(e){setCustScanErr("Gagal akses kamera: "+e.message);}
  };
  const closeCustScan=()=>{
    clearInterval(scanCSRef.current);
    if(videoCSRef.current?.srcObject){videoCSRef.current.srcObject.getTracks().forEach(t=>t.stop());videoCSRef.current.srcObject=null;}
    setShowCustScan(false);
  };

  return(
    <div>
      {/* ── Modal Checkout Scan QR ── */}
      {showScanner&&(
        <Modal title="📷 Verifikasi Pelanggan + PIN" onClose={closeScanner}>
          {selCust&&<div style={{background:"#f0f9ff",borderRadius:10,padding:"8px 14px",marginBottom:10}}>
            <p style={{margin:0,fontSize:13,color:"#0284c7",fontWeight:600}}>⚠️ QR harus milik: <strong>{selCust.name}</strong></p>
          </div>}
          <p style={{color:"#6b7280",fontSize:13,margin:"0 0 10px"}}>Scan QR Code pelanggan.</p>
          {!scanPhone&&(
            <div style={{position:"relative",borderRadius:14,overflow:"hidden",background:"#000",marginBottom:12,height:220}}>
              <video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover"}} playsInline muted/>
              <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
                <div style={{width:160,height:160,border:"3px solid #ea580c",borderRadius:12,boxShadow:"0 0 0 2000px rgba(0,0,0,.4)"}}/>
              </div>
            </div>
          )}
          {scanError&&<div style={{background:"#fef2f2",borderRadius:10,padding:"8px 12px",color:"#dc2626",fontWeight:600,fontSize:13,marginBottom:10}}>❌ {scanError}</div>}
          {scanPhone&&!scanError&&(()=>{
            const cust=scannedCust||customers.find(c=>c.id===scanPhone)||customers.find(c=>c.phone===scanPhone);
            const matched=cust&&(!selCust||cust.id===selCust.id);
            if(!cust||!matched) return <div style={{background:"#fef2f2",borderRadius:12,padding:"12px",marginBottom:10}}>
              <p style={{margin:0,color:"#dc2626",fontWeight:700}}>❌ {!cust?"Pelanggan tidak ditemukan":`QR bukan milik ${selCust?.name}`}</p>
            </div>;
            return(
              <div>
                <div style={{background:cust.balance>=total?"#f0fdf4":"#fef2f2",borderRadius:12,padding:"12px",marginBottom:10}}>
                  <p style={{margin:"0 0 2px",fontWeight:800,fontSize:15,color:"#14532d"}}>✅ {cust.name}</p>
                  <p style={{margin:"0 0 6px",color:"#6b7280",fontSize:12}}>📱 {cust.phone}</p>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <div><p style={{margin:0,color:"#6b7280",fontSize:12}}>Saldo</p><p style={{margin:0,fontWeight:900,color:cust.balance>=total?"#16a34a":"#dc2626",fontSize:16}}>{idr(cust.balance)}</p></div>
                    <div style={{textAlign:"right"}}><p style={{margin:0,color:"#6b7280",fontSize:12}}>Total PO</p><p style={{margin:0,fontWeight:900,color:"#ea580c",fontSize:16}}>{idr(total)}</p></div>
                  </div>
                  {cust.balance<total&&<p style={{margin:"6px 0 0",color:"#dc2626",fontSize:12,fontWeight:600,textAlign:"center"}}>⚠️ Saldo tidak cukup</p>}
                </div>
                {cust.balance>=total&&cust.pin&&(
                  <div style={{marginBottom:10}}>
                    <p style={{textAlign:"center",fontWeight:700,color:"#374151",fontSize:13,margin:"0 0 8px"}}>🔐 PIN Pelanggan</p>
                    <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:6}}>
                      {[0,1,2,3].map(i=><div key={i} style={{width:46,height:56,background:pinInput.length>i?"#4c1d95":"#f9fafb",border:`2px solid ${pinInput.length>i?"#7c3aed":"#e5e7eb"}`,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:"#fff"}}>{pinInput.length>i?"●":""}</div>)}
                    </div>
                    {pinError&&<p style={{textAlign:"center",color:"#dc2626",fontSize:12,fontWeight:600,margin:"2px 0 6px"}}>{pinError}</p>}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,maxWidth:200,margin:"0 auto"}}>
                      {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k,i)=>(
                        <button key={i} onClick={()=>{if(k==="")return;if(k==="⌫"){setPinInput(p=>p.slice(0,-1));setPinError("");}else if(pinInput.length<4){setPinInput(p=>p+k);setPinError("");}}}
                          style={{padding:"12px 0",background:k==="⌫"?"#fef2f2":k===""?"transparent":"#f9fafb",color:k==="⌫"?"#dc2626":"#1c0a00",border:`1px solid ${k==="⌫"?"#fca5a5":k===""?"transparent":"#e5e7eb"}`,borderRadius:10,fontSize:18,fontWeight:700,cursor:k===""?"default":"pointer",fontFamily:"'Plus Jakarta Sans',sans-serif",visibility:k===""?"hidden":"visible"}}>
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <div style={{display:"flex",gap:10,marginTop:8}}>
            <button onClick={closeScanner} style={{...btnSec,flex:1}}>Batal</button>
            {scanPhone&&(()=>{const cust=scannedCust||customers.find(c=>c.id===scanPhone)||customers.find(c=>c.phone===scanPhone);const ok=cust&&(!selCust||cust.id===selCust.id)&&cust.balance>=total&&(pinInput.length===4||!cust.pin);return ok;})()?
              <button onClick={handleCheckout} disabled={processing}
                style={{flex:2,padding:"13px",background:processing?"#9ca3af":"#16a34a",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:processing?"not-allowed":"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                {processing?"⏳ Memproses...":"✅ Konfirmasi PO"}
              </button>:null}
          </div>
        </Modal>
      )}

      {/* ── Modal Verify Scan ── */}
      {showVerifyScanner&&(
        <Modal title="📷 Scan QR — Konfirmasi Pengambilan" onClose={closeVerify}>
          {(()=>{const ord=(orders||[]).find(o=>o.id===verifyOrderId);return ord&&<p style={{color:"#6b7280",fontSize:13,margin:"0 0 10px"}}>{ord.paymentStatus==="unpaid"?"Scan QR Pelanggan untuk Pemotongan Saldo sesuai PO & konfirmasi pengambilan PO.":"Scan QR Pelanggan untuk konfirmasi pengambilan PO."}</p>;})()} 
          {(()=>{const ord=(orders||[]).find(o=>o.id===verifyOrderId);return ord&&<div style={{background:ord.paymentStatus==="unpaid"?"#fef2f2":"#f0f9ff",borderRadius:10,padding:"8px 14px",marginBottom:10}}>
            <p style={{margin:0,fontSize:13,color:ord.paymentStatus==="unpaid"?"#dc2626":"#0284c7",fontWeight:600}}>
              {ord.paymentStatus==="unpaid"?"💸 BAYAR NANTI — Saldo akan dipotong saat ini":"📋 Sudah Lunas"} | {ord.nota} — {ord.tenantName} — {ord.customerName}
            </p>
            {ord.paymentStatus==="unpaid"&&<p style={{margin:"3px 0 0",fontSize:12,color:"#dc2626",fontWeight:700}}>Total yang akan dibayar: {idr(ord.subtotal)}</p>}
          </div>;})()} 
          {!verifyScan&&(
            <div style={{position:"relative",borderRadius:14,overflow:"hidden",background:"#000",marginBottom:12,height:220}}>
              <video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover"}} playsInline muted/>
              <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
                <div style={{width:160,height:160,border:"3px solid #16a34a",borderRadius:12,boxShadow:"0 0 0 2000px rgba(0,0,0,.4)"}}/>
              </div>
            </div>
          )}
          {verifyError&&<div style={{background:"#fef2f2",borderRadius:10,padding:"8px 12px",color:"#dc2626",fontWeight:600,fontSize:13,marginBottom:10}}>❌ {verifyError}</div>}
          {verifyScan&&(()=>{
            const ord=(orders||[]).find(o=>o.id===verifyOrderId);
            const cust=ord&&customers.find(c=>c.id===ord.customerId);
            const ok=cust&&(verifyScan===cust.id||verifyScan.replace(/\D/g,"")===cust.phone);
            return(
              <div>
                <div style={{background:ok?"#f0fdf4":"#fef2f2",borderRadius:12,padding:"12px",marginBottom:10}}>
                  <p style={{margin:"0 0 2px",fontWeight:800,color:ok?"#14532d":"#dc2626"}}>{ok?"✅ QR Cocok!":"❌ QR Tidak Cocok"}</p>
                  {cust&&<p style={{margin:0,color:"#6b7280",fontSize:13}}>{cust.name}</p>}
                </div>
                {ok&&cust.pin&&(
                  <div style={{marginBottom:10}}>
                    <p style={{textAlign:"center",fontWeight:700,color:"#374151",fontSize:13,margin:"0 0 8px"}}>🔐 Masukkan PIN Pelanggan</p>
                    <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:6}}>
                      {[0,1,2,3].map(i=><div key={i} style={{width:46,height:56,background:verifyPin.length>i?"#4c1d95":"#f9fafb",border:`2px solid ${verifyPin.length>i?"#7c3aed":"#e5e7eb"}`,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:"#fff"}}>{verifyPin.length>i?"●":""}</div>)}
                    </div>
                    {verifyPinError&&<p style={{textAlign:"center",color:"#dc2626",fontSize:12,fontWeight:600,margin:"2px 0 6px"}}>{verifyPinError}</p>}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,maxWidth:200,margin:"0 auto"}}>
                      {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k,i)=>(
                        <button key={i} onClick={()=>{if(k==="")return;if(k==="⌫"){setVerifyPin(p=>p.slice(0,-1));setVerifyPinError("");}else if(verifyPin.length<4){setVerifyPin(p=>p+k);setVerifyPinError("");}}}
                          style={{padding:"12px 0",background:k==="⌫"?"#fef2f2":k===""?"transparent":"#f9fafb",color:k==="⌫"?"#dc2626":"#1c0a00",border:`1px solid ${k==="⌫"?"#fca5a5":k===""?"transparent":"#e5e7eb"}`,borderRadius:10,fontSize:18,fontWeight:700,cursor:k===""?"default":"pointer",fontFamily:"'Plus Jakarta Sans',sans-serif",visibility:k===""?"hidden":"visible"}}>
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <div style={{display:"flex",gap:10}}>
            <button onClick={closeVerify} style={{...btnSec,flex:1}}>Batal</button>
            {verifyScan&&(()=>{
              const ord=(orders||[]).find(o=>o.id===verifyOrderId);
              const cust=ord&&customers.find(c=>c.id===ord.customerId);
              const qrOk=cust&&(verifyScan===cust.id||verifyScan.replace(/\D/g,"")===cust.phone);
              const pinOk=!cust?.pin||verifyPin.length===4;
              return qrOk&&pinOk;
            })()?
              <button onClick={doVerify} style={{flex:2,padding:"13px",background:"#16a34a",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>✅ Selesaikan PO</button>:null}
          </div>
        </Modal>
      )}

      {/* ── Modal Konfirmasi Refund / Cancel PO ── */}
      {confirmPOAction&&(
        <Modal title={confirmPOAction.type==="refund"?"↩️ Konfirmasi Refund PO":"❌ Konfirmasi Batalkan PO"} onClose={()=>setConfirmPOAction(null)}>
          <div style={{background:confirmPOAction.type==="refund"?"#fef3c7":"#fef2f2",borderRadius:12,padding:"14px 16px",marginBottom:14}}>
            <p style={{margin:"0 0 6px",fontWeight:700,color:confirmPOAction.type==="refund"?"#92400e":"#dc2626",fontSize:14}}>
              {confirmPOAction.type==="refund"?"💰 Saldo akan dikembalikan ke pelanggan":"⚠️ PO akan dibatalkan, saldo tidak dipotong"}
            </p>
            <p style={{margin:"0 0 4px",color:"#374151",fontSize:13}}>📋 {confirmPOAction.order.nota} — {confirmPOAction.order.tenantName}</p>
            <p style={{margin:"0 0 4px",color:"#374151",fontSize:13}}>👤 {confirmPOAction.order.customerName}</p>
            <div style={{marginTop:8,background:"rgba(0,0,0,.05)",borderRadius:8,padding:"8px 10px"}}>
              {confirmPOAction.order.items.map((it,i)=>(
                <p key={i} style={{margin:"2px 0",fontSize:12,color:"#374151"}}>{it.menuName} ×{it.qty} = {idr(it.qty*it.price)}</p>
              ))}
              <p style={{margin:"6px 0 0",fontWeight:700,color:"#1c0a00",fontSize:13}}>Total: {idr(confirmPOAction.order.subtotal)}</p>
            </div>
            {confirmPOAction.type==="refund"&&<p style={{margin:"8px 0 0",color:"#16a34a",fontWeight:600,fontSize:13}}>✅ Refund: +{idr(confirmPOAction.order.subtotal)}</p>}
          </div>
          <p style={{color:"#9ca3af",fontSize:12,margin:"0 0 16px"}}>Nota WA akan dikirim ke pelanggan setelah proses ini.</p>
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setConfirmPOAction(null)} style={{...btnSec,flex:1}}>Batal</button>
            <button onClick={()=>confirmPOAction.type==="refund"?doRefundPO(confirmPOAction.order):doCancelPO(confirmPOAction.order)}
              disabled={poActionLoading}
              style={{flex:2,padding:"13px",background:poActionLoading?"#9ca3af":confirmPOAction.type==="refund"?"#ea580c":"#dc2626",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:poActionLoading?"not-allowed":"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
              {poActionLoading?"⏳ Memproses...":(confirmPOAction.type==="refund"?"↩️ Ya, Refund":"❌ Ya, Batalkan")}
            </button>
          </div>
        </Modal>
      )}

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <h2 style={{margin:0,fontSize:20,fontWeight:800,color:"#1c0a00"}}>📦 Pre-Order</h2>
          <p style={{color:"#9ca3af",margin:"4px 0 0",fontSize:13}}>{allPending.length} PO belum selesai • {(orders||[]).filter(o=>o.status==="completed").length} selesai</p>
        </div>
      </div>
      <NetToast msg={netToast} onClose={()=>setNetToast("")}/>
      {successMsg&&<div className="pop-in" style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:12,padding:"10px 16px",marginBottom:16,fontWeight:600,fontSize:13,color:"#16a34a"}}>{successMsg}</div>}
      <WaFallbackCard pending={pendingWaResend} onDismiss={()=>setPendingWaResend(null)}/>

      {/* Sub-tabs */}
      <div style={{display:"flex",gap:4,marginBottom:20,background:"#f9fafb",borderRadius:14,padding:4}}>
        {[{k:"new",i:"➕",l:"PO Baru"},{k:"recorded",i:"📋",l:"PO Tercatat"},{k:"report",i:"📊",l:"Laporan PO"}].map(t=>(
          <button key={t.k} onClick={()=>setSubTab(t.k)}
            style={{flex:1,padding:"10px 6px",background:subTab===t.k?"#fff":"transparent",border:"none",borderRadius:10,fontWeight:subTab===t.k?700:500,color:subTab===t.k?"#ea580c":"#6b7280",cursor:"pointer",fontSize:13,boxShadow:subTab===t.k?"0 2px 8px rgba(0,0,0,.08)":"none",transition:"all .2s"}}>
            {t.i} {t.l}
          </button>
        ))}
      </div>

      {/* ── Tab PO Baru ── */}
      {subTab==="new"&&(
        <div>
          {/* Pilih Pelanggan */}
          <div style={{background:"#fff",borderRadius:16,padding:18,boxShadow:"0 2px 8px rgba(0,0,0,.05)",marginBottom:14}}>
            <p style={{fontWeight:800,color:"#ea580c",fontSize:14,margin:"0 0 10px",borderLeft:"4px solid #ea580c",paddingLeft:10}}>👤 Pilih Pelanggan</p>
            {/* Modal scan QR cari pelanggan */}
            {showCustScan&&(
              <Modal title="📷 Scan QR Cari Pelanggan" onClose={closeCustScan}>
                <p style={{color:"#6b7280",fontSize:13,margin:"0 0 10px"}}>Scan QR Code kartu pelanggan untuk mencarinya.</p>
                <div style={{position:"relative",borderRadius:14,overflow:"hidden",background:"#000",marginBottom:12,height:220}}>
                  <video ref={videoCSRef} style={{width:"100%",height:"100%",objectFit:"cover"}} playsInline muted/>
                  <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
                    <div style={{width:160,height:160,border:"3px solid #ea580c",borderRadius:12,boxShadow:"0 0 0 2000px rgba(0,0,0,.4)"}}/>
                  </div>
                </div>
                {custScanErr&&<p style={{color:"#dc2626",fontWeight:600,fontSize:13,textAlign:"center"}}>{custScanErr}</p>}
                <button onClick={closeCustScan} style={{...btnSec,width:"100%"}}>Tutup</button>
              </Modal>
            )}
            <div style={{display:"flex",gap:8}}>
              <input placeholder="🔍 Cari nama atau nomor WA..." value={custSearch} onChange={e=>setCustSearch(e.target.value)}
                style={{flex:1,border:"2px solid #e5e7eb",borderRadius:10,padding:"10px 14px",fontSize:14,outline:"none",color:"#111",boxSizing:"border-box",fontFamily:"'Plus Jakarta Sans',sans-serif",marginBottom:8}}
                onFocus={e=>e.target.style.borderColor="#ea580c"} onBlur={e=>e.target.style.borderColor="#e5e7eb"}/>
              <button onClick={startCustScan} title="Scan QR pelanggan"
                style={{padding:"10px 14px",background:"#fff7ed",color:"#ea580c",border:"2px solid #fed7aa",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:16,flexShrink:0,height:44}}
                onMouseOver={e=>e.currentTarget.style.background="#fef3c7"} onMouseOut={e=>e.currentTarget.style.background="#fff7ed"}>
                📷
              </button>
            </div>
            {custSearch&&(()=>{
              const res=customers.filter(c=>c.name.toLowerCase().includes(custSearch.toLowerCase())||c.phone.replace(/\D/g,"").includes(custSearch.replace(/\D/g,"")));
              return res.length===0?<p style={{color:"#9ca3af",fontSize:13,textAlign:"center",margin:"6px 0"}}>Tidak ditemukan</p>:
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {res.slice(0,5).map(c=>(
                    <button key={c.id} onClick={()=>{setSelCust(c);setCustSearch("");}}
                      style={{padding:"10px 14px",background:selCust?.id===c.id?"#fff7ed":"#f9fafb",border:`2px solid ${selCust?.id===c.id?"#ea580c":"#f3f4f6"}`,borderRadius:10,cursor:"pointer",textAlign:"left",fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                      <p style={{margin:0,fontWeight:700,color:"#1c0a00",fontSize:14}}>{c.name}</p>
                      <p style={{margin:"2px 0 0",color:"#6b7280",fontSize:12}}>📱 {c.phone} • 🪙 {idr(c.balance)}</p>
                    </button>
                  ))}
                </div>;
            })()}
            {selCust&&(
              <div style={{background:"#fff7ed",borderRadius:12,padding:"12px 16px",marginTop:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <p style={{margin:0,fontWeight:800,color:"#1c0a00",fontSize:15}}>{selCust.name}</p>
                  <p style={{margin:"2px 0 0",color:"#6b7280",fontSize:13}}>📱 {selCust.phone}</p>
                </div>
                <div style={{textAlign:"right"}}>
                  <p style={{margin:0,color:"#9ca3af",fontSize:12}}>Saldo</p>
                  <p style={{margin:0,fontWeight:900,color:"#16a34a",fontSize:18}}>{idr(selCust.balance)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Pilih Menu per Tenant */}
          <div style={{background:"#fff",borderRadius:16,padding:18,boxShadow:"0 2px 8px rgba(0,0,0,.05)",marginBottom:14}}>
            <p style={{fontWeight:800,color:"#ea580c",fontSize:14,margin:"0 0 10px",borderLeft:"4px solid #ea580c",paddingLeft:10}}>🍽️ Pilih Menu per Tenant</p>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
              {tenants.map(t=>(
                <button key={t.id} onClick={()=>setActiveTenant(activeTenant?.id===t.id?null:t)}
                  style={{padding:"7px 14px",background:activeTenant?.id===t.id?"#ea580c":"#f9fafb",color:activeTenant?.id===t.id?"#fff":"#374151",border:`1px solid ${activeTenant?.id===t.id?"#ea580c":"#e5e7eb"}`,borderRadius:20,cursor:"pointer",fontWeight:600,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                  {t.code} — {t.name} {cart.filter(c=>c.tenantId===t.id).length>0&&`(${cart.filter(c=>c.tenantId===t.id).reduce((s,c)=>s+c.qty,0)} item)`}
                </button>
              ))}
            </div>
              {activeTenant&&(()=>{
              const tMenus=(menus||[]).filter(m=>m.tenantId===activeTenant.id);
              return tMenus.length===0?<p style={{color:"#9ca3af",fontSize:13,textAlign:"center"}}>Belum ada menu.</p>:
                <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10}}>
                  {tMenus.map(m=>{
                    const remaining=getPORemaining(m,orders);
                    const cartItem=cart.find(c=>c.menuId===m.id);
                    const cartQty=cartItem?.qty||0;
                    const isHabis=remaining!==null&&remaining<=cartQty;
                    return(
                    <div key={m.id} style={{background:isHabis?"#fef2f2":"#f9fafb",border:`1px solid ${isHabis?"#fca5a5":"#e5e7eb"}`,borderRadius:12,padding:"12px",opacity:isHabis?0.75:1}}>
                      <button onClick={()=>{if(isHabis)return;addToCart(m,activeTenant);}} className="btn-press"
                        style={{width:"100%",background:"none",border:"none",padding:0,cursor:isHabis?"not-allowed":"pointer",textAlign:"left",fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                        <p style={{margin:"0 0 2px",fontSize:10,color:"#9ca3af"}}>[{m.code}]</p>
                        <p style={{margin:"0 0 3px",fontWeight:700,color:"#1c0a00",fontSize:13,lineHeight:1.3}}>{m.name}</p>
                        <p style={{margin:"0 0 4px",color:"#16a34a",fontWeight:800,fontSize:13}}>{idr(m.price)}</p>
                        <POQuotaBadge menu={m} orders={orders} size={11}/>
                        {cartQty>0&&<p style={{margin:"3px 0 0",fontSize:11,color:"#ea580c",fontWeight:600}}>× {cartQty} di keranjang</p>}
                        {isHabis&&<p style={{margin:"2px 0 0",fontSize:11,color:"#dc2626",fontWeight:700}}>❌ Kuota habis</p>}
                      </button>
                      {/* Kontrol kuota — hanya Manager PO & SuperAdmin */}
                      {canEditQuota&&(()=>{
                        const usedQty=getPOUsed(m.id,orders);
                        const hasUsage=usedQty>0;
                        return(
                        <div style={{borderTop:"1px dashed #e5e7eb",marginTop:8,paddingTop:6}}>
                          <label style={{display:"flex",alignItems:"center",gap:6,cursor:hasUsage?"not-allowed":"pointer",userSelect:"none"}}
                            title={hasUsage?`Sudah ada ${usedQty} PO untuk menu ini — tidak bisa nonaktifkan kuota`:""}>
                            <input type="checkbox" checked={!!m.poLimit} disabled={hasUsage}
                              onChange={async()=>{
                                if(hasUsage)return;
                                const newLimit=m.poLimit?null:Math.max(100,usedQty+10);
                                try{ await onSaveMenus(menus.map(x=>x.id===m.id?{...x,poLimit:newLimit}:x)); }
                                catch(e){ alert("❌ Gagal simpan kuota: "+e.message); }
                              }}
                              style={{width:14,height:14,cursor:hasUsage?"not-allowed":"pointer",accentColor:"#ea580c",opacity:hasUsage?0.5:1}}/>
                            <span style={{fontSize:11,color:hasUsage?"#9ca3af":"#6b7280",fontWeight:600}}>Batas Kuota</span>
                          </label>
                          {hasUsage&&!m.poLimit&&<p style={{margin:"3px 0 0",fontSize:10,color:"#f97316"}}>🔒 Sudah ada {usedQty} PO</p>}
                          {m.poLimit&&(
                            <div style={{display:"flex",alignItems:"center",gap:6,marginTop:5}}>
                              <input type="number" key={m.poLimit} defaultValue={m.poLimit} min="1"
                                onBlur={async e=>{
                                  const n=parseInt(e.target.value)||0;
                                  if(n===m.poLimit)return; // tidak berubah
                                  if(n<=usedQty){
                                    alert(`❌ Kuota yang diinput tidak bisa lebih sedikit dari batas sebelumnya!\nPO sudah terpesan: ${usedQty}\nMinimal kuota: ${usedQty+1}`);
                                    e.target.value=m.poLimit;
                                    return;
                                  }
                                  if(window.confirm(`Anda yakin mengubah jumlah kuota PO dari ${m.poLimit} menjadi ${n}?`)){
                                    try{ await onSaveMenus(menus.map(x=>x.id===m.id?{...x,poLimit:n}:x)); }
                                    catch(err){ alert("❌ Gagal simpan kuota: "+err.message); e.target.value=m.poLimit; }
                                  } else {
                                    e.target.value=m.poLimit;
                                  }
                                }}
                                style={{width:55,border:"2px solid #fed7aa",borderRadius:7,padding:"3px 6px",fontSize:13,fontWeight:700,color:"#ea580c",outline:"none",textAlign:"center"}}/>
                              <span style={{fontSize:11,color:"#9ca3af"}}>maks</span>
                            </div>
                          )}
                        </div>
                        );
                      })()}
                    </div>
                  );})}
                </div>;
              })()}
          </div>

          {/* Keranjang */}
          {cart.length>0&&(
            <div style={{background:"#fff",borderRadius:16,padding:18,boxShadow:"0 4px 16px rgba(234,88,12,.1)",border:"1px solid #fed7aa",position:"sticky",bottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:cartMinimized?0:10}}>
                <p style={{fontWeight:800,color:"#ea580c",fontSize:14,margin:0}}>🛒 Keranjang PO — {tenantIds.length} Tenant ({cart.reduce((s,it)=>s+it.qty,0)} item)</p>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>{if(window.confirm("Batalkan semua isi keranjang PO?"))setCart([]);}}
                    title="Batalkan keranjang"
                    style={{padding:"4px 10px",background:"#fef2f2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:12,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                    ✕ Batal
                  </button>
                  <button onClick={()=>setCartMinimized(p=>!p)}
                    style={{padding:"4px 10px",background:"#fff7ed",color:"#ea580c",border:"1px solid #fed7aa",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:12,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                    {cartMinimized?"▲ Buka":"▼ Minimize"}
                  </button>
                </div>
              </div>
              {!cartMinimized&&(
                <div>
                  <div style={{maxHeight:180,overflowY:"auto",marginBottom:10}}>
                    {tenantIds.map(tid=>{
                      const tItems=cart.filter(it=>it.tenantId===tid);
                      const tTotal=tItems.reduce((s,it)=>s+it.price*it.qty,0);
                      const tName=tItems[0]?.tenantName||"";
                      return(
                        <div key={tid} style={{marginBottom:10,background:"#f9fafb",borderRadius:10,padding:"10px 12px"}}>
                          <p style={{margin:"0 0 6px",fontWeight:700,color:"#374151",fontSize:13}}>🏪 {tName} — {idr(tTotal)}</p>
                          {tItems.map(it=>(
                            <div key={it.menuId} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderBottom:"1px dashed #e5e7eb"}}>
                              <span style={{flex:1,fontSize:13,color:"#1c0a00",fontWeight:600}}>{it.menuName}</span>
                              <div style={{display:"flex",alignItems:"center",gap:6}}>
                                <button onClick={()=>updQty(it.menuId,it.qty-1)} style={{width:24,height:24,borderRadius:"50%",background:"#fef2f2",color:"#dc2626",border:"none",cursor:"pointer",fontWeight:800,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                                <span style={{width:22,textAlign:"center",fontWeight:700,fontSize:13}}>{it.qty}</span>
                                <button onClick={()=>updQty(it.menuId,it.qty+1)} style={{width:24,height:24,borderRadius:"50%",background:"#dcfce7",color:"#16a34a",border:"none",cursor:"pointer",fontWeight:800,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                              </div>
                              <span style={{fontWeight:700,color:"#1c0a00",fontSize:13,width:66,textAlign:"right"}}>{idr(it.qty*it.price)}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",borderTop:"2px solid #fed7aa",paddingTop:10,marginBottom:12}}>
                    <p style={{margin:0,fontWeight:700,color:"#374151"}}>TOTAL PO</p>
                    <p style={{margin:0,fontWeight:900,color:"#ea580c",fontSize:18}}>{idr(total)}</p>
                  </div>
                  <button onClick={()=>{
                      if(!selCust){alert("Pilih pelanggan terlebih dahulu!");return;}
                      setShowScanner(true);
                      startScan((sc,found)=>{setScanPhone(found?found.id:sc);setScannedCust(found||null);});
                    }}
                    style={{width:"100%",padding:"14px",background:"linear-gradient(135deg,#4c1d95,#7c3aed)",color:"#fff",border:"none",borderRadius:12,fontWeight:800,fontSize:15,cursor:"pointer",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"center",gap:10,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                    📷 Scan QR & Bayar Sekarang
                  </button>
                  <button onClick={async()=>{
                      if(!selCust){alert("Pilih pelanggan terlebih dahulu!");return;}
                      if(!window.confirm(`Buat PO "Bayar Nanti" untuk ${selCust.name}?\nSaldo TIDAK dipotong sekarang, pelanggan bayar saat pengambilan.`))return;
                      const online=await onCheckConnection();
                      if(!online){
                        setNetToast("PO Gagal, Jaringan Kurang Baik. Silahkan coba lagi setelah jaringan baik.");
                        return;
                      }
                      const todayOrders=(orders||[]).filter(o=>o.date===todayStr());
                      const groupSeq=String(todayOrders.reduce((max,o)=>Math.max(max,parseInt((o.groupNota||"PO-0-0").split("-").pop())||0),0)+1).padStart(3,"0");
                      const groupNota=`PO-${todayStr().replace(/-/g,"")}-${groupSeq}`;
                      const groupId=uid();
                      const newOrders=[];
                      for(const tenantId of tenantIds){
                        const tenant=tenants.find(t=>t.id===tenantId);
                        const items=cart.filter(it=>it.tenantId===tenantId);
                        const subtotal=items.reduce((s,it)=>s+it.price*it.qty,0);
                        newOrders.push({
                          id:uid(),groupId,groupNota,nota:`${groupNota}/${tenant?.code||tenantId}`,
                          customerId:selCust.id,customerName:selCust.name,customerPhone:selCust.phone,
                          tenantId,tenantCode:tenant?.code||"",tenantName:tenant?.name||"",
                          items:items.map(it=>({menuId:it.menuId,menuCode:it.menuCode,menuName:it.menuName,price:it.price,qty:it.qty})),
                          subtotal,groupTotal:total,paymentStatus:"unpaid",status:"pending",
                          date:todayStr(),time:timeStr(),timestamp:new Date().toISOString(),
                          createdBy:adminData?.name||"Admin",
                        });
                      }
                      try{
                        await onSaveOrders([...(orders||[]),...newOrders]);
                      }catch(e){
                        console.error("PO Bayar Nanti gagal simpan:",e);
                        alert(`❌ GAGAL MENYIMPAN PO! Coba lagi.\n\nDetail: ${e.message}`);
                        return; // STOP — keranjang tetap utuh
                      }
                      if(settings?.fonnteToken){
                        const lines=tenantIds.map(tid=>{const t=tenants.find(x=>x.id===tid);const its=cart.filter(it=>it.tenantId===tid);return`🏪 *${t?.name||tid}*\n`+its.map(it=>`  🍽️ ${it.menuName} x${it.qty} = ${idr(it.qty*it.price)}`).join("\n");}).join("\n");
                        const _bnMsg=`*${settings.bazaarName||"BazaarPOS"}*\n\nPRE-ORDER — BAYAR NANTI\nNota: ${groupNota}\nNama: ${selCust.name}\n---------------------------\n${lines}\n---------------------------\n*TOTAL: ${idr(total)}*\nPembayaran saat pengambilan.\n\nTerima kasih!\n${waSignature(adminData?.name||"Admin")}`;
                        const _bnOk=settings.fonnteToken?await sendWhatsApp({token:settings.fonnteToken,phone:selCust.phone,message:_bnMsg}):false;
                        if(!_bnOk){const _p=selCust.phone.replace(/\D/g,"");const _t=_p.startsWith("0")?"62"+_p.slice(1):_p;window.open(`https://wa.me/${_t}?text=${encodeURIComponent(_bnMsg)}`,"_blank");}
                      }
                      setCart([]);setSelCust(null);
                      setSuccessMsg(`✅ PO Bayar Nanti (${groupNota}) dicatat & TERSIMPAN! Bayar saat pengambilan.`);
                      setTimeout(()=>setSuccessMsg(""),5000);
                    }}
                    style={{width:"100%",padding:"12px",background:"#fff7ed",color:"#ea580c",border:"2px solid #fed7aa",borderRadius:12,fontWeight:800,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
                    onMouseOver={e=>e.currentTarget.style.background="#fef3c7"} onMouseOut={e=>e.currentTarget.style.background="#fff7ed"}>
                    🕐 Bayar Nanti (Catat Dulu)
                  </button>
                  {!selCust&&<p style={{textAlign:"center",color:"#f97316",fontSize:12,margin:"6px 0 0"}}>⚠️ Pilih pelanggan dulu</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tab PO Tercatat ── */}
      {subTab==="recorded"&&(
        <div>
          {/* Filter & Search */}
          <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
            <input placeholder="🔍 Cari nama atau nomor HP pelanggan..."
              value={poSearch} onChange={e=>setPOSearch(e.target.value)}
              style={{flex:1,minWidth:180,border:"2px solid #e5e7eb",borderRadius:10,padding:"10px 14px",fontSize:14,outline:"none",color:"#111",fontFamily:"'Plus Jakarta Sans',sans-serif"}}
              onFocus={e=>e.target.style.borderColor="#ea580c"} onBlur={e=>e.target.style.borderColor="#e5e7eb"}/>
            <select value={poTenantFilter} onChange={e=>setPOTenantFilter(e.target.value)}
              style={{border:"2px solid #e5e7eb",borderRadius:10,padding:"10px 12px",fontSize:13,color:"#374151",fontFamily:"'Plus Jakarta Sans',sans-serif",outline:"none"}}>
              <option value="all">Semua Tenant</option>
              {tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {/* Statistik */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            <div style={{background:"#fef3c7",border:"1px solid #fbbf24",borderRadius:12,padding:"10px",textAlign:"center"}}>
              <p style={{margin:0,color:"#92400e",fontSize:12,fontWeight:600}}>⏳ Belum Selesai</p>
              <p style={{margin:"4px 0 0",color:"#78350f",fontWeight:900,fontSize:20}}>{filteredPO.length}</p>
            </div>
            <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:12,padding:"10px",textAlign:"center"}}>
              <p style={{margin:0,color:"#14532d",fontSize:12,fontWeight:600}}>✅ Selesai</p>
              <p style={{margin:"4px 0 0",color:"#15803d",fontWeight:900,fontSize:20}}>{(orders||[]).filter(o=>o.status==="completed"&&(poTenantFilter==="all"||o.tenantId===poTenantFilter)).length}</p>
            </div>
          </div>

          {filteredPO.length===0?<EmptyState icon="📦" text="Tidak ada PO yang menunggu."/>:
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {filteredPO.map(order=>(
                <div key={order.id} style={{background:"#fff",border:"2px solid #fbbf24",borderRadius:16,padding:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:10}}>
                    <div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:4}}>
                        <span style={{background:"#fff7ed",color:"#ea580c",fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:20}}>🏪 {order.tenantName}</span>
                        <span style={{background:"#f0f9ff",color:"#0284c7",fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:20}}>📋 {order.nota}</span>
                      </div>
                      <p style={{margin:"0 0 2px",fontWeight:800,color:"#1c0a00",fontSize:15}}>{order.customerName}</p>
                      <p style={{margin:"0 0 2px",color:"#6b7280",fontSize:12}}>📱 {order.customerPhone} • {order.date} {order.time}</p>
                      <p style={{margin:0,color:"#9ca3af",fontSize:11}}>Dibuat: {order.createdBy}</p>
                    </div>
                    <p style={{margin:0,fontWeight:900,color:"#ea580c",fontSize:16}}>{idr(order.subtotal)}</p>
                  </div>
                  <div style={{background:"#f9fafb",borderRadius:10,padding:"10px 12px",marginBottom:10}}>
                    {order.items.map((it,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:13,borderBottom:i<order.items.length-1?"1px dashed #e5e7eb":"none"}}>
                        <span style={{color:"#374151",fontWeight:600}}>{it.menuName} <span style={{color:"#9ca3af"}}>×{it.qty}</span></span>
                        <span style={{fontWeight:700}}>{idr(it.qty*it.price)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{setVerifyOrderId(order.id);setShowVerifyScanner(true);startScan((sc)=>setVerifyScan(sc));}}
                      style={{flex:2,padding:"11px",background:order.paymentStatus==="unpaid"?"#dc2626":"#16a34a",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:6,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                      {order.paymentStatus==="unpaid"?"📷 Scan QR — Bayar & Selesaikan":"📷 Scan QR — Selesaikan"}
                    </button>
                    <button onClick={()=>resendPO(order)}
                      style={{flex:1,padding:"11px",background:"#f0f9ff",color:"#0284c7",border:"1px solid #bae6fd",borderRadius:10,fontWeight:600,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                      💬 Kirim Ulang
                    </button>
                  </div>
                  {/* Tombol Refund/Cancel — hanya Super Admin */}
                  {isSuperAdmin&&(
                    <div style={{marginTop:8}}>
                      {order.paymentStatus==="unpaid"?(
                        <button onClick={()=>setConfirmPOAction({type:"cancel",order})}
                          style={{width:"100%",padding:"9px",background:"#fef2f2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
                          onMouseOver={e=>e.currentTarget.style.background="#fee2e2"} onMouseOut={e=>e.currentTarget.style.background="#fef2f2"}>
                          ❌ Batalkan PO (Belum Bayar)
                        </button>
                      ):(
                        <button onClick={()=>setConfirmPOAction({type:"refund",order})}
                          style={{width:"100%",padding:"9px",background:"#fff7ed",color:"#ea580c",border:"1px solid #fed7aa",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
                          onMouseOver={e=>e.currentTarget.style.background="#fef3c7"} onMouseOut={e=>e.currentTarget.style.background="#fff7ed"}>
                          ↩️ Refund PO (Kembalikan Saldo)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>}

          {/* PO Selesai */}
          {(()=>{
            const done=(orders||[]).filter(o=>o.status==="completed"&&(poTenantFilter==="all"||o.tenantId===poTenantFilter)&&(!poSearch||o.customerName.toLowerCase().includes(poSearch.toLowerCase())||o.customerPhone.replace(/\D/g,"").includes(poSearch.replace(/\D/g,"")))).slice(0,10);
            return done.length>0?(
              <div style={{marginTop:16}}>
                <p style={{fontWeight:700,color:"#6b7280",fontSize:13,margin:"0 0 8px"}}>✅ PO Selesai</p>
                {done.map(o=>(
                  <div key={o.id} style={{background:"#f9fafb",border:"1px solid #dcfce7",borderRadius:14,padding:14,marginBottom:8,opacity:0.75}}>
                    <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8,alignItems:"center"}}>
                      <div>
                        <div style={{display:"flex",gap:6,marginBottom:4}}>
                          <span style={{background:"#f0fdf4",color:"#16a34a",fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:20,border:"1px solid #bbf7d0"}}>✅ Selesai</span>
                          <span style={{background:"#fff7ed",color:"#ea580c",fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:20}}>🏪 {o.tenantName}</span>
                          <span style={{background:"#f0f9ff",color:"#0284c7",fontSize:11,padding:"2px 8px",borderRadius:20}}>{o.nota}</span>
                        </div>
                        <p style={{margin:0,fontWeight:700,color:"#374151",fontSize:14}}>{o.customerName}</p>
                        <p style={{margin:"2px 0 0",color:"#9ca3af",fontSize:11}}>✅ {o.verifiedAt?new Date(o.verifiedAt).toLocaleString("id-ID"):"-"} oleh {o.verifiedBy}</p>
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <p style={{margin:0,fontWeight:800,color:"#16a34a",fontSize:14}}>{idr(o.subtotal)}</p>
                        <button onClick={()=>resendPO(o)} style={{padding:"6px 12px",background:"#f0f9ff",color:"#0284c7",border:"1px solid #bae6fd",borderRadius:8,fontWeight:600,cursor:"pointer",fontSize:12,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>💬 Kirim</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ):null;
          })()}
        </div>
      )}

      {/* ── Tab Laporan PO ── */}
      {subTab==="report"&&<POReport orders={orders||[]} tenants={tenants} customers={customers} settings={settings}/>}
    </div>
  );
}

// ─── PO Report ────────────────────────────────────────────────────────────────
function POReport({orders,tenants,customers,settings}){
  const [filterTenant,setFilterTenant]=useState("all");
  const [filterDate,setFilterDate]=useState(todayStr());
  // 4 tab: Selesai | Sudah Bayar (belum ambil) | Belum Bayar | Batal/Refund
  const [reportTab,setReportTab]=useState("completed");
  const bname=settings?.bazaarName||"BazaarPOS";
  const esc=s=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const byDate=orders.filter(o=>{
    const tenantOk=filterTenant==="all"||o.tenantId===filterTenant;
    return tenantOk&&o.date===filterDate;
  });

  // Sudah Bayar = pending + paymentStatus paid → saldo sudah terpotong, pesanan belum diambil
  // Belum Bayar = pending + paymentStatus unpaid → dipesan, bayar nanti saat pengambilan
  const completedOrders =byDate.filter(o=>o.status==="completed");
  const paidPendingOrders=byDate.filter(o=>o.status==="pending"&&o.paymentStatus==="paid");
  const unpaidOrders    =byDate.filter(o=>o.status==="pending"&&(o.paymentStatus==="unpaid"||!o.paymentStatus));
  const cancelledOrders =byDate.filter(o=>o.status==="cancelled");

  const dispOrders=[...(
    reportTab==="completed"    ?completedOrders:
    reportTab==="paid_pending" ?paidPendingOrders:
    reportTab==="unpaid"       ?unpaidOrders:
    cancelledOrders
  )].sort((a,b)=>{const ta=a.timestamp?new Date(a.timestamp).getTime():0;const tb=b.timestamp?new Date(b.timestamp).getTime():0;return tb-ta;});
  const dispTotal=dispOrders.reduce((s,o)=>s+o.subtotal,0);

  // Label status yang jelas untuk tiap kondisi
  const getStatusLabel=(o)=>{
    if(o.status==="completed")   return "✅ Selesai & Diambil";
    if(o.status==="pending"){
      if(o.paymentStatus==="paid")   return "💰 Sudah Bayar — Belum Diambil";
      return "⏳ Belum Bayar — Bayar Saat Ambil";
    }
    if(o.status==="cancelled") return o.cancelReason==="refund"?"↩️ REFUND — Saldo Dikembalikan":"❌ DIBATALKAN — Saldo Tidak Dipotong";
    return o.status;
  };
  const getKeterangan=(o)=>{
    if(o.status==="completed")   return "Saldo sudah terpotong, pesanan sudah diambil";
    if(o.status==="pending"&&o.paymentStatus==="paid") return "Saldo sudah terpotong, pesanan BELUM diambil";
    if(o.status==="pending")     return "PO tercatat, saldo BELUM dipotong — bayar saat pengambilan";
    if(o.cancelReason==="refund") return "PO direfund, saldo dikembalikan ke pelanggan";
    return "PO dibatalkan, saldo tidak dipotong";
  };

  // ── Excel export ──────────────────────────────────────────────────────────────
  const exportPOHtml=(rows,title,filename,thBg)=>{
    const thStyle=`style="background:${thBg};color:#fff;padding:6px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;font-weight:bold;"`;
    const td ='style="padding:5px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;"';
    const tdG='style="padding:5px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;color:#16a34a;font-weight:bold;"';
    const tdR='style="padding:5px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;color:#dc2626;font-weight:bold;"';
    const tdB='style="padding:5px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;color:#0284c7;font-weight:bold;"';
    const headers=["No","Nota","Tenant","Pelanggan","No. HP","Item","Total (Rp)","Status","Keterangan","Tgl Order","Waktu","Oleh"];
    const tblRows=rows.map((o,i)=>{
      const items=(o.items||[]).map(it=>`${it.menuName} x${it.qty}`).join(", ");
      const statusLabel=getStatusLabel(o);
      const keterangan=getKeterangan(o);
      const isRefund=o.cancelReason==="refund";
      const isCancelled=o.status==="cancelled"&&!isRefund;
      const isPaidPending=o.status==="pending"&&o.paymentStatus==="paid";
      const isUnpaid=o.status==="pending"&&(o.paymentStatus==="unpaid"||!o.paymentStatus);
      const stTd=isRefund?tdR:isCancelled?tdR:isPaidPending?tdG:isUnpaid?tdB:tdG;
      const oleh=o.status==="completed"?(o.verifiedBy||"-"):((o.cancelledBy||o.createdBy)||"-");
      return`<tr style="${isCancelled||isRefund?"background:#fff8f8;":""}">
        <td ${td}>${i+1}</td><td ${td}><strong>${esc(o.nota)}</strong></td>
        <td ${td}>${esc(o.tenantName)}</td><td ${td}>${esc(o.customerName)}</td>
        <td ${td}>${esc(o.customerPhone)}</td><td ${td}>${esc(items)}</td>
        <td ${td}>${o.subtotal||0}</td>
        <td ${stTd}>${esc(statusLabel)}</td>
        <td ${td}>${esc(keterangan)}</td>
        <td ${td}>${esc(o.date)}</td><td ${td}>${esc(o.time)}</td>
        <td ${td}>${esc(oleh)}</td>
      </tr>`;
    }).join("");
    const total=rows.reduce((s,o)=>s+o.subtotal,0);
    const sumRow=`<tr><td colspan="6" style="padding:6px 10px;border:1px solid #ccc;font-family:Arial;font-weight:bold;background:#f9fafb;">TOTAL (${rows.length} PO)</td><td style="padding:6px 10px;border:1px solid #ccc;font-family:Arial;font-weight:bold;background:#f9fafb;">${total.toLocaleString("id-ID")}</td><td colspan="5" style="background:#f9fafb;border:1px solid #ccc;"></td></tr>`;
    const tbl=`<table><tr>${headers.map(h=>`<th ${thStyle}>${esc(h)}</th>`).join("")}</tr>${tblRows}${sumRow}</table>`;
    const subtitle=`Tanggal: ${filterDate}${filterTenant!=="all"?" | Tenant: "+(tenants.find(t=>t.id===filterTenant)?.name||""):""} | Dicetak: ${new Date().toLocaleString("id-ID")}`;
    const html=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/></head><body><h2 style="font-family:Arial">${esc(title)}</h2><p style="font-family:Arial;color:#6b7280">${esc(subtitle)}</p>${tbl}</body></html>`;
    const blob=new Blob(["\uFEFF"+html],{type:"application/vnd.ms-excel;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=filename;a.click();
    URL.revokeObjectURL(url);
  };

  // ── Print A4 ──────────────────────────────────────────────────────────────────
  const doPrint=(rows,title)=>{
    const tableRows=rows.map((o,i)=>{
      const items=(o.items||[]).map(it=>`[${it.menuCode||""}] ${it.menuName} ×${it.qty} = ${idr(it.qty*it.price)}`).join("<br/>");
      const statusLabel=getStatusLabel(o);
      const isRefund=o.cancelReason==="refund";
      const isCancelled=o.status==="cancelled"&&!isRefund;
      const isPaidPending=o.status==="pending"&&o.paymentStatus==="paid";
      const isUnpaid=o.status==="pending"&&(o.paymentStatus==="unpaid"||!o.paymentStatus);
      const statusColor=isCancelled?"#dc2626":isRefund?"#92400e":isPaidPending?"#16a34a":isUnpaid?"#0284c7":"#16a34a";
      const oleh=o.status==="completed"?(o.verifiedBy||"-"):((o.cancelledBy||o.createdBy)||"-");
      const waktuAksi=o.status==="completed"
        ?(o.verifiedAt?new Date(o.verifiedAt).toLocaleString("id-ID",{hour:"2-digit",minute:"2-digit"}):o.time)
        :o.status==="cancelled"
        ?(o.cancelledAt?new Date(o.cancelledAt).toLocaleString("id-ID",{hour:"2-digit",minute:"2-digit"}):"-")
        :o.time;
      return`<tr style="${isCancelled||isRefund?"background:#fff8f8":""}">
        <td>${i+1}</td><td><strong>${o.nota}</strong></td>
        <td><strong>${o.tenantCode||""}</strong><br/><span style="font-size:10px;color:#6b7280">${o.tenantName}</span></td>
        <td>${o.customerName}<br/><span style="font-size:10px;color:#9ca3af">${o.customerPhone}</span></td>
        <td style="font-size:10px">${items}</td>
        <td style="text-align:right;font-weight:700">${idr(o.subtotal)}</td>
        <td style="color:${statusColor};font-weight:700;font-size:10px">${statusLabel}</td>
        <td style="font-size:10px">${waktuAksi}<br/><span style="color:#6b7280">${oleh}</span></td>
      </tr>`;
    }).join("");
    const summary=`<div class="sr">
      <div class="sb"><p class="lbl">Jumlah PO</p><p class="val">${rows.length}</p></div>
      <div class="sb em"><p class="lbl">Total Nilai</p><p class="val">${idr(rows.reduce((s,o)=>s+o.subtotal,0))}</p></div>
      <div class="sb"><p class="lbl">✅ Selesai</p><p class="val" style="color:#16a34a">${completedOrders.length}</p></div>
      <div class="sb"><p class="lbl">⏳ Belum Ambil</p><p class="val" style="color:#ea580c">${paidPendingOrders.length+unpaidOrders.length}</p></div>
    </div>`;
    printA4({
      title,
      subtitle:`Tanggal: ${filterDate}${filterTenant!=="all"?" | Tenant: "+(tenants.find(t=>t.id===filterTenant)?.name||""):""} | Dicetak: ${new Date().toLocaleString("id-ID")}`,
      bazaarName:bname,
      bodyHtml:`${summary}<div class="sec">Daftar PO</div>
      <table>
        <thead><tr><th>#</th><th>Nota</th><th>Tenant</th><th>Pelanggan</th><th>Item</th><th style="text-align:right">Total</th><th>Status</th><th>Waktu & Oleh</th></tr></thead>
        <tbody>${tableRows}</tbody>
        <tfoot><tr><td colspan="5"><strong>TOTAL</strong></td><td style="text-align:right"><strong>${idr(rows.reduce((s,o)=>s+o.subtotal,0))}</strong></td><td colspan="2"></td></tr></tfoot>
      </table>`
    });
  };

  const tabCfg={
    completed:    {color:"#16a34a",bg:"#f0fdf4",bc:"#bbf7d0",icon:"✅",label:"PO Selesai",    count:completedOrders.length,    thBg:"#16a34a"},
    paid_pending: {color:"#0284c7",bg:"#eff6ff",bc:"#bae6fd",icon:"💰",label:"Sudah Bayar",   count:paidPendingOrders.length,  thBg:"#0284c7"},
    unpaid:       {color:"#ea580c",bg:"#fff7ed",bc:"#fed7aa",icon:"⏳",label:"Belum Bayar",   count:unpaidOrders.length,       thBg:"#ea580c"},
    cancelled:    {color:"#dc2626",bg:"#fef2f2",bc:"#fca5a5",icon:"❌",label:"Batal/Refund",  count:cancelledOrders.length,    thBg:"#dc2626"},
  };
  const curTab=tabCfg[reportTab];

  return(
    <div>
      {/* ── Header & Filter ── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,flexWrap:"wrap",gap:12}}>
        <h3 style={{margin:0,fontSize:16,fontWeight:800,color:"#1c0a00"}}>📊 Laporan Pre-Order</h3>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <DP value={filterDate} onChange={setFilterDate}/>
          <select value={filterTenant} onChange={e=>setFilterTenant(e.target.value)}
            style={{border:"2px solid #e5e7eb",borderRadius:10,padding:"9px 12px",fontSize:13,color:"#374151",fontFamily:"'Plus Jakarta Sans',sans-serif",outline:"none"}}>
            <option value="all">Semua Tenant</option>
            {tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {/* ── Ringkasan 4 kotak — klik untuk pindah tab ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:8,marginBottom:16}}>
        {Object.entries(tabCfg).map(([k,s])=>(
          <div key={k} onClick={()=>setReportTab(k)}
            style={{background:reportTab===k?s.bg:"#fff",border:`2px solid ${reportTab===k?s.color:"#e5e7eb"}`,borderRadius:12,padding:"10px 8px",textAlign:"center",minWidth:0,cursor:"pointer",transition:"all .2s"}}>
            <p style={{margin:0,color:"#6b7280",fontSize:10,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.icon} {s.label}</p>
            <p style={{margin:"4px 0 0",color:reportTab===k?s.color:"#374151",fontWeight:900,fontSize:15}}>{s.count}</p>
          </div>
        ))}
      </div>

      {/* ── Tab Bar ── */}
      <div style={{display:"flex",gap:3,marginBottom:14,background:"#f9fafb",borderRadius:12,padding:4}}>
        {Object.entries(tabCfg).map(([k,s])=>(
          <button key={k} onClick={()=>setReportTab(k)}
            style={{flex:1,padding:"8px 4px",background:reportTab===k?"#fff":"transparent",border:"none",borderRadius:9,
              fontWeight:reportTab===k?700:500,color:reportTab===k?s.color:"#6b7280",
              cursor:"pointer",fontSize:10.5,boxShadow:reportTab===k?"0 2px 6px rgba(0,0,0,.08)":"none",
              transition:"all .2s",fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
            {s.icon} {s.label}<br/><span style={{fontSize:11,fontWeight:900}}>({s.count})</span>
          </button>
        ))}
      </div>

      {/* ── Keterangan status tab aktif ── */}
      <div style={{background:curTab.bg,border:`1px solid ${curTab.bc}`,borderRadius:10,padding:"8px 14px",marginBottom:14,fontSize:12,color:curTab.color,fontWeight:600}}>
        {reportTab==="completed"   &&"✅ PO selesai — saldo sudah terpotong, pesanan sudah diambil dan dikonfirmasi."}
        {reportTab==="paid_pending"&&"💰 PO sudah dibayar — saldo sudah terpotong, pesanan BELUM diambil."}
        {reportTab==="unpaid"      &&"⏳ PO belum bayar — dipesan & dicatat, saldo BELUM dipotong, bayar saat pengambilan."}
        {reportTab==="cancelled"   &&"❌ PO dibatalkan atau direfund admin. Lihat kolom Status untuk detailnya."}
      </div>

      {/* ── Tombol Export ── */}
      {dispOrders.length>0&&(
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
          <button onClick={()=>exportPOHtml(dispOrders,
            `Laporan PO ${curTab.label} — ${filterDate}`,
            `PO_${curTab.label.replace(/\//g,"-").replace(/\s+/g,"_")}_${filterDate}.xls`,
            curTab.thBg)}
            style={{padding:"8px 14px",background:curTab.color,color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif",display:"flex",alignItems:"center",gap:6}}
            onMouseOver={e=>e.currentTarget.style.opacity=".85"} onMouseOut={e=>e.currentTarget.style.opacity="1"}>
            📥 Excel — {curTab.label}
          </button>
          <button onClick={()=>doPrint(dispOrders,`Laporan PO ${curTab.label}`)}
            style={{padding:"8px 14px",background:"#1c0a00",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif",display:"flex",alignItems:"center",gap:6}}
            onMouseOver={e=>e.currentTarget.style.background="#431407"} onMouseOut={e=>e.currentTarget.style.background="#1c0a00"}>
            🖨️ Print A4 — {curTab.label}
          </button>
        </div>
      )}

      {/* ── Daftar PO ── */}
      {dispOrders.length===0
        ?<EmptyState icon={curTab.icon} text={`Tidak ada PO "${curTab.label}" pada tanggal ini.`}/>
        :<div style={{display:"flex",flexDirection:"column",gap:8}}>
          {dispOrders.map(order=>{
            const isRefund=order.cancelReason==="refund";
            const isCancelled=order.status==="cancelled"&&!isRefund;
            const isPaidPending=order.status==="pending"&&order.paymentStatus==="paid";
            const isUnpaid=order.status==="pending"&&(order.paymentStatus==="unpaid"||!order.paymentStatus);
            const borderColor=isCancelled?"#fca5a5":isRefund?"#fbbf24":isPaidPending?"#fed7aa":isUnpaid?"#bae6fd":"#bbf7d0";
            const badgeBg=isCancelled?"#fef2f2":isRefund?"#fef3c7":isPaidPending?"#fff7ed":isUnpaid?"#eff6ff":"#f0fdf4";
            const badgeColor=isCancelled?"#dc2626":isRefund?"#92400e":isPaidPending?"#ea580c":isUnpaid?"#0284c7":"#16a34a";
            return(
              <div key={order.id} style={{background:isCancelled?"#fff8f8":"#fff",border:`1px solid ${borderColor}`,borderRadius:14,padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:6}}>
                  <div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:4,alignItems:"center"}}>
                      <span style={{background:badgeBg,color:badgeColor,fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:20,border:`1px solid ${borderColor}`}}>
                        {getStatusLabel(order)}
                      </span>
                      <span style={{background:"#fff7ed",color:"#ea580c",fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:20}}>🏪 {order.tenantName}</span>
                      <span style={{background:"#f0f9ff",color:"#0284c7",fontSize:11,padding:"2px 8px",borderRadius:20}}>{order.nota}</span>
                    </div>
                    <p style={{margin:"0 0 2px",fontWeight:700,color:"#1c0a00",fontSize:14}}>{order.customerName}</p>
                    <p style={{margin:0,color:"#6b7280",fontSize:12}}>📱 {order.customerPhone} • {order.date} {order.time}</p>
                    {isCancelled&&order.cancelledBy&&<p style={{margin:"2px 0 0",color:"#9ca3af",fontSize:11}}>Dibatalkan oleh: {order.cancelledBy}</p>}
                    {isRefund&&order.cancelledBy&&<p style={{margin:"2px 0 0",color:"#92400e",fontSize:11}}>Direfund oleh: {order.cancelledBy}</p>}
                    {order.status==="completed"&&order.verifiedBy&&<p style={{margin:"2px 0 0",color:"#16a34a",fontSize:11}}>✅ Dikonfirmasi: {order.verifiedBy}</p>}
                    {(isPaidPending||isUnpaid)&&order.createdBy&&<p style={{margin:"2px 0 0",color:"#6b7280",fontSize:11}}>Dibuat oleh: {order.createdBy}</p>}
                  </div>
                  <p style={{margin:0,fontWeight:900,fontSize:16,color:badgeColor}}>{idr(order.subtotal)}</p>
                </div>
                <div style={{fontSize:12,color:"#6b7280",display:"flex",flexWrap:"wrap",gap:6}}>
                  {(order.items||[]).map((it,i)=><span key={i} style={{background:"#f9fafb",padding:"2px 8px",borderRadius:8}}>{it.menuName} ×{it.qty}</span>)}
                </div>
              </div>
            );
          })}
          <div style={{background:curTab.bg,borderRadius:12,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontWeight:700,color:"#374151"}}>TOTAL {dispOrders.length} PO {curTab.label.toUpperCase()}</span>
            <span style={{fontWeight:900,color:curTab.color,fontSize:18}}>{idr(dispTotal)}</span>
          </div>
        </div>}
    </div>
  );
}

function POTenant({tenant,orders,customers,onSaveOrders,onSaveCustomers,onUpdateCustomerBalance,onCheckConnection,settings,menus,kasirName=""}){
  const [poSearch,setPOSearch]=useState("");
  const [showScanner,setShowScanner]=useState(false);
  const [verifyOrderId,setVerifyOrderId]=useState(null);
  const [verifyScan,setVerifyScan]=useState("");
  const [verifyError,setVerifyError]=useState("");
  const [verifyPin,setVerifyPin]=useState("");
  const [verifyPinError,setVerifyPinError]=useState("");
  const [netToast,setNetToast]=useState(""); // network toast
  const [successMsg,setSuccessMsg]=useState("");
  const videoRef=useRef(null);
  const scanRef=useRef(null);

  const myOrders=(orders||[]).filter(o=>o.tenantId===tenant.id);
  const pendingOrders=[...myOrders.filter(o=>o.status==="pending"&&(!poSearch||o.customerName.toLowerCase().includes(poSearch.toLowerCase())||o.customerPhone.replace(/\D/g,"").includes(poSearch.replace(/\D/g,""))||o.nota.toLowerCase().includes(poSearch.toLowerCase())))].sort((a,b)=>{const ta=a.timestamp?new Date(a.timestamp).getTime():0;const tb=b.timestamp?new Date(b.timestamp).getTime():0;return tb-ta;});
  const completedOrders=[...myOrders.filter(o=>o.status==="completed"&&(!poSearch||o.customerName.toLowerCase().includes(poSearch.toLowerCase())))].sort((a,b)=>{const ta=a.verifiedAt?new Date(a.verifiedAt).getTime():a.timestamp?new Date(a.timestamp).getTime():0;const tb=b.verifiedAt?new Date(b.verifiedAt).getTime():b.timestamp?new Date(b.timestamp).getTime():0;return tb-ta;}).slice(0,8);

  const startVerify=async(orderId)=>{
    window.scrollTo({top:0,behavior:"instant"});
    setVerifyOrderId(orderId);setVerifyScan("");setVerifyError("");setShowScanner(true);
    if(!window.jsQR){await new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";s.onload=res;s.onerror=rej;document.head.appendChild(s);});}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
      if(videoRef.current){videoRef.current.srcObject=stream;videoRef.current.play();
        scanRef.current=setInterval(()=>{
          if(!videoRef.current||!window.jsQR)return;
          const c=document.createElement("canvas");c.width=videoRef.current.videoWidth;c.height=videoRef.current.videoHeight;
          const ctx=c.getContext("2d");ctx.drawImage(videoRef.current,0,0);
          const code=window.jsQR(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);
          if(code&&code.data){setVerifyScan(code.data.trim());clearInterval(scanRef.current);if(videoRef.current?.srcObject){videoRef.current.srcObject.getTracks().forEach(t=>t.stop());videoRef.current.srcObject=null;}}
        },500);
      }
    }catch(e){setVerifyError("Gagal akses kamera: "+e.message);}
  };
  const closeScanner=()=>{clearInterval(scanRef.current);if(videoRef.current?.srcObject){videoRef.current.srcObject.getTracks().forEach(t=>t.stop());videoRef.current.srcObject=null;}setShowScanner(false);setVerifyOrderId(null);setVerifyScan("");setVerifyError("");setVerifyPin("");setVerifyPinError("");};

  const doVerify=async()=>{
    const order=(orders||[]).find(o=>o.id===verifyOrderId);
    if(!order){setVerifyError("PO tidak ditemukan!");return;}
    const sc=verifyScan.trim();
    const cust=customers.find(c=>c.id===sc)||customers.find(c=>c.phone===sc.replace(/\D/g,""));
    if(!cust||cust.id!==order.customerId){setVerifyError("❌ QR tidak cocok dengan pelanggan PO ini!");return;}
    if(cust.pin&&verifyPin!==cust.pin){setVerifyPinError("❌ PIN salah! Coba lagi.");setVerifyPin("");return;}

    // ── Cek koneksi server DULU. Kalau gagal, tolak cepat & data PO tetap utuh ──
    const online=onCheckConnection?await onCheckConnection():true;
    if(!online){
      setNetToast("Verifikasi Gagal, Jaringan Kurang Baik. Silahkan coba lagi setelah jaringan baik.");
      return;
    }

    const isUnpaid=order.paymentStatus==="unpaid";
    let balAfter=null;

    // ── Potong saldo DULU secara ATOMIK jika belum lunas ──
    if(isUnpaid&&typeof onUpdateCustomerBalance==="function"){
      try{
        const result=await onUpdateCustomerBalance(
          cust.id,
          -order.subtotal,
          (balBefore,bAfter)=>({id:uid(),customerId:cust.id,customerPhone:cust.phone,customerName:cust.name,
            type:"payment",amount:order.subtotal,balanceBefore:balBefore,balanceAfter:bAfter,
            nota:order.nota,tenantId:order.tenantId,tenantName:order.tenantName,
            items:order.items,timestamp:new Date().toISOString(),date:todayStr(),time:timeStr()})
        );
        balAfter=result.balance;
      }catch(e){
        console.error("Verifikasi PO gagal potong saldo:",e);
        setVerifyError(`❌ GAGAL! ${e.message}`);
        return; // STOP — saldo belum terpotong
      }
    }

    // ── Baru tandai order selesai ──
    try{
      await onSaveOrders((orders||[]).map(o=>o.id===verifyOrderId?{...o,status:"completed",paymentStatus:"paid",verifiedAt:new Date().toISOString(),verifiedBy:kasirName?`${tenant.name} — ${kasirName}`:tenant.name}:o));
    }catch(e){
      console.error("Order PO gagal disimpan SETELAH saldo terpotong:",e);
      setVerifyError(`⚠️ Saldo SUDAH terpotong tapi status PO gagal diupdate! Laporkan ke Super Admin. (${e.message})`);
      return;
    }

    // ── Database sudah confirmed tersimpan, baru kirim WA ──
    if(isUnpaid){
      const _itemsTxt=order.items.map(it=>`  ${it.menuName} x${it.qty} = ${idr(it.qty*it.price)}`).join("\n");
      const waMsg=`*${settings?.bazaarName||"BazaarPOS"}*\n\n✅ Pembayaran & Pengambilan PO\nNota: ${order.nota}\nTenant: ${order.tenantName}\n---------------------------\n${_itemsTxt}\n---------------------------\nDibayar: ${idr(order.subtotal)}\nSisa Saldo: ${idr(balAfter)}\n\nTerima kasih!\n${waSignature(tenant.name)}`;
      const _ok=settings?.fonnteToken?await sendWhatsApp({token:settings.fonnteToken,phone:cust.phone,message:waMsg}):false;
      if(!_ok){const _p=cust.phone.replace(/\D/g,"");const _t=_p.startsWith("0")?"62"+_p.slice(1):_p;window.open(`https://wa.me/${_t}?text=${encodeURIComponent(waMsg)}`,"_blank");}
    } else {
      const _itemsTxt2=order.items.map(it=>`  ${it.menuName} x${it.qty} = ${idr(it.qty*it.price)}`).join("\n");
      const waMsg=`*${settings?.bazaarName||"BazaarPOS"}*\n\n✅ Pengambilan PO Dikonfirmasi\nNota: ${order.nota}\nTenant: ${order.tenantName}\n---------------------------\n${_itemsTxt2}\n---------------------------\nTotal: ${idr(order.subtotal)}\n\nTerima kasih!\n${waSignature(tenant.name)}`;
      const _ok=settings?.fonnteToken?await sendWhatsApp({token:settings.fonnteToken,phone:cust.phone,message:waMsg}):false;
      if(!_ok){const _p=cust.phone.replace(/\D/g,"");const _t=_p.startsWith("0")?"62"+_p.slice(1):_p;window.open(`https://wa.me/${_t}?text=${encodeURIComponent(waMsg)}`,"_blank");}
    }
    closeScanner();
    setSuccessMsg(`✅ PO ${order.nota} — ${isUnpaid?"Dibayar & ":""}Selesai & Tersimpan!`);
    setTimeout(()=>setSuccessMsg(""),4000);
  };

  return(
    <div>
      {showScanner&&(
        <Modal title="📷 Scan QR Verifikasi Pengambilan" onClose={closeScanner}>
          {(()=>{const o=(orders||[]).find(x=>x.id===verifyOrderId);return(
            <p style={{color:"#6b7280",fontSize:13,margin:"0 0 10px"}}>
              {o&&o.paymentStatus==="unpaid"
                ?"Scan QR Pelanggan untuk Pemotongan Saldo sesuai PO & konfirmasi pengambilan PO."
                :"Scan QR Pelanggan untuk konfirmasi pengambilan PO."}
            </p>
          );})()}
          {(()=>{const o=(orders||[]).find(x=>x.id===verifyOrderId);return o&&<div style={{background:"#f0f9ff",borderRadius:10,padding:"8px 12px",marginBottom:10}}><p style={{margin:0,fontSize:13,color:"#0284c7",fontWeight:600}}>📋 {o.nota} — {o.customerName}</p></div>;})()} 
          {!verifyScan&&(
            <div style={{position:"relative",borderRadius:14,overflow:"hidden",background:"#000",marginBottom:12,height:220}}>
              <video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover"}} playsInline muted/>
              <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
                <div style={{width:160,height:160,border:"3px solid #16a34a",borderRadius:12,boxShadow:"0 0 0 2000px rgba(0,0,0,.4)"}}/>
              </div>
            </div>
          )}
          {verifyError&&<div style={{background:"#fef2f2",borderRadius:10,padding:"8px 12px",color:"#dc2626",fontWeight:600,fontSize:13,marginBottom:10}}>❌ {verifyError}</div>}
          {verifyScan&&(()=>{
            const ord=(orders||[]).find(o=>o.id===verifyOrderId);
            const cust=ord&&customers.find(c=>c.id===ord.customerId);
            const ok=cust&&(verifyScan===cust.id||verifyScan.replace(/\D/g,"")===cust.phone);
            return(
              <div>
                <div style={{background:ok?"#f0fdf4":"#fef2f2",borderRadius:12,padding:"12px",marginBottom:10}}>
                  <p style={{margin:"0 0 2px",fontWeight:800,color:ok?"#14532d":"#dc2626"}}>{ok?"✅ QR Cocok!":"❌ QR Tidak Cocok"}</p>
                  {cust&&<p style={{margin:0,color:"#6b7280",fontSize:13}}>{cust.name}</p>}
                </div>
                {ok&&cust.pin&&(
                  <div style={{marginBottom:10}}>
                    <p style={{textAlign:"center",fontWeight:700,color:"#374151",fontSize:13,margin:"0 0 8px"}}>🔐 Masukkan PIN Pelanggan</p>
                    <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:6}}>
                      {[0,1,2,3].map(i=><div key={i} style={{width:46,height:56,background:verifyPin.length>i?"#4c1d95":"#f9fafb",border:`2px solid ${verifyPin.length>i?"#7c3aed":"#e5e7eb"}`,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:"#fff"}}>{verifyPin.length>i?"●":""}</div>)}
                    </div>
                    {verifyPinError&&<p style={{textAlign:"center",color:"#dc2626",fontSize:12,fontWeight:600,margin:"2px 0 6px"}}>{verifyPinError}</p>}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,maxWidth:200,margin:"0 auto"}}>
                      {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k,i)=>(
                        <button key={i} onClick={()=>{if(k==="")return;if(k==="⌫"){setVerifyPin(p=>p.slice(0,-1));setVerifyPinError("");}else if(verifyPin.length<4){setVerifyPin(p=>p+k);setVerifyPinError("");}}}
                          style={{padding:"12px 0",background:k==="⌫"?"#fef2f2":k===""?"transparent":"#f9fafb",color:k==="⌫"?"#dc2626":"#1c0a00",border:`1px solid ${k==="⌫"?"#fca5a5":k===""?"transparent":"#e5e7eb"}`,borderRadius:10,fontSize:18,fontWeight:700,cursor:k===""?"default":"pointer",fontFamily:"'Plus Jakarta Sans',sans-serif",visibility:k===""?"hidden":"visible"}}>
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <div style={{display:"flex",gap:10}}>
            <button onClick={closeScanner} style={{...btnSec,flex:1}}>Batal</button>
            {verifyScan&&(()=>{
              const ord=(orders||[]).find(o=>o.id===verifyOrderId);
              const cust=ord&&customers.find(c=>c.id===ord.customerId);
              const qrOk=cust&&(verifyScan===cust.id||verifyScan.replace(/\D/g,"")===cust.phone);
              const pinOk=!cust?.pin||verifyPin.length===4;
              return qrOk&&pinOk;
            })()?
              <button onClick={doVerify} style={{flex:2,padding:"13px",background:"#16a34a",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>✅ Selesaikan PO</button>:null}
          </div>
        </Modal>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div>
          <h2 style={{margin:0,fontSize:18,fontWeight:800,color:"#14532d"}}>📦 Pre-Order — {tenant.name}</h2>
          <p style={{color:"#9ca3af",margin:"4px 0 0",fontSize:13}}>{myOrders.filter(o=>o.status==="pending").length} menunggu pengambilan</p>
        </div>
      </div>

      {/* Monitor Kuota PO per Menu */}
      {(()=>{
        const limitedMenus=(orders&&menus||[]).filter(m=>m.tenantId===tenant.id&&m.poLimit);
        if(!limitedMenus.length) return null;
        return(
          <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:14,padding:"14px 16px",marginBottom:14}}>
            <p style={{margin:"0 0 10px",fontWeight:700,color:"#374151",fontSize:14}}>📊 Monitor Kuota PO</p>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {limitedMenus.map(m=>{
                const used=getPOUsed(m.id,orders);
                const remaining=Math.max(0,m.poLimit-used);
                const pct=m.poLimit>0?(used/m.poLimit)*100:0;
                const color=remaining===0?"#dc2626":pct>=80?"#f97316":"#16a34a";
                return(
                  <div key={m.id}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <span style={{fontSize:13,fontWeight:600,color:"#374151"}}>{m.name}</span>
                      <span style={{fontSize:13,fontWeight:700,color}}>
                        {remaining===0?"❌ Habis":`${remaining} / ${m.poLimit} sisa`}
                      </span>
                    </div>
                    <div style={{background:"#f3f4f6",borderRadius:20,height:8,overflow:"hidden"}}>
                      <div style={{width:`${Math.min(pct,100)}%`,height:"100%",background:color,borderRadius:20,transition:"width .3s"}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      <NetToast msg={netToast} onClose={()=>setNetToast("")}/>
      {successMsg&&<div className="pop-in" style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:12,padding:"10px 16px",marginBottom:12,fontWeight:600,fontSize:13,color:"#16a34a"}}>{successMsg}</div>}

      <div style={{position:"relative",marginBottom:14}}>
        <input placeholder="🔍 Cari nama atau nomor HP pelanggan..."
          value={poSearch} onChange={e=>setPOSearch(e.target.value)}
          style={{width:"100%",border:"2px solid #e5e7eb",borderRadius:10,padding:"10px 14px",fontSize:14,outline:"none",color:"#111",boxSizing:"border-box",fontFamily:"'Plus Jakarta Sans',sans-serif"}}
          onFocus={e=>e.target.style.borderColor="#16a34a"} onBlur={e=>e.target.style.borderColor="#e5e7eb"}/>
        {poSearch&&<button onClick={()=>setPOSearch("")} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:18}}>✕</button>}
      </div>

      {pendingOrders.length===0&&completedOrders.length===0&&!poSearch?<EmptyState icon="📦" text="Tidak ada PO untuk tenant ini."/>:
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {pendingOrders.length===0&&poSearch&&<EmptyState icon="🔍" text="Tidak ada PO belum selesai yang cocok dengan pencarian."/>}
          {pendingOrders.map(order=>(
            <div key={order.id} style={{background:"#fff",border:"2px solid #fbbf24",borderRadius:16,padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:10}}>
                <div>
                  <div style={{display:"flex",gap:6,marginBottom:4}}>
                  </div>
                  <p style={{margin:"0 0 2px",fontWeight:800,color:"#1c0a00",fontSize:15}}>{order.customerName}</p>
                  <p style={{margin:0,color:"#6b7280",fontSize:12}}>📱 {order.customerPhone} • {order.date}</p>
                </div>
                <p style={{margin:0,fontWeight:900,color:"#ea580c",fontSize:16}}>{idr(order.subtotal)}</p>
              </div>
              <div style={{background:"#f9fafb",borderRadius:10,padding:"10px 12px",marginBottom:10}}>
                {order.items.map((it,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:13,borderBottom:i<order.items.length-1?"1px dashed #e5e7eb":"none"}}>
                    <span style={{color:"#374151",fontWeight:600}}>{it.menuName} <span style={{color:"#9ca3af"}}>×{it.qty}</span></span>
                    <span style={{fontWeight:700}}>{idr(it.qty*it.price)}</span>
                  </div>
                ))}
              </div>
              <button onClick={()=>startVerify(order.id)}
                style={{width:"100%",padding:"12px",background:order.paymentStatus==="unpaid"?"#dc2626":"#16a34a",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
                onMouseOver={e=>e.currentTarget.style.background=order.paymentStatus==="unpaid"?"#b91c1c":"#15803d"} onMouseOut={e=>e.currentTarget.style.background=order.paymentStatus==="unpaid"?"#dc2626":"#16a34a"}>
                {order.paymentStatus==="unpaid"?"📷 Scan QR — Bayar & Ambil":"📷 Scan QR — Konfirmasi Pengambilan"}
              </button>
            </div>
          ))}

          {completedOrders.length>0&&(
            <div style={{marginTop:8}}>
              <p style={{fontWeight:700,color:"#6b7280",fontSize:13,margin:"0 0 8px"}}>✅ Sudah Diambil</p>
              {completedOrders.map(o=>(
                <div key={o.id} style={{background:"#f9fafb",border:"1px solid #dcfce7",borderRadius:14,padding:14,marginBottom:8,opacity:0.7}}>
                  <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                    <div>
                      <div style={{display:"flex",gap:6,marginBottom:4}}>
                        <span style={{background:"#f0fdf4",color:"#16a34a",fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:20,border:"1px solid #bbf7d0"}}>✅ Selesai</span>
                        <span style={{background:"#f0f9ff",color:"#0284c7",fontSize:11,padding:"2px 8px",borderRadius:20}}>{o.nota}</span>
                      </div>
                      <p style={{margin:0,fontWeight:700,color:"#374151",fontSize:14}}>{o.customerName}</p>
                      <p style={{margin:"2px 0 0",color:"#9ca3af",fontSize:11}}>{o.verifiedAt?new Date(o.verifiedAt).toLocaleString("id-ID"):"-"}</p>
                    </div>
                    <p style={{margin:0,fontWeight:800,color:"#16a34a",fontSize:14}}>{idr(o.subtotal)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>}
    </div>
  );
}

// ─── Admin Transactions ───────────────────────────────────────────────────────
function AdminTransactions({tenants,transactions,settings,customers,walletLogs,onSaveTx,onSaveCustomers,onSaveWalletLogs,onUpdateCustomerBalance,onCheckConnection,filterDate,setFilterDate,isSuperAdmin,adminData}){
  const getTn=id=>tenants.find(t=>t.id===id)||{};
  const [searchNota,setSearchNota]=useState("");
  const [netToast,setNetToast]=useState(""); // network toast
  const [refunding,setRefunding]=useState(null);
  const [refundMsg,setRefundMsg]=useState("");
  const [showConfirmId,setShowConfirmId]=useState(null);
  const bname=settings?.bazaarName||"BazaarPOS";

  // Filter: tanggal + search nota
  const byDate=transactions.filter(t=>t.date===filterDate&&!t.refunded);
  const filtered=searchNota.trim()
    ?transactions.filter(t=>t.nota.toLowerCase().includes(searchNota.trim().toLowerCase()))
    :byDate;
  const sorted=[...filtered].sort((a,b)=>{const ta=a.timestamp?new Date(a.timestamp).getTime():0;const tb=b.timestamp?new Date(b.timestamp).getTime():0;return tb-ta;});
  const gt=filtered.reduce((s,t)=>s+t.total,0);

  // ── Data refund untuk laporan ─────────────────────────────────────────────
  const refundedTx=transactions.filter(t=>t.refunded&&t.date===filterDate)
    .sort((a,b)=>{const ta=a.refundedAt?new Date(a.refundedAt).getTime():0;const tb=b.refundedAt?new Date(b.refundedAt).getTime():0;return tb-ta;});
  const refundTotal=refundedTx.reduce((s,t)=>s+t.total,0);

  const exportRefundExcel=()=>{
    const esc=s=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const thStyle='style="background:#dc2626;color:#fff;padding:6px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;font-weight:bold;"';
    const tdStyle='style="padding:5px 10px;border:1px solid #ccc;font-family:Arial;font-size:11pt;"';
    const headers=["No Nota","Tenant","Waktu Transaksi","Waktu Refund","Pelanggan","Item","Total Refund (Rp)","Diproses Oleh"];
    const rows=refundedTx.map(tx=>{
      const tn=getTn(tx.tenantId);
      const items=(tx.items||[]).map(it=>`${it.menuName} x${it.qty}`).join(", ");
      const refundedBy=tx.refundedBy||(adminData?.name||"Admin");
      return`<tr>
        <td ${tdStyle}>${esc(tx.nota)}</td>
        <td ${tdStyle}>${esc(tn.name||tn.code||"")}</td>
        <td ${tdStyle}>${esc(tx.date)} ${esc(tx.time)}</td>
        <td ${tdStyle}>${tx.refundedAt?esc(new Date(tx.refundedAt).toLocaleString("id-ID")):"—"}</td>
        <td ${tdStyle}>${esc(tx.walletCustomerName||"Tunai")}</td>
        <td ${tdStyle}>${esc(items)}</td>
        <td ${tdStyle}>${esc(tx.total)}</td>
        <td ${tdStyle}>${esc(refundedBy)}</td>
      </tr>`;
    }).join("");
    const sumRow=`<tr><td colspan="6" style="padding:6px 10px;border:1px solid #ccc;font-family:Arial;font-weight:bold;background:#fef2f2;">TOTAL REFUND (${refundedTx.length} transaksi)</td><td style="padding:6px 10px;border:1px solid #ccc;font-family:Arial;font-weight:bold;background:#fef2f2;color:#dc2626;">${refundTotal.toLocaleString("id-ID")}</td><td style="padding:6px 10px;border:1px solid #ccc;background:#fef2f2;"></td></tr>`;
    const tbl=`<table><tr>${headers.map(h=>`<th ${thStyle}>${esc(h)}</th>`).join("")}</tr>${rows}${sumRow}</table>`;
    const html=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/></head><body>${tbl}</body></html>`;
    const blob=new Blob(["\uFEFF"+html],{type:"application/vnd.ms-excel;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`Refund_${filterDate}.xls`;a.click();
    URL.revokeObjectURL(url);
  };

  const printRefundA4=()=>{
    const rows=refundedTx.map((tx,i)=>{
      const tn=getTn(tx.tenantId);
      const items=(tx.items||[]).map(it=>`[${it.menuCode}] ${it.menuName} ×${it.qty} = ${idr(it.qty*it.price)}`).join("<br/>");
      return`<tr>
        <td>${i+1}</td>
        <td><strong>${tx.nota}</strong></td>
        <td><strong>${tn.code||""}</strong><br/><span style="color:#6b7280;font-size:10px">${tn.name||""}</span></td>
        <td>${tx.date}<br/>${tx.time}</td>
        <td>${tx.refundedAt?new Date(tx.refundedAt).toLocaleString("id-ID",{hour:"2-digit",minute:"2-digit"}):"—"}</td>
        <td>${tx.walletCustomerName||"<span style='color:#9ca3af'>Tunai</span>"}</td>
        <td style="font-size:10px">${items}</td>
        <td style="text-align:right;font-weight:700;color:#dc2626">${idr(tx.total)}</td>
      </tr>`;
    }).join("");
    const summary=`<div class="sr">
      <div class="sb"><p class="lbl">Jumlah Refund</p><p class="val" style="color:#dc2626">${refundedTx.length}</p></div>
      <div class="sb em"><p class="lbl">Total Nilai Refund</p><p class="val" style="color:#dc2626">${idr(refundTotal)}</p></div>
      <div class="sb"><p class="lbl">Omset Bersih</p><p class="val">${idr(gt)}</p></div>
    </div>`;
    printA4({
      title:"Laporan Refund / Pembatalan Transaksi",
      subtitle:`Tanggal: ${filterDate} | Dicetak: ${new Date().toLocaleString("id-ID")}`,
      bazaarName:bname,
      bodyHtml:`${summary}<div class="sec">Daftar Transaksi yang Direfund</div>
      <table>
        <thead><tr><th>#</th><th>No Nota</th><th>Tenant</th><th>Waktu Transaksi</th><th>Waktu Refund</th><th>Pelanggan</th><th>Item</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="7"><strong>TOTAL REFUND</strong></td><td style="text-align:right;color:#dc2626"><strong>${idr(refundTotal)}</strong></td></tr></tfoot>
      </table>`
    });
  };

  const doRefund=async(tx)=>{
    setRefunding(tx.id); setShowConfirmId(null);
    // ── Cek koneksi server DULU ──
    const online=await onCheckConnection();
    if(!online){
      setRefunding(null);
      setNetToast("Refund Gagal, Jaringan Kurang Baik. Silahkan coba lagi setelah jaringan baik.");
      setTimeout(()=>setRefundMsg(""),6000);
      return;
    }
    try{
      const updTx=transactions.map(t=>t.id===tx.id?{...t,refunded:true,refundedAt:new Date().toISOString(),refundedBy:adminData?.name||"Admin"}:t);
      await onSaveTx(updTx);
      if(tx.walletCustomerPhone){
        const cust=(customers||[]).find(c=>c.phone===tx.walletCustomerPhone);
        if(cust){
          const result=await onUpdateCustomerBalance(
            cust.id,
            tx.total, // delta: tambah (refund)
            (balBefore,balAfter)=>({id:uid(),customerId:cust.id,customerPhone:cust.phone,customerName:cust.name,
              type:"refund",amount:tx.total,balanceBefore:balBefore,balanceAfter:balAfter,
              nota:tx.nota,tenantId:tx.tenantId,tenantName:tenants.find(t=>t.id===tx.tenantId)?.name||"",
              timestamp:new Date().toISOString(),date:todayStr(),time:timeStr()})
          );
          const balAfter=result.balance;
          const _rfItems=tx.items.map(it=>`  ${it.menuName} x${it.qty} = ${idr(it.qty*it.price)}`).join("\n");
          const _rfMsg=`*${bname}*\n\n↩️ *Refund/Pembatalan Transaksi*\n📋 Nota: ${tx.nota}\n🏪 Tenant: ${tenants.find(t=>t.id===tx.tenantId)?.name||""}\n---------------------------\n${_rfItems}\n---------------------------\n💰 Refund: +${idr(tx.total)}\n🪙 Saldo Baru: ${idr(balAfter)}\n\nTerima kasih!\n${waSignature((adminData?.name)||"Admin")}`;
          const _rfOk=settings?.fonnteToken?await sendWhatsApp({token:settings.fonnteToken,phone:cust.phone,message:_rfMsg}):false;
          if(!_rfOk){const _p=cust.phone.replace(/\D/g,"");const _t=_p.startsWith("0")?"62"+_p.slice(1):_p;window.open(`https://wa.me/${_t}?text=${encodeURIComponent(_rfMsg)}`,"_blank");}
          setRefundMsg(`✅ Refund berhasil & TERSIMPAN! Saldo ${cust.name} +${idr(tx.total)} → ${idr(balAfter)}`);
        } else { setRefundMsg("✅ Transaksi dibatalkan. Pelanggan tidak ditemukan."); }
      } else { setRefundMsg("✅ Transaksi dibatalkan."); }
    }catch(e){ setRefundMsg("❌ Gagal: "+e.message); }
    setRefunding(null);
    setTimeout(()=>setRefundMsg(""),5000);
  };


  const doPrint=()=>{
    const rows=filtered.map(tx=>{const tn=getTn(tx.tenantId);const its=tx.items.map(it=>`[${it.menuCode}] ${it.menuName} ×${it.qty}=${idr(it.qty*it.price)}`).join("<br/>");return`<tr><td><strong>${tx.nota}</strong></td><td><strong>${tn.code||""}</strong><br/><span style="color:#6b7280;font-size:10px">${tn.name||""}</span></td><td>${tx.date}<br/>${tx.time}</td><td class="pe">🪙 Saldo</td><td style="font-size:10px">${its}</td><td style="text-align:right;font-weight:700">${idr(tx.total)}</td></tr>`;}).join("");
    printA4({title:"Data Transaksi Harian",subtitle:`Tanggal: ${filterDate} | Dicetak: ${new Date().toLocaleString("id-ID")}`,bazaarName:bname,bodyHtml:`<div class="sr"><div class="sb"><p class="lbl">Jumlah Tx</p><p class="val" style="color:#1c0a00">${filtered.length}</p></div><div class="sb em"><p class="lbl">🪙 Saldo</p><p class="val">${idr(gt)}</p></div><div class="sb"><p class="lbl">Grand Total</p><p class="val">${idr(gt)}</p></div></div><div class="sec">Daftar Transaksi</div><table><thead><tr><th>No Nota</th><th>Tenant</th><th>Waktu</th><th>Pembayaran</th><th>Item</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5"><strong>TOTAL</strong></td><td style="text-align:right"><strong>${idr(gt)}</strong></td></tr></tfoot></table>`});
  };

  return(
    <div>
      {/* Notif refund */}
      <NetToast msg={netToast} onClose={()=>setNetToast("")}/>
        {refundMsg&&<div className="pop-in" style={{background:refundMsg.startsWith("✅")?"#f0fdf4":"#fef2f2",border:`1px solid ${refundMsg.startsWith("✅")?"#bbf7d0":"#fca5a5"}`,borderRadius:12,padding:"10px 16px",marginBottom:16,fontWeight:600,fontSize:13,color:refundMsg.startsWith("✅")?"#16a34a":"#dc2626"}}>{refundMsg}</div>}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:12}}>
        <div><h2 style={{margin:0,fontSize:20,fontWeight:800,color:"#1c0a00"}}>Data Transaksi</h2>
          <p style={{color:"#9ca3af",margin:"4px 0 0",fontSize:13}}>{filtered.length} transaksi ditemukan</p></div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <DP value={filterDate} onChange={v=>{setFilterDate(v);setSearchNota("");}}/>
          {filtered.length>0&&<button onClick={doPrint} style={{background:"#1c0a00",color:"#fff",border:"none",borderRadius:12,padding:"10px 16px",fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}} onMouseOver={e=>e.currentTarget.style.background="#431407"} onMouseOut={e=>e.currentTarget.style.background="#1c0a00"}>🖨️ Print A4</button>}
        </div>
      </div>

      {/* ── Laporan Refund ── tampil hanya kalau ada refund di tanggal ini */}
      {refundedTx.length>0&&(
        <div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:16,padding:16,marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:12}}>
            <div>
              <h3 style={{margin:0,fontSize:15,fontWeight:800,color:"#dc2626"}}>↩️ Laporan Refund / Pembatalan</h3>
              <p style={{margin:"3px 0 0",color:"#9ca3af",fontSize:12}}>{refundedTx.length} transaksi direfund • Total: <strong style={{color:"#dc2626"}}>{idr(refundTotal)}</strong></p>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={exportRefundExcel}
                style={{padding:"8px 14px",background:"#dc2626",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif",display:"flex",alignItems:"center",gap:6}}
                onMouseOver={e=>e.currentTarget.style.background="#b91c1c"} onMouseOut={e=>e.currentTarget.style.background="#dc2626"}>
                📥 Excel Refund
              </button>
              <button onClick={printRefundA4}
                style={{padding:"8px 14px",background:"#7f1d1d",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif",display:"flex",alignItems:"center",gap:6}}
                onMouseOver={e=>e.currentTarget.style.background="#991b1b"} onMouseOut={e=>e.currentTarget.style.background="#7f1d1d"}>
                🖨️ Print Refund
              </button>
            </div>
          </div>
          {/* Daftar ringkas transaksi yang direfund */}
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {refundedTx.map(tx=>{
              const tn=getTn(tx.tenantId);
              return(
                <div key={tx.id} style={{background:"#fff",borderRadius:10,padding:"10px 14px",border:"1px solid #fecaca",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                  <div>
                    <span style={{fontWeight:700,fontSize:13,color:"#1c0a00"}}>{tx.nota}</span>
                    <span style={{color:"#9ca3af",fontSize:12,marginLeft:8}}>{tn.name||tn.code||""}</span>
                    <span style={{color:"#9ca3af",fontSize:12,marginLeft:8}}>{tx.time}</span>
                    {tx.walletCustomerName&&<span style={{color:"#6b7280",fontSize:12,marginLeft:8}}>• {tx.walletCustomerName}</span>}
                    {tx.refundedBy&&<p style={{margin:"2px 0 0",color:"#9ca3af",fontSize:11}}>Direfund oleh: {tx.refundedBy} • {tx.refundedAt?new Date(tx.refundedAt).toLocaleString("id-ID",{hour:"2-digit",minute:"2-digit"}):"—"}</p>}
                  </div>
                  <span style={{fontWeight:800,color:"#dc2626",fontSize:14,whiteSpace:"nowrap"}}>-{idr(tx.total)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search nota */}
      <div style={{position:"relative",marginBottom:16}}>
        <input placeholder="🔍 Cari nomor nota... (contoh: T001-20260519-001)"
          value={searchNota} onChange={e=>setSearchNota(e.target.value)}
          style={{width:"100%",border:"2px solid #e5e7eb",borderRadius:12,padding:"11px 14px",fontSize:14,outline:"none",color:"#111",boxSizing:"border-box",fontFamily:"'Plus Jakarta Sans',sans-serif",transition:"border-color .2s"}}
          onFocus={e=>e.target.style.borderColor="#ea580c"} onBlur={e=>e.target.style.borderColor="#e5e7eb"}/>
        {searchNota&&<button onClick={()=>setSearchNota("")} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:18}}>✕</button>}
      </div>

      {filtered.length===0?<EmptyState icon="📋" text={searchNota?"Nota tidak ditemukan.":"Tidak ada transaksi pada tanggal ini."}/>:
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {sorted.map(tx=>{const tn=getTn(tx.tenantId);return(
            <div key={tx.id} className="card-hover" style={{background:tx.refunded?"#fafafa":"#fff",border:`1px solid ${tx.refunded?"#fca5a5":"#f3f4f6"}`,borderRadius:16,padding:18,boxShadow:"0 2px 8px rgba(0,0,0,.05)",opacity:tx.refunded?0.7:1}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
                <div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:4}}>
                    <Bdg color="#fff7ed" tc="#ea580c" bc="#fed7aa" label={tn.code||"?"}/>
                    <Bdg color="#f0fdf4" tc="#16a34a" bc="#bbf7d0" label={`#${tx.nota}`}/>
                    <PayBadge method={tx.paymentMethod}/>
                    {tx.refunded&&<Bdg color="#fef2f2" tc="#dc2626" bc="#fca5a5" label="↩️ Direfund"/>}
                  </div>
                  <p style={{fontWeight:700,color:"#1c0a00",margin:"6px 0 2px",fontSize:14}}>{tn.name||"—"}</p>
                  {tx.walletCustomerName&&<p style={{color:"#7c3aed",fontSize:12,margin:"2px 0 0",fontWeight:600}}>🪙 {tx.walletCustomerName}</p>}
                  <p style={{color:"#9ca3af",fontSize:12,margin:0}}>{tx.date} • {tx.time}</p>
                </div>
                <p style={{color:"#ea580c",fontWeight:800,fontSize:20,margin:0}}>{idr(tx.total)}</p>
              </div>

              {/* Tombol Refund — hanya Super Admin, hanya yang belum direfund */}
              {isSuperAdmin&&!tx.refunded&&(
                <div style={{marginTop:10,borderTop:"1px dashed #f3f4f6",paddingTop:10}}>
                  {showConfirmId===tx.id?(
                    <div style={{background:"#fef2f2",borderRadius:10,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                      <p style={{margin:0,fontSize:13,color:"#dc2626",fontWeight:600}}>↩️ Yakin refund nota #{tx.nota}? Saldo {idr(tx.total)} akan dikembalikan.</p>
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={()=>setShowConfirmId(null)} style={{padding:"6px 14px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:8,cursor:"pointer",fontWeight:600,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>Batal</button>
                        <button onClick={()=>doRefund(tx)} disabled={refunding===tx.id}
                          style={{padding:"6px 14px",background:"#dc2626",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                          {refunding===tx.id?"⏳ Proses...":"✅ Ya, Refund"}
                        </button>
                      </div>
                    </div>
                  ):(
                    <button onClick={()=>setShowConfirmId(tx.id)}
                      style={{padding:"7px 16px",background:"#fef2f2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
                      onMouseOver={e=>e.currentTarget.style.background="#fee2e2"} onMouseOut={e=>e.currentTarget.style.background="#fef2f2"}>
                      ↩️ Cancel / Refund
                    </button>
                  )}
                </div>
              )}

              {tx.refunded&&(
                <div style={{marginTop:10,borderTop:"1px dashed #f3f4f6",paddingTop:8}}>
                  <p style={{color:"#dc2626",fontSize:12,margin:0,fontWeight:600}}>↩️ Transaksi ini sudah direfund pada {tx.refundedAt?new Date(tx.refundedAt).toLocaleString("id-ID"):"-"}</p>
                </div>
              )}

              <div style={{marginTop:10,borderTop:"1px dashed #f3f4f6",paddingTop:10}}>
                <table style={{width:"100%",fontSize:13,borderCollapse:"collapse"}}>
                  <thead><tr style={{color:"#9ca3af"}}><th style={{textAlign:"left",padding:"3px 0",fontWeight:600}}>Menu</th><th style={{textAlign:"center",padding:"3px 8px",fontWeight:600}}>Qty</th><th style={{textAlign:"right",fontWeight:600}}>Harga</th><th style={{textAlign:"right",fontWeight:600}}>Subtotal</th></tr></thead>
                  <tbody>{tx.items.map((it,i)=>(
                    <tr key={i} style={{borderTop:"1px solid #f9fafb"}}>
                      <td style={{padding:"5px 0"}}><span style={{color:"#9ca3af",marginRight:6}}>[{it.menuCode}]</span><span style={{fontWeight:600,color:"#374151"}}>{it.menuName}</span></td>
                      <td style={{textAlign:"center",padding:"5px 8px",color:"#374151"}}>{it.qty}</td>
                      <td style={{textAlign:"right",color:"#374151"}}>{idr(it.price)}</td>
                      <td style={{textAlign:"right",fontWeight:700,color:"#1c0a00"}}>{idr(it.qty*it.price)}</td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr style={{borderTop:"2px solid #f3f4f6"}}><td colSpan="3" style={{padding:"7px 0",fontWeight:700,color:"#374151"}}>TOTAL</td><td style={{textAlign:"right",fontWeight:800,color:"#ea580c",fontSize:14}}>{idr(tx.total)}</td></tr></tfoot>
                </table>
              </div>
            </div>
          );})}
        </div>}
    </div>
  );
}

// ─── Admin Tenant Report ──────────────────────────────────────────────────────
function AdminTenantReport({tenants,transactions,settings,filterDate,setFilterDate}){
  const [selTn,setSelTn]=useState("all"); const [exp,setExp]=useState({});
  const filtered=transactions.filter(t=>t.date===filterDate&&!t.refunded);
  const actv=tenants.filter(tn=>filtered.some(t=>t.tenantId===tn.id));
  const disp=selTn==="all"?actv:actv.filter(t=>t.id===selTn);
  const COLS=["#ea580c","#0284c7","#16a34a","#7c3aed","#db2777","#ca8a04","#0891b2","#dc2626"];
  const bname=settings?.bazaarName||"BazaarPOS";

  const exportXls=()=>{
    const sheets=disp.map(tn=>{
      const txs=filtered.filter(t=>t.tenantId===tn.id).sort((a,b)=>{const ta=a.timestamp?new Date(a.timestamp).getTime():0;const tb=b.timestamp?new Date(b.timestamp).getTime():0;return tb-ta;});
      const rows=[];txs.forEach(tx=>tx.items.forEach((it,i)=>rows.push([i===0?tx.nota:"",i===0?tx.date:"",i===0?tx.time:"",i===0?"Saldo":"",it.menuCode,it.menuName,it.qty,it.price,it.qty*it.price,i===0?tx.total:""])));
      const em=txs.reduce((s,t)=>s+t.total,0);const cs=0;
      rows.push([],[],[`TOTAL SALDO`,"","","","","","","","",em],["GRAND TOTAL","","","","","","","","",txs.reduce((s,t)=>s+t.total,0)]);

      return{name:tn.code,headers:["No Nota","Tanggal","Jam","Pembayaran","Kode Menu","Nama Menu","Qty","Harga","Subtotal","Total Nota"],rows};
    });
    exportToExcel({filename:`Laporan-Tenant-${filterDate}.xlsx`,sheets});
  };

  const doPrint=()=>{
    let body="";
    disp.forEach(tn=>{
      const txs=filtered.filter(t=>t.tenantId===tn.id).sort((a,b)=>{const ta=a.timestamp?new Date(a.timestamp).getTime():0;const tb=b.timestamp?new Date(b.timestamp).getTime():0;return tb-ta;});
      const tt=txs.reduce((s,t)=>s+t.total,0);
      const ms={};txs.forEach(tx=>tx.items.forEach(it=>{if(!ms[it.menuCode])ms[it.menuCode]={name:it.menuName,qty:0,total:0};ms[it.menuCode].qty+=it.qty;ms[it.menuCode].total+=it.qty*it.price;}));
      const mr=Object.entries(ms).map(([c,m])=>`<tr><td>[${c}]</td><td>${m.name}</td><td style="text-align:center">${m.qty}</td><td style="text-align:right">${idr(m.total)}</td></tr>`).join("");
      const nr=txs.map(tx=>`<tr><td>${tx.nota}</td><td>${tx.time}</td><td class="pe">🪙 Saldo</td><td style="font-size:10px">${tx.walletCustomerName?`<strong>👤 ${tx.walletCustomerName}</strong><br/>`:""}${tx.items.map(it=>`[${it.menuCode}] ${it.menuName} ×${it.qty}=${idr(it.qty*it.price)}`).join("<br/>")}</td><td style="text-align:right;font-weight:700">${idr(tx.total)}</td></tr>`).join("");
      body+=`<div class="th"><h3>${tn.code} — ${tn.name}</h3><p>${txs.length} transaksi &nbsp;|&nbsp; <span class="pe">🪙 Saldo: ${idr(tt)}</span> &nbsp;|&nbsp; Total: <strong>${idr(tt)}</strong></p></div><div class="sec">Ringkasan Menu</div><table><thead><tr><th>Kode</th><th>Nama Menu</th><th style="text-align:center">Terjual</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>${mr}</tbody><tfoot><tr><td colspan="3"><strong>Total</strong></td><td style="text-align:right"><strong>${idr(tt)}</strong></td></tr></tfoot></table><div class="sec">Rincian Nota</div><table><thead><tr><th>No Nota</th><th>Jam</th><th>Pembayaran</th><th>Item</th><th style="text-align:right">Total</th></tr></thead><tbody>${nr}</tbody><tfoot><tr><td colspan="4"><strong>Total ${tn.name}</strong></td><td style="text-align:right"><strong>${idr(tt)}</strong></td></tr></tfoot></table>`;
    });
    if(selTn==="all"&&disp.length>1){const gt=filtered.reduce((s,t)=>s+t.total,0);body+=`<div style="background:#fff7ed;border:2px solid #ea580c;border-radius:6px;padding:12px 16px;margin-top:16px"><strong>🏆 GRAND TOTAL — ${filterDate}</strong><br/><span class="pe">🪙 Total Saldo: ${idr(gt)}</span> &nbsp;|&nbsp; <strong style="color:#ea580c">Grand Total: ${idr(gt)}</strong></div>`;}

    printA4({title:"Laporan Transaksi per Tenant",subtitle:`Tanggal: ${filterDate} | Dicetak: ${new Date().toLocaleString("id-ID")}`,bazaarName:bname,bodyHtml:body});
  };

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div><h2 style={{margin:0,fontSize:20,fontWeight:800,color:"#1c0a00"}}>Laporan per Tenant</h2>
          <p style={{color:"#9ca3af",margin:"4px 0 0",fontSize:13}}>Detail transaksi harian per tenant</p></div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <DP value={filterDate} onChange={v=>{setFilterDate(v);setSelTn("all");}}/>
          {filtered.length>0&&<>
            <button onClick={exportXls} style={{background:"#16a34a",color:"#fff",border:"none",borderRadius:12,padding:"10px 16px",fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}} onMouseOver={e=>e.currentTarget.style.background="#15803d"} onMouseOut={e=>e.currentTarget.style.background="#16a34a"}>📥 Excel</button>
            <button onClick={doPrint} style={{background:"#1c0a00",color:"#fff",border:"none",borderRadius:12,padding:"10px 16px",fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}} onMouseOver={e=>e.currentTarget.style.background="#431407"} onMouseOut={e=>e.currentTarget.style.background="#1c0a00"}>🖨️ Print A4</button>
          </>}
        </div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
        <Pill active={selTn==="all"} color="#ea580c" onClick={()=>setSelTn("all")} label="Semua Tenant"/>
        {actv.map((t,i)=><Pill key={t.id} active={selTn===t.id} color={COLS[i%COLS.length]} onClick={()=>setSelTn(t.id)} label={`${t.code} — ${t.name}`}/>)}
      </div>
      {filtered.length===0?<EmptyState icon="📑" text="Tidak ada transaksi."/>:disp.length===0?<EmptyState icon="🏪" text="Tidak ada tenant aktif."/>:
        <div style={{display:"flex",flexDirection:"column",gap:20}}>
          {disp.map((tn,ti)=>{
            const txs=[...filtered.filter(t=>t.tenantId===tn.id)].sort((a,b)=>{const ta=a.timestamp?new Date(a.timestamp).getTime():0;const tb=b.timestamp?new Date(b.timestamp).getTime():0;return tb-ta;});
            const tt=txs.reduce((s,t)=>s+t.total,0);
            const ac=COLS[ti%COLS.length];const ms={};txs.forEach(tx=>tx.items.forEach(it=>{if(!ms[it.menuCode])ms[it.menuCode]={name:it.menuName,price:it.price,qty:0,total:0};ms[it.menuCode].qty+=it.qty;ms[it.menuCode].total+=it.qty*it.price;}));
            return(
              <div key={tn.id} style={{background:"#fff",border:"1px solid #f3f4f6",borderRadius:18,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,.06)"}}>
                <div style={{background:`linear-gradient(90deg,${ac}18,${ac}08)`,borderBottom:`3px solid ${ac}`,padding:"16px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <div style={{width:44,height:44,borderRadius:12,background:`${ac}20`,border:`2px solid ${ac}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🏪</div>
                    <div>
                      <span style={{background:`${ac}20`,color:ac,fontSize:12,fontWeight:800,padding:"3px 10px",borderRadius:20,border:`1px solid ${ac}40`}}>{tn.code}</span>
                      <p style={{fontWeight:800,fontSize:17,color:"#1c0a00",margin:"6px 0 2px"}}>{tn.name}</p>
                      <p style={{color:"#6b7280",fontSize:12,margin:0}}>{txs.length} nota • {filterDate}</p>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <p style={{color:ac,fontWeight:900,fontSize:24,margin:"0 0 4px"}}>{idr(tt)}</p>
                    <div style={{display:"flex",gap:6,justifyContent:"flex-end",flexWrap:"wrap"}}>
                      <span style={{fontSize:12,color:"#4c1d95",background:"#f5f0ff",border:"1px solid #c4b5fd",borderRadius:10,padding:"3px 10px",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                        <span>🪙</span><span>Saldo: {idr(tt)}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{padding:"16px 20px"}}>
                  <p style={{fontWeight:700,color:"#374151",fontSize:13,margin:"0 0 8px"}}>📦 Ringkasan Menu</p>
                  <div style={{overflowX:"auto",marginBottom:16}}>
                    <table style={{width:"100%",fontSize:13,borderCollapse:"collapse",minWidth:360}}>
                      <thead><tr style={{background:"#f9fafb"}}><th style={{textAlign:"left",padding:"7px 10px",color:"#6b7280",fontWeight:600}}>Kode</th><th style={{textAlign:"left",padding:"7px 10px",color:"#6b7280",fontWeight:600}}>Menu</th><th style={{textAlign:"center",padding:"7px 10px",color:"#6b7280",fontWeight:600}}>Harga</th><th style={{textAlign:"center",padding:"7px 10px",color:"#6b7280",fontWeight:600}}>Terjual</th><th style={{textAlign:"right",padding:"7px 10px",color:"#6b7280",fontWeight:600}}>Subtotal</th></tr></thead>
                      <tbody>{Object.entries(ms).map(([c,m])=>(
                        <tr key={c} style={{borderTop:"1px solid #f3f4f6"}}>
                          <td style={{padding:"7px 10px"}}><span style={{background:`${ac}15`,color:ac,fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:8}}>{c}</span></td>
                          <td style={{padding:"7px 10px",fontWeight:600,color:"#1c0a00"}}>{m.name}</td>
                          <td style={{padding:"7px 10px",textAlign:"center",color:"#6b7280"}}>{idr(m.price)}</td>
                          <td style={{padding:"7px 10px",textAlign:"center"}}><span style={{background:"#f0f9ff",color:"#0284c7",fontWeight:700,padding:"2px 8px",borderRadius:10,fontSize:13}}>{m.qty} pcs</span></td>
                          <td style={{padding:"7px 10px",textAlign:"right",fontWeight:700,color:"#1c0a00"}}>{idr(m.total)}</td>
                        </tr>
                      ))}</tbody>
                      <tfoot><tr style={{borderTop:"2px solid #f3f4f6",background:"#fafafa"}}><td colSpan="4" style={{padding:"8px 10px",fontWeight:800,color:"#374151"}}>TOTAL</td><td style={{padding:"8px 10px",textAlign:"right",fontWeight:900,color:ac,fontSize:14}}>{idr(tt)}</td></tr></tfoot>
                    </table>
                  </div>
                  <p style={{fontWeight:700,color:"#374151",fontSize:13,margin:"0 0 8px"}}>🧾 Rincian per Nota</p>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {txs.map(tx=>(
                      <div key={tx.id} style={{border:"1px solid #f3f4f6",borderRadius:10,overflow:"hidden"}}>
                        <button onClick={()=>setExp(p=>({...p,[tx.id]:!p[tx.id]}))} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:exp[tx.id]?"#fafafa":"#fff",border:"none",cursor:"pointer",gap:8,flexWrap:"wrap"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                            <span style={{fontSize:12,color:"#6b7280",display:"inline-block",transform:exp[tx.id]?"rotate(90deg)":"rotate(0)",transition:"transform .2s"}}>▶</span>
                            <span style={{background:`${ac}15`,color:ac,fontSize:11,fontWeight:800,padding:"3px 8px",borderRadius:20}}>#{tx.nota}</span>
                            <PayBadge method={tx.paymentMethod}/>
                            {tx.walletCustomerName&&<span style={{background:"#f5f0ff",color:"#7c3aed",fontSize:11,fontWeight:700,padding:"3px 8px",borderRadius:20}}>👤 {tx.walletCustomerName}</span>}
                              <span style={{color:"#9ca3af",fontSize:12}}>{tx.time} • {tx.items.length} item</span>
                          </div>
                          <span style={{fontWeight:800,color:"#1c0a00",fontSize:14}}>{idr(tx.total)}</span>
                        </button>
                        {exp[tx.id]&&<div style={{padding:"0 14px 12px",background:"#fafafa",borderTop:"1px dashed #f3f4f6"}}>
                          <table style={{width:"100%",fontSize:12,borderCollapse:"collapse",marginTop:8}}>
                            <thead><tr style={{color:"#9ca3af"}}><th style={{textAlign:"left",padding:"3px 0",fontWeight:600}}>Kode</th><th style={{textAlign:"left",padding:"3px 6px",fontWeight:600}}>Menu</th><th style={{textAlign:"center",fontWeight:600}}>Qty</th><th style={{textAlign:"right",fontWeight:600}}>Harga</th><th style={{textAlign:"right",fontWeight:600}}>Subtotal</th></tr></thead>
                            <tbody>{tx.items.map((it,i)=>(
                              <tr key={i} style={{borderTop:"1px solid #f0f0f0"}}>
                                <td style={{padding:"5px 0"}}><span style={{background:`${ac}12`,color:ac,fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:6}}>{it.menuCode}</span></td>
                                <td style={{padding:"5px 6px",fontWeight:600,color:"#374151"}}>{it.menuName}</td>
                                <td style={{textAlign:"center",color:"#374151"}}>{it.qty}</td>
                                <td style={{textAlign:"right",color:"#6b7280"}}>{idr(it.price)}</td>
                                <td style={{textAlign:"right",fontWeight:700,color:"#1c0a00"}}>{idr(it.qty*it.price)}</td>
                              </tr>
                            ))}</tbody>
                            <tfoot><tr style={{borderTop:"2px solid #ececec"}}><td colSpan="4" style={{padding:"6px 0",fontWeight:700,color:"#374151"}}>TOTAL</td><td style={{textAlign:"right",fontWeight:900,color:ac,fontSize:13}}>{idr(tx.total)}</td></tr></tfoot>
                          </table>
                        </div>}
                      </div>
                    ))}
                  </div>
                  <div style={{marginTop:14,background:`${ac}12`,border:`1px solid ${ac}30`,borderRadius:12,padding:"12px 16px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:10}}>
                      <div><p style={{margin:0,fontWeight:700,color:"#374151",fontSize:13}}>Total — {tn.name}</p><p style={{margin:"2px 0 0",color:"#6b7280",fontSize:12}}>{txs.length} nota • {filterDate}</p></div>
                      <p style={{margin:0,fontWeight:900,color:ac,fontSize:20}}>{idr(tt)}</p>
                    </div>
                    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                      <div style={{background:"#f5f0ff",border:"1px solid #c4b5fd",borderRadius:10,padding:"8px 12px",flex:1}}>
                        <p style={{margin:"0 0 2px",color:"#4c1d95",fontSize:12,fontWeight:700}}>🪙 Total Saldo Transaksi</p>
                        <p style={{margin:0,color:"#4c1d95",fontWeight:800,fontSize:14}}>{idr(tt)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {selTn==="all"&&disp.length>1&&(()=>{const gt=filtered.reduce((s,t)=>s+t.total,0);return(
            <div style={{background:"#1c0a00",borderRadius:16,padding:"18px 22px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:12}}>
                <div><p style={{color:"#fed7aa",fontWeight:700,margin:0,fontSize:14}}>🏆 GRAND TOTAL</p><p style={{color:"#9ca3af",fontSize:12,margin:"2px 0 0"}}>{filtered.length} transaksi • {disp.length} tenant • {filterDate}</p></div>
                <p style={{color:"#fb923c",fontWeight:900,fontSize:26,margin:0}}>{idr(gt)}</p>
              </div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <div style={{background:"rgba(76,29,149,.25)",borderRadius:10,padding:"8px 14px",flex:1}}>
                  <p style={{margin:"0 0 2px",color:"#c4b5fd",fontSize:11,fontWeight:600}}>🪙 Total Saldo</p>
                  <p style={{margin:0,color:"#fff",fontWeight:800,fontSize:15}}>{idr(gt)}</p>
                </div>
              </div>
            </div>
          );})()}
        </div>}
    </div>
  );
}

// ─── Admin Summary ────────────────────────────────────────────────────────────
function AdminSummary({tenants,transactions,settings,filterDate,setFilterDate}){
  const filtered=transactions.filter(t=>t.date===filterDate&&!t.refunded);
  const gt=filtered.reduce((s,t)=>s+t.total,0);
  const bname=settings?.bazaarName||"BazaarPOS";
  const byTn=tenants.map(tn=>{const txs=filtered.filter(t=>t.tenantId===tn.id);return{...tn,n:txs.length,tt:txs.reduce((s,t)=>s+t.total,0),em:txs.filter(t=>t.paymentMethod==="emoney").reduce((s,t)=>s+t.total,0),cs:txs.filter(t=>t.paymentMethod==="cash").reduce((s,t)=>s+t.total,0)};}).filter(t=>t.n>0).sort((a,b)=>b.tt-a.tt);

  const exportXls=()=>{
    const sr=byTn.map(t=>[t.code,t.name,t.n,t.em,t.cs,t.tt]);
    const tr=filtered.map(tx=>{const tn=tenants.find(t=>t.id===tx.tenantId)||{};return[tx.nota,tn.code||"",tn.name||"",tx.date,tx.time,"Saldo",tx.total];});
    exportToExcel({filename:`Rekap-${filterDate}.xlsx`,sheets:[{name:"Rekap Tenant",headers:["Kode","Nama","Jml Tx","Total Saldo"],rows:byTn.map(t=>[t.code,t.name,t.n,t.tt])},{name:"Detail Transaksi",headers:["No Nota","Kode","Nama","Tanggal","Jam","Pembayaran","Total"],rows:tr}]});
  };
  const doPrint=()=>{
    const rows=byTn.map((t,i)=>`<tr><td>${i+1}</td><td><strong>${t.code}</strong></td><td>${t.name}</td><td style="text-align:center">${t.n}</td><td class="pe" style="text-align:right">${idr(t.em)}</td><td class="pc" style="text-align:right">${idr(t.cs)}</td><td style="text-align:right;font-weight:700">${idr(t.tt)}</td></tr>`).join("");
    printA4({title:"Rekapitulasi Harian",subtitle:`Tanggal: ${filterDate} | Dicetak: ${new Date().toLocaleString("id-ID")}`,bazaarName:bname,bodyHtml:`<div class="sr"><div class="sb"><p class="lbl">Transaksi</p><p class="val" style="color:#1c0a00">${filtered.length}</p></div><div class="sb"><p class="lbl">Tenant Aktif</p><p class="val" style="color:#1c0a00">${byTn.length}</p></div><div class="sb em"><p class="lbl">🪙 Total Saldo</p><p class="val">${idr(gt)}</p></div></div><div class="sec">Rekapitulasi per Tenant</div><table><thead><tr><th>#</th><th>Kode</th><th>Nama Tenant</th><th style="text-align:center">Transaksi</th><th style="text-align:right">Total Saldo</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="3"><strong>GRAND TOTAL</strong></td><td style="text-align:center"><strong>${filtered.length}</strong></td><td style="text-align:right"><strong>${idr(gt)}</strong></td></tr></tfoot></table>`});
  };

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div><h2 style={{margin:0,fontSize:20,fontWeight:800,color:"#1c0a00"}}>Rekapitulasi Harian</h2>
          <p style={{color:"#9ca3af",margin:"4px 0 0",fontSize:13}}>Tutup Pencatatan — {filterDate}</p></div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <DP value={filterDate} onChange={setFilterDate}/>
          {filtered.length>0&&<>
            <button onClick={exportXls} style={{background:"#16a34a",color:"#fff",border:"none",borderRadius:12,padding:"10px 16px",fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}} onMouseOver={e=>e.currentTarget.style.background="#15803d"} onMouseOut={e=>e.currentTarget.style.background="#16a34a"}>📥 Excel</button>
            <button onClick={doPrint} style={{background:"#1c0a00",color:"#fff",border:"none",borderRadius:12,padding:"10px 16px",fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}} onMouseOver={e=>e.currentTarget.style.background="#431407"} onMouseOut={e=>e.currentTarget.style.background="#1c0a00"}>🖨️ Print A4</button>
          </>}
        </div>
      </div>
      <div style={{background:"linear-gradient(135deg,#7c2d12,#ea580c)",borderRadius:18,padding:24,color:"#fff",marginBottom:14,boxShadow:"0 8px 32px rgba(234,88,12,.4)"}}>
        <p style={{margin:"0 0 4px",color:"#fed7aa",fontSize:12,fontWeight:600}}>⚡ TOTAL KESELURUHAN</p>
        <p style={{margin:"0 0 14px",fontSize:36,fontWeight:800,letterSpacing:-1}}>{idr(gt)}</p>
        <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
          <div><p style={{margin:0,color:"#fed7aa",fontSize:12}}>Transaksi</p><p style={{margin:"2px 0 0",fontWeight:700,fontSize:17}}>{filtered.length}</p></div>
          <div><p style={{margin:0,color:"#fed7aa",fontSize:12}}>Tenant Aktif</p><p style={{margin:"2px 0 0",fontWeight:700,fontSize:17}}>{byTn.length}</p></div>
        </div>
      </div>
      {filtered.length>0&&<div style={{display:"grid",gridTemplateColumns:"1fr",gap:12,marginBottom:18}}>
        <div style={{background:"#f5f0ff",border:"2px solid #c4b5fd",borderRadius:14,padding:16}}>
          <p style={{margin:"0 0 4px",color:"#4c1d95",fontSize:11,fontWeight:700}}>🪙 TOTAL SALDO TRANSAKSI</p>
          <p style={{margin:"0 0 4px",color:"#4c1d95",fontWeight:900,fontSize:20}}>{idr(gt)}</p>
          <p style={{margin:0,color:"#7c3aed",fontSize:12}}>{filtered.length} transaksi</p>
        </div>
      </div>}
      {byTn.length===0?<EmptyState icon="📊" text="Tidak ada data transaksi."/>:
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {byTn.map((t,i)=>(
            <div key={t.id} className="card-hover" style={{background:"#fff",border:"1px solid #f3f4f6",borderRadius:14,padding:"16px 20px",boxShadow:"0 2px 8px rgba(0,0,0,.05)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:38,height:38,borderRadius:10,background:i===0?"#fff7ed":"#f9fafb",border:`2px solid ${i===0?"#fed7aa":"#e5e7eb"}`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,color:i===0?"#ea580c":"#6b7280",fontSize:15}}>{i+1}</div>
                  <div>
                    <div style={{display:"flex",gap:8,marginBottom:4}}><Bdg color="#fff7ed" tc="#ea580c" bc="#fed7aa" label={t.code}/></div>
                    <p style={{fontWeight:700,color:"#1c0a00",margin:0,fontSize:14}}>{t.name}</p>
                    <p style={{color:"#9ca3af",fontSize:12,margin:"2px 0 0"}}>{t.n} transaksi</p>
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <p style={{color:"#ea580c",fontWeight:800,fontSize:20,margin:0}}>{idr(t.tt)}</p>
                  <div style={{display:"flex",gap:6,marginTop:4,justifyContent:"flex-end",flexWrap:"wrap"}}>
                    <span style={{fontSize:12,color:"#4c1d95",background:"#f5f0ff",border:"1px solid #c4b5fd",borderRadius:10,padding:"3px 10px",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                      <span>🪙</span><span>Saldo: {idr(t.tt)}</span>
                    </span>
                  </div>
                  <div style={{height:4,borderRadius:4,background:"#f3f4f6",marginTop:6,width:100}}><div style={{height:4,borderRadius:4,background:"#ea580c",width:`${gt>0?(t.tt/gt)*100:0}%`,transition:"width .6s ease"}}/></div>
                </div>
              </div>
            </div>
          ))}
          <div style={{background:"#1c0a00",borderRadius:14,padding:"16px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
            <div><p style={{color:"#fed7aa",fontWeight:700,margin:0,fontSize:13}}>TOTAL KESELURUHAN</p><p style={{color:"#9ca3af",fontSize:12,margin:"2px 0 0"}}>{filtered.length} transaksi • {byTn.length} tenant</p></div>
            <p style={{color:"#fb923c",fontWeight:900,fontSize:22,margin:0}}>{idr(gt)}</p>
          </div>
        </div>}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TENANT APP
// ═════════════════════════════════════════════════════════════════════════════
function TenantApp({tenant,menus,allMenus,transactions,allTransactions,settings,customers,walletLogs,orders,onSaveMenus,onSaveTx,onSaveCustomers,onSaveWalletLogs,onSaveOrders,onUpdateCustomerBalance,onCheckConnection,onSaveAlerts,alerts,onRefresh,refreshing,onLogout}){
  const [tab,setTab]=useState("pos");
  const {BackConfirmModal}=useBackConfirm(true);
  const [isOnline,setIsOnline]=useState(navigator.onLine);
  const [showEmerg,setShowEmerg]=useState(false);
  const [emergMsg,setEmergMsg]=useState("");

  // ── Baca nama kasir dari sessionStorage (diisi saat login) ───────────────────
  const kasirName=useMemo(()=>{
    try{return sessionStorage.getItem(`bzr_kasir_${tenant.id}`)||"";}catch(e){return "";}
  },[tenant.id]);
  // Kode kasir: ambil spasi hapus, uppercase, max 4 char (contoh: "Kasir 1"→"K1", "Budi"→"BUDI")
  const kasirCode=useMemo(()=>{
    if(!kasirName)return "";
    // Cek apakah sudah dalam format pendek (≤4 char tanpa spasi)
    const clean=kasirName.replace(/\s+/g,"");
    if(clean.length<=4)return clean.toUpperCase();
    // Ambil huruf pertama tiap kata, max 4 char
    return kasirName.split(/\s+/).map(w=>w[0]||"").join("").toUpperCase().slice(0,4);
  },[kasirName]);

  useEffect(()=>{
    const on=()=>setIsOnline(true); const off=()=>setIsOnline(false);
    window.addEventListener("online",on); window.addEventListener("offline",off);
    return()=>{window.removeEventListener("online",on);window.removeEventListener("offline",off);};
  },[]);

  const sendEmergency=async()=>{
    if(!emergMsg.trim()){alert("Tulis pesan darurat terlebih dahulu!");return;}
    const newAlert={id:uid(),tenantId:tenant.id,tenantCode:tenant.code,tenantName:tenant.name,message:emergMsg.trim(),time:new Date().toLocaleString("id-ID"),read:false};
    await onSaveAlerts([...alerts,newAlert]);
    setEmergMsg("");setShowEmerg(false);alert("✅ Pesan darurat telah dikirim ke Admin!");
  };

  return(
    <div style={{minHeight:"100vh",background:"#f0fdf4"}}>
      <BackConfirmModal/>
      {!isOnline&&<div style={{background:"#dc2626",color:"#fff",textAlign:"center",padding:"8px",fontSize:13,fontWeight:700}}>⚠️ Tidak ada koneksi internet — transaksi akan DITOLAK sampai jaringan kembali normal</div>}

      {showEmerg&&<Modal title="🆘 Kirim Pesan Darurat" onClose={()=>setShowEmerg(false)} accent="#dc2626">
        <p style={{color:"#6b7280",fontSize:13,margin:"0 0 12px"}}>Pesan ini akan langsung tampil di panel Admin. Gunakan hanya saat ada masalah mendesak.</p>
        <textarea value={emergMsg} onChange={e=>setEmergMsg(e.target.value)} placeholder="Jelaskan masalah yang terjadi..."
          style={{width:"100%",border:"2px solid #fca5a5",borderRadius:12,padding:"12px",fontSize:14,outline:"none",resize:"vertical",minHeight:80,fontFamily:"'Plus Jakarta Sans',sans-serif",color:"#111",boxSizing:"border-box"}}/>
        <div style={{display:"flex",gap:10,marginTop:12}}>
          <button onClick={()=>setShowEmerg(false)} style={btnSec}>Batal</button>
          <button onClick={sendEmergency} style={{flex:1,padding:"12px",background:"#dc2626",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>🆘 Kirim</button>
        </div>
      </Modal>}

      <div style={{background:"linear-gradient(90deg,#14532d,#16a34a)",padding:"13px 16px",boxShadow:"0 4px 20px rgba(22,163,74,.3)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{display:"flex",gap:8,marginBottom:4}}>
              <span style={{background:"rgba(255,255,255,.2)",color:"#fff",fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:20}}>{tenant.code}</span>
            </div>
            <h1 style={{color:"#fff",fontSize:18,fontWeight:800,margin:0}}>{tenant.name}</h1>
            <p style={{color:"#bbf7d0",fontSize:11,margin:"2px 0 0"}}>
              {kasirName?<>👤 <strong>{kasirName}</strong> • </>:""}Tenant App • {todayStr()}
            </p>
            {/* Omset hari ini — real time */}
            {(()=>{
              const todayTx=transactions.filter(t=>t.date===todayStr()&&!t.refunded);
              const omset=todayTx.reduce((s,t)=>s+t.total,0);
              const txCount=todayTx.length;
              return(
                <div style={{marginTop:6,background:"rgba(0,0,0,.2)",borderRadius:10,padding:"5px 12px",display:"inline-flex",alignItems:"center",gap:10}}>
                  <span style={{color:"#bbf7d0",fontSize:11,fontWeight:600}}>💰 Omset Hari Ini</span>
                  <span style={{color:"#fff",fontSize:15,fontWeight:900}}>{idr(omset)}</span>
                  <span style={{color:"#86efac",fontSize:11}}>({txCount} tx)</span>
                </div>
              );
            })()}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{color:"#fff",fontSize:15,fontWeight:800}}>{settings?.bazaarName}</span>
            <NetworkBadge onCheckConnection={onCheckConnection}/>
            <button onClick={()=>setShowEmerg(true)} className="pulse" style={{background:"#dc2626",color:"#fff",border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>🆘</button>
            <button onClick={onRefresh} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12,fontWeight:600}} title="Refresh" className={refreshing?"spinning":""}>🔄</button>
            <button onClick={()=>{if(window.confirm("Yakin ingin keluar dari aplikasi?"))onLogout();}} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12,fontWeight:600}}>Keluar</button>
          </div>
        </div>
      </div>

      <div style={{background:"#fff",borderBottom:"1px solid #e5e7eb",display:"flex"}}>
        {[{k:"pos",i:"🛒",l:"Transaksi"},{k:"po",i:"📦",l:"PO"},{k:"menu",i:"📝",l:"Menu"},{k:"history",i:"📜",l:"Riwayat"}].map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k)} style={{flex:1,padding:"13px 4px",background:"none",border:"none",borderBottom:tab===t.k?"3px solid #16a34a":"3px solid transparent",color:tab===t.k?"#16a34a":"#6b7280",fontWeight:tab===t.k?700:500,cursor:"pointer",fontSize:13}}>
            <div>{t.i}</div><div style={{marginTop:2}}>{t.l}</div>
          </button>
        ))}
      </div>

      <div style={{padding:16,maxWidth:520,margin:"0 auto"}} className="fade-in">
        {tab==="pos"&&<TenantPOS tenant={tenant} menus={menus} allTransactions={allTransactions} onSaveTx={onSaveTx} settings={settings} customers={customers} walletLogs={walletLogs} onSaveCustomers={onSaveCustomers} onSaveWalletLogs={onSaveWalletLogs} onUpdateCustomerBalance={onUpdateCustomerBalance} onCheckConnection={onCheckConnection} kasirName={kasirName} kasirCode={kasirCode}/>}
        {tab==="po"&&<POTenant tenant={tenant} orders={orders} customers={customers} onSaveOrders={onSaveOrders} onSaveCustomers={onSaveCustomers} onUpdateCustomerBalance={onUpdateCustomerBalance} onCheckConnection={onCheckConnection} settings={settings} menus={menus} kasirName={kasirName}/>}
        {tab==="menu"&&<TenantMenuMgr tenant={tenant} menus={menus} allMenus={allMenus} allTransactions={allTransactions} orders={orders} onSaveMenus={onSaveMenus}/>}
        {tab==="history"&&<TenantHistory transactions={transactions} tenant={tenant} settings={settings}/>}
      </div>
    </div>
  );
}

// ─── Tenant POS ───────────────────────────────────────────────────────────────
function TenantPOS({tenant,menus,allTransactions,onSaveTx,settings,customers,walletLogs,onSaveCustomers,onSaveWalletLogs,onUpdateCustomerBalance,onCheckConnection,kasirName="",kasirCode=""}){
  const [cart,setCart]=useState([]);
  const [lastNota,setLastNota]=useState(null);
  const [printed,setPrinted]=useState(false);
  const [showScanner,setShowScanner]=useState(false);
  const [scanPhone,setScanPhone]=useState(""); // hasil scan
  const [scanError,setScanError]=useState("");
  const [pinInput,setPinInput]=useState(""); // PIN yang diinput pelanggan
  const [pinError,setPinError]=useState("");
  const [scannedCust,setScannedCust]=useState(null); // customer hasil scan, menunggu PIN
  const [checkoutLoading,setCheckoutLoading]=useState(false);
  const [netToast,setNetToast]=useState("");
  const submittingRef=useRef(false); // proteksi anti dobel-submit (klik ganda cepat)
  const videoRef=useRef(null);
  const scanIntervalRef=useRef(null);

  const addToCart=m=>setCart(p=>{const ex=p.find(c=>c.menuId===m.id);return ex?p.map(c=>c.menuId===m.id?{...c,qty:c.qty+1}:c):[...p,{menuId:m.id,menuCode:m.code,menuName:m.name,price:m.price,qty:1}];});
  const updQty=(id,q)=>{if(q<=0)setCart(p=>p.filter(c=>c.menuId!==id));else setCart(p=>p.map(c=>c.menuId===id?{...c,qty:q}:c));};
  const total=cart.reduce((s,c)=>s+c.price*c.qty,0);

  // ── Start QR Scanner ──────────────────────────────────────────────────────
  const startScanner=async()=>{
    window.scrollTo({top:0,behavior:"instant"});
    setScanPhone("");setScanError("");setShowScanner(true);
    // Load jsQR dari CDN jika belum ada
    if(!window.jsQR){
      await new Promise((res,rej)=>{
        const s=document.createElement("script");
        s.src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
        s.onload=res; s.onerror=rej;
        document.head.appendChild(s);
      });
    }
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
      if(videoRef.current){
        videoRef.current.srcObject=stream;
        videoRef.current.play();
        // Scan frame setiap 500ms
        scanIntervalRef.current=setInterval(()=>{
          if(!videoRef.current||!window.jsQR)return;
          const canvas=document.createElement("canvas");
          canvas.width=videoRef.current.videoWidth;
          canvas.height=videoRef.current.videoHeight;
          const ctx=canvas.getContext("2d");
          ctx.drawImage(videoRef.current,0,0);
          const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
          const code=window.jsQR(imageData.data,imageData.width,imageData.height);
          if(code&&code.data){
            const scanned=code.data.trim();
            const found=(customers||[]).find(c=>c.id===scanned)||(customers||[]).find(c=>c.phone===scanned.replace(/\D/g,""));
            const identifier=found?found.id:scanned;
            setScanPhone(identifier);
            if(found) setScannedCust(found);
            stopScanner();
          }
        },500);
      }
    }catch(e){
      setScanError("Gagal akses kamera: "+e.message);
    }
  };

  const stopScanner=()=>{
    clearInterval(scanIntervalRef.current);
    if(videoRef.current&&videoRef.current.srcObject){
      videoRef.current.srcObject.getTracks().forEach(t=>t.stop());
      videoRef.current.srcObject=null;
    }
  };

  const closeScanner=()=>{stopScanner();setShowScanner(false);setScanPhone("");setScanError("");setPinInput("");setPinError("");setScannedCust(null);};

  // ── Bayar pakai saldo (setelah QR di-scan) ────────────────────────────────
  const handleWalletPay=async()=>{
    if(!scanPhone){setScanError("Scan QR pelanggan terlebih dahulu!");return;}
    const cust=scannedCust||customers.find(c=>c.id===scanPhone)||customers.find(c=>c.phone===scanPhone);
    if(!cust){setScanError("Pelanggan tidak ditemukan!");return;}
    // Verifikasi PIN
    if(cust.pin&&pinInput!==cust.pin){setPinError("❌ PIN salah! Coba lagi.");setPinInput("");return;}
    if(cust.balance<total){setScanError(`Saldo tidak cukup! Saldo: ${idr(cust.balance)}, Perlu: ${idr(total)}`);return;}
    setScanError("");
    // Modal scan/PIN TIDAK ditutup dulu — biar kasir lihat status proses & bisa retry
    // tanpa scan ulang QR/PIN kalau gagal karena jaringan.
    await handleCheckout("wallet",cust);
  };

  // ── Checkout utama ────────────────────────────────────────────────────────
  const handleCheckout=async(paymentMethod,walletCust=null)=>{
    if(submittingRef.current)return;
    if(!cart.length){alert("Keranjang kosong!");return;}
    submittingRef.current=true;
    setCheckoutLoading(true);

    // ── Cek koneksi + latency sebelum mulai ──
    const online=await onCheckConnection();
    if(!online){
      setCheckoutLoading(false); submittingRef.current=false;
      setNetToast("Transaksi Gagal, Jaringan Kurang Baik. Silahkan coba lagi setelah jaringan baik.");
      return;
    }

    // ── UI timeout 12 detik — unlock kasir kalau proses terlalu lama ────────────
    const uiTimeoutId=setTimeout(()=>{
      if(submittingRef.current){
        setCheckoutLoading(false); submittingRef.current=false;
        setNetToast("Transaksi Gagal, Silahkan cek riwayat transaksi dan refresh saldo di link pelanggan");
      }
    },12000);

    const nota=genNota(tenant.code,allTransactions,kasirCode);
    const tx={id:uid(),tenantId:tenant.id,tenantCode:tenant.code,nota,items:cart,total,paymentMethod,
      walletCustomerId:walletCust?.id||null, walletCustomerPhone:walletCust?.phone||null,
      walletCustomerName:walletCust?.name||null, date:todayStr(),time:timeStr(),
      timestamp:new Date().toISOString(),
      kasirName:kasirName||tenant.name, kasirCode:kasirCode||""};

    try{
      if(paymentMethod==="wallet"&&walletCust){
        const result=await onUpdateCustomerBalance(
          walletCust.id,
          -total,
          (balBefore,balAfter)=>({
            id:uid(),customerId:walletCust.id,customerPhone:walletCust.phone,customerName:walletCust.name,
            type:"payment",amount:total,balanceBefore:balBefore,balanceAfter:balAfter,
            tenantId:tenant.id,tenantName:tenant.name,nota,
            items:cart.map(it=>({menuCode:it.menuCode,menuName:it.menuName,qty:it.qty,price:it.price})),
            timestamp:new Date().toISOString(),date:todayStr(),time:timeStr(),
          })
        );
        tx.walletBalanceAfter=result.balance;
      }

      // ── Baru simpan record transaksi (selalu langsung ke server, TIDAK ada antrian offline) ──
      try{
        await onSaveTx([...allTransactions,tx]);
      }catch(txErr){
        // Saldo SUDAH terpotong tapi transaksi gagal tersimpan — kasus kritis, beri tahu jelas
        console.error("Transaksi gagal simpan SETELAH saldo terpotong:",txErr);
        setCheckoutLoading(false);
        submittingRef.current=false;
        alert(`⚠️ PERHATIAN! Saldo pelanggan SUDAH terpotong (Rp ${idr(total)}), TAPI catatan transaksi GAGAL tersimpan.\n\nNota: ${nota}\nJANGAN potong saldo lagi. Screenshot pesan ini dan laporkan ke Super Admin untuk dicatat manual.\n\nDetail: ${txErr.message}`);
        return;
      }

      if(paymentMethod==="wallet") closeScanner();
      clearTimeout(uiTimeoutId);
      setLastNota(tx);setPrinted(false);setCart([]);
      setCheckoutLoading(false);
      submittingRef.current=false;
    }catch(e){
      clearTimeout(uiTimeoutId);
      console.error("Checkout gagal:",e);
      setCheckoutLoading(false);
      submittingRef.current=false;
      setNetToast("Transaksi Gagal, Jaringan Kurang Baik. Silahkan coba lagi setelah jaringan baik.");
    }
  };

  const [sendStatus,setSendStatus]=useState("");
  const [pendingWaResend,setPendingWaResend]=useState(null);

  const doPrint=async()=>{
    setSendStatus("⏳ Mengirim struk...");
    const lines=lastNota.items.map(it=>
      `[${it.menuCode}] ${it.menuName} x${it.qty} = ${idr(it.qty*it.price)}`
    ).join("\n");
    const receiptText=
`*${settings?.bazaarName||"BazaarPOS"}*
${tenant.code} - ${tenant.name}
---------------------------
Nota : ${lastNota.nota}
Tgl  : ${lastNota.date} ${lastNota.time}
Bayar: Saldo${lastNota.walletCustomerName?"\nPlgn : "+lastNota.walletCustomerName:""}
---------------------------
${lines}
---------------------------
*TOTAL: ${idr(lastNota.total)}*${lastNota.walletBalanceAfter!=null?"\nSisa : "+idr(lastNota.walletBalanceAfter):""}
---------------------------
${settings?.receiptFooter1||"Terima kasih!"}
${waSignature(tenant.name)}`;

    try{
      let sent=false;
      if(settings?.fonnteToken&&lastNota.walletCustomerPhone){
        sent=await sendWhatsApp({
          token:settings.fonnteToken,
          phone:lastNota.walletCustomerPhone,
          message:receiptText
        });
        if(sent){
          setSendStatus("✅ Struk terkirim ke WhatsApp pelanggan!");
          setPrinted(true);
          setTimeout(()=>{setLastNota(null);setPrinted(false);setSendStatus("");},1500);
          return;
        }
      }
      // Fallback: JANGAN window.open() otomatis (rawan diblokir setelah jeda jaringan
      // lambat) — tampilkan tombol kirim manual yang pasti berfungsi karena diklik
      // langsung oleh kasir.
      setPendingWaResend({phone:lastNota.walletCustomerPhone||"",message:receiptText,name:lastNota.walletCustomerName||""});
      setSendStatus("⚠️ WA otomatis gagal — tekan tombol kirim manual di bawah.");
      setPrinted(true);
    }catch(e){
      console.error("doPrint error:",e);
      setSendStatus("⚠️ Gagal kirim: "+e.message+" — coba lagi atau pilih Transaksi Baru.");
      setPrinted(true);
    }
  };

  return(
    <div>
      {/* ── Modal QR Scanner ── */}
      {showScanner&&(
        <Modal title="📷 Scan QR Pelanggan" onClose={closeScanner}>
          <p style={{color:"#6b7280",fontSize:13,margin:"0 0 12px"}}>Arahkan kamera ke QR Code kartu pelanggan.</p>
          {!scanPhone&&(
            <div style={{position:"relative",borderRadius:14,overflow:"hidden",background:"#000",marginBottom:12,height:240}}>
              <video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover"}} playsInline muted/>
              {/* Viewfinder overlay */}
              <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
                <div style={{width:180,height:180,border:"3px solid #ea580c",borderRadius:12,boxShadow:"0 0 0 2000px rgba(0,0,0,.4)"}}/>
              </div>
            </div>
          )}
          {scanError&&<div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:10,padding:"10px 14px",color:"#dc2626",fontWeight:600,fontSize:13,marginBottom:12}}>❌ {scanError}</div>}

          {/* Info pelanggan + keypad PIN */}
          {scanPhone&&!scanError&&(()=>{
            const cust=scannedCust||customers.find(c=>c.id===scanPhone)||customers.find(c=>c.phone===scanPhone);
            if(!cust) return <div style={{background:"#fef2f2",borderRadius:12,padding:"12px 16px",marginBottom:12}}><p style={{margin:0,color:"#dc2626",fontWeight:600,fontSize:14}}>❌ Pelanggan tidak ditemukan</p></div>;
            return(
              <div>
                {/* Info pelanggan */}
                <div style={{background:cust.balance>=total?"#f0fdf4":"#fef2f2",borderRadius:12,padding:"12px 16px",marginBottom:12}}>
                  <p style={{margin:"0 0 4px",fontWeight:800,fontSize:16,color:"#14532d"}}>✅ {cust.name}</p>
                  <p style={{margin:"0 0 4px",color:"#6b7280",fontSize:13}}>📱 {cust.phone}</p>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8,paddingTop:8,borderTop:"1px dashed #dcfce7"}}>
                    <div><p style={{margin:0,color:"#6b7280",fontSize:12}}>Saldo</p><p style={{margin:"2px 0 0",fontWeight:900,color:cust.balance>=total?"#16a34a":"#dc2626",fontSize:18}}>{idr(cust.balance)}</p></div>
                    <div style={{textAlign:"right"}}><p style={{margin:0,color:"#6b7280",fontSize:12}}>Total belanja</p><p style={{margin:"2px 0 0",fontWeight:900,color:"#ea580c",fontSize:18}}>{idr(total)}</p></div>
                  </div>
                  {cust.balance<total&&<p style={{marginTop:8,color:"#dc2626",fontSize:13,fontWeight:600,textAlign:"center"}}>⚠️ Saldo tidak cukup</p>}
                </div>

                {/* Keypad PIN */}
                {cust.balance>=total&&cust.pin&&(
                  <div style={{marginBottom:12}}>
                    <p style={{textAlign:"center",fontWeight:700,color:"#374151",fontSize:14,margin:"0 0 10px"}}>🔐 Masukkan PIN</p>
                    {/* Tampilan 4 kotak PIN */}
                    <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:8}}>
                      {[0,1,2,3].map(i=>(
                        <div key={i} style={{width:50,height:60,background:pinInput.length>i?"#4c1d95":"#f9fafb",border:`2px solid ${pinInput.length>i?"#7c3aed":"#e5e7eb"}`,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:"#fff",transition:"all .15s"}}>
                          {pinInput.length>i?"●":""}
                        </div>
                      ))}
                    </div>
                    {pinError&&<p style={{textAlign:"center",color:"#dc2626",fontSize:13,fontWeight:600,margin:"4px 0 8px"}}>{pinError}</p>}
                    {/* Numpad */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,maxWidth:220,margin:"0 auto"}}>
                      {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k,i)=>(
                        <button key={i} onClick={()=>{
                          if(k==="")return;
                          if(k==="⌫"){setPinInput(p=>p.slice(0,-1));setPinError("");}
                          else if(pinInput.length<4){setPinInput(p=>p+k);setPinError("");}
                        }}
                          style={{padding:"14px 0",background:k==="⌫"?"#fef2f2":k===""?"transparent":"#f9fafb",color:k==="⌫"?"#dc2626":"#1c0a00",border:`1px solid ${k==="⌫"?"#fca5a5":k===""?"transparent":"#e5e7eb"}`,borderRadius:12,fontSize:20,fontWeight:700,cursor:k===""?"default":"pointer",fontFamily:"'Plus Jakarta Sans',sans-serif",visibility:k===""?"hidden":"visible"}}>
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <div style={{display:"flex",gap:10}}>
            <button onClick={closeScanner} disabled={checkoutLoading} style={{...btnSec,flex:1,opacity:checkoutLoading?0.5:1,cursor:checkoutLoading?"not-allowed":"pointer"}}>Batal</button>
            {scanPhone&&(customers.find(c=>c.id===scanPhone)||customers.find(c=>c.phone===scanPhone))&&(customers.find(c=>c.id===scanPhone)||customers.find(c=>c.phone===scanPhone)).balance>=total&&(pinInput.length===4||!(customers.find(c=>c.id===scanPhone)||customers.find(c=>c.phone===scanPhone)).pin)?(
              <button onClick={handleWalletPay} disabled={checkoutLoading}
                style={{flex:2,padding:"13px",background:checkoutLoading?"#86efac":"#16a34a",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:checkoutLoading?"not-allowed":"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
                onMouseOver={e=>{if(!checkoutLoading)e.currentTarget.style.background="#15803d";}} onMouseOut={e=>{if(!checkoutLoading)e.currentTarget.style.background="#16a34a";}}>
                {checkoutLoading?(<><span style={{display:"inline-block",animation:"spin 1s linear infinite"}}>⏳</span> Memproses...</>):`✅ Bayar ${idr(total)}`}
              </button>
            ):(
              <button onClick={()=>{setScanPhone("");setScanError("");startScanner();}} disabled={checkoutLoading}
                style={{flex:2,padding:"13px",background:"#ea580c",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:checkoutLoading?"not-allowed":"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
                onMouseOver={e=>e.currentTarget.style.background="#c2410c"} onMouseOut={e=>e.currentTarget.style.background="#ea580c"}>
                🔄 Scan Ulang
              </button>
            )}
          </div>
        </Modal>
      )}

      <NetToast msg={netToast} onClose={()=>setNetToast("")}/>
      {/* ── Nota Sukses ── */}
      {lastNota&&(
        <Modal title="" onClose={()=>{}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10,background:"#f0fdf4",borderRadius:12,padding:"10px 14px"}}>
            <div style={{fontSize:28}}>
              {"✅"}
            </div>
            <div style={{flex:1}}>
              <p style={{margin:0,fontWeight:800,fontSize:15,color:"#14532d"}}>Transaksi Selesai</p>
              <p style={{margin:"2px 0 0",fontSize:11,color:"#16a34a",fontWeight:600}}>Tersimpan di server • Nota: <strong style={{color:"#1c0a00"}}>{lastNota.nota}</strong></p>
            </div>
            <PayBadge method={lastNota.paymentMethod}/>
          </div>

          {/* Info pelanggan jika bayar wallet */}
          {lastNota.paymentMethod==="wallet"&&lastNota.walletCustomerName&&(
            <div style={{background:"#f5f3ff",border:"1px solid #ddd6fe",borderRadius:10,padding:"8px 12px",marginBottom:8}}>
              <p style={{margin:0,fontSize:12,color:"#7c3aed",fontWeight:700}}>🪙 Bayar Saldo</p>
              <p style={{margin:"2px 0 0",fontSize:13,fontWeight:700,color:"#1c0a00"}}>{lastNota.walletCustomerName}</p>
              <p style={{margin:"2px 0 0",fontSize:12,color:"#6b7280"}}>Sisa saldo: <strong style={{color:"#7c3aed"}}>{idr(lastNota.walletBalanceAfter??0)}</strong></p>
            </div>
          )}

          <div style={{background:"#f9fafb",borderRadius:10,padding:"8px 12px",marginBottom:8,maxHeight:120,overflowY:"auto",WebkitOverflowScrolling:"touch"}}>
            {lastNota.items.map((it,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",fontSize:12,borderBottom:i<lastNota.items.length-1?"1px dashed #e5e7eb":"none"}}>
                <span style={{color:"#374151",flex:1,marginRight:8}}><span style={{color:"#9ca3af"}}>[{it.menuCode}]</span> {it.menuName} <strong>×{it.qty}</strong></span>
                <span style={{fontWeight:700,color:"#1c0a00",whiteSpace:"nowrap"}}>{idr(it.qty*it.price)}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",marginTop:6,paddingTop:6,borderTop:"2px solid #dcfce7",fontWeight:800,fontSize:13}}>
              <span style={{color:"#374151"}}>TOTAL</span>
              <span style={{color:"#16a34a"}}>{idr(lastNota.total)}</span>
            </div>
          </div>

          {sendStatus&&<div style={{background:sendStatus.startsWith("✅")?"#f0fdf4":sendStatus.startsWith("📥")?"#eff6ff":"#fef3c7",border:`1px solid ${sendStatus.startsWith("✅")?"#bbf7d0":sendStatus.startsWith("📥")?"#bae6fd":"#fbbf24"}`,borderRadius:10,padding:"8px 12px",marginBottom:8,fontSize:12,fontWeight:600,color:sendStatus.startsWith("✅")?"#16a34a":sendStatus.startsWith("📥")?"#0284c7":"#92400e",textAlign:"center"}}>{sendStatus}</div>}
          <WaFallbackCard pending={pendingWaResend} onDismiss={()=>{setPendingWaResend(null);setLastNota(null);setPrinted(false);setSendStatus("");}}/>

          <p style={{textAlign:"center",color:"#9ca3af",fontSize:11,margin:"0 0 8px"}}>Pilih salah satu untuk melanjutkan:</p>

          {/* Pilihan utama (default, lebih besar): lanjut tanpa kirim WA — pelanggan cek riwayat di link kartunya sendiri */}
          <button onClick={()=>{setLastNota(null);setPrinted(false);setSendStatus("");setPendingWaResend(null);}}
            style={{width:"100%",padding:"16px",background:"#16a34a",color:"#fff",border:"none",borderRadius:13,fontSize:16,fontWeight:800,cursor:"pointer",marginBottom:10,display:"flex",alignItems:"center",justifyContent:"center",gap:10,fontFamily:"'Plus Jakarta Sans',sans-serif",boxShadow:"0 4px 14px rgba(22,163,74,.35)"}}
            onMouseOver={e=>e.currentTarget.style.background="#15803d"} onMouseOut={e=>e.currentTarget.style.background="#16a34a"}>
            ➕ Transaksi Baru
          </button>
          <p style={{textAlign:"center",color:"#9ca3af",fontSize:11,margin:"-4px 0 10px"}}>Pelanggan bisa cek struk di link kartu saldonya</p>

          {/* Pilihan kedua: kirim struk WA, lalu otomatis lanjut transaksi baru */}
          <button onClick={doPrint} disabled={sendStatus.includes("⏳")}
            style={{width:"100%",padding:"11px",background:"#fff",color:"#16a34a",border:"2px solid #bbf7d0",borderRadius:11,fontSize:13,fontWeight:700,cursor:sendStatus.includes("⏳")?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
            onMouseOver={e=>{if(!sendStatus.includes("⏳"))e.currentTarget.style.background="#f0fdf4";}} onMouseOut={e=>e.currentTarget.style.background="#fff"}>
            {sendStatus.includes("⏳")?"⏳ Mengirim...":printed?"🔄 Kirim Ulang Struk":"💬 Kirim Struk via WhatsApp"}
          </button>
        </Modal>
      )}

      <h2 style={{margin:"0 0 14px",fontSize:17,fontWeight:800,color:"#14532d"}}>Pilih Menu</h2>
      {menus.length===0?<EmptyState icon="🍽️" text="Belum ada menu. Tambahkan di tab Menu."/>:
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12,marginBottom:16}}>
          {menus.map(m=>(
            <button key={m.id} onClick={()=>addToCart(m)} className="card-hover btn-press"
              style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:14,padding:14,cursor:"pointer",textAlign:"left",transition:"all .2s"}}>
              <div style={{fontSize:10,color:"#9ca3af",fontWeight:600,marginBottom:4}}>[{m.code}]</div>
              <div style={{fontWeight:700,color:"#1c0a00",fontSize:14,lineHeight:1.3}}>{m.name}</div>
              <div style={{color:"#16a34a",fontWeight:800,fontSize:16,marginTop:8}}>{idr(m.price)}</div>
              <div style={{marginTop:6,fontSize:11,color:"#6b7280",background:"#f0fdf4",borderRadius:6,padding:"3px 8px",display:"inline-block"}}>+ Tambah</div>
            </button>
          ))}
        </div>}

      {cart.length>0&&(
        <div style={{background:"#fff",borderRadius:18,padding:18,boxShadow:"0 8px 32px rgba(22,163,74,.15)",border:"1px solid #dcfce7",position:"sticky",bottom:10}}>
          <h3 style={{margin:"0 0 12px",color:"#14532d",fontSize:15,fontWeight:800}}>🛒 Keranjang</h3>
          <div style={{maxHeight:180,overflowY:"auto",marginBottom:12}}>
            {cart.map(item=>(
              <div key={item.menuId} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid #f0fdf4"}}>
                <div style={{flex:1}}><p style={{margin:0,fontWeight:600,color:"#1c0a00",fontSize:13}}>{item.menuName}</p><p style={{margin:"1px 0 0",color:"#6b7280",fontSize:12}}>{idr(item.price)} /pcs</p></div>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <button onClick={()=>updQty(item.menuId,item.qty-1)} style={{width:28,height:28,borderRadius:"50%",background:"#fef2f2",color:"#dc2626",border:"none",cursor:"pointer",fontWeight:800,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                  <span style={{width:26,textAlign:"center",fontWeight:700,color:"#1c0a00",fontSize:14}}>{item.qty}</span>
                  <button onClick={()=>updQty(item.menuId,item.qty+1)} style={{width:28,height:28,borderRadius:"50%",background:"#dcfce7",color:"#16a34a",border:"none",cursor:"pointer",fontWeight:800,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderTop:"2px solid #dcfce7",paddingTop:12,marginBottom:12}}>
            <div><p style={{color:"#6b7280",fontSize:12,margin:0}}>Total Bayar</p><p style={{color:"#16a34a",fontWeight:900,fontSize:22,margin:"2px 0 0"}}>{idr(total)}</p></div>
          </div>
          <p style={{margin:"0 0 8px",fontSize:12,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:".05em"}}>Cara Bayar</p>

          {/* Tombol Bayar Saldo (scan QR) — satu-satunya metode aktif */}
          <button onClick={()=>startScanner()} className="btn-press"
            style={{width:"100%",padding:"16px",background:"linear-gradient(135deg,#4c1d95,#7c3aed)",color:"#fff",border:"none",borderRadius:14,fontSize:17,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,boxShadow:"0 4px 16px rgba(124,58,237,.35)",fontFamily:"'Plus Jakarta Sans',sans-serif"}}
            onMouseOver={e=>e.currentTarget.style.background="linear-gradient(135deg,#3b0764,#6d28d9)"} onMouseOut={e=>e.currentTarget.style.background="linear-gradient(135deg,#4c1d95,#7c3aed)"}>
            <span style={{fontSize:22}}>🪙</span> Bayar dengan Saldo
          </button>

          {/* E-Money & Cash — dinonaktifkan, kode tetap ada */}
          {/* <button onClick={()=>handleCheckout("emoney")}>E-Money</button> */}
          {/* <button onClick={()=>handleCheckout("cash")}>Cash</button> */}
        </div>
      )}
    </div>
  );
}

// ─── Tenant Menu Manager ──────────────────────────────────────────────────────
function TenantMenuMgr({tenant,menus,allMenus,allTransactions,orders,onSaveMenus}){
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState({code:"",name:"",price:""});
  const usedIds=new Set(allTransactions.flatMap(tx=>tx.items.map(it=>it.menuId)));
  const genCode=()=>{
    // Pakai kode tenant (sudah unik) sebagai prefix menu
    // Format: {TENANT_CODE}-{nomor urut 3 digit}
    // Contoh: DG-001, T001-002, WM-003
    const prefix=tenant.code.trim().toUpperCase();
    const pattern=new RegExp(`^${prefix}-(\\d+)$`);
    const nums=menus
      .map(m=>{ const match=m.code.match(pattern); return match?parseInt(match[1]):0; })
      .filter(n=>n>0);
    const next=(nums.length>0?Math.max(...nums):0)+1;
    return `${prefix}-${String(next).padStart(3,"0")}`;
  };
  const openAdd=()=>{setForm({code:genCode(),name:"",price:""});setEditing(null);setShowForm(true);};
  const openEdit=m=>{
    if(usedIds.has(m.id)){alert("❌ Menu yang sudah dipakai dalam transaksi tidak bisa diedit!");return;}
    setForm({code:m.code,name:m.name,price:m.price.toString()});setEditing(m.id);setShowForm(true);
  };
  const save=async()=>{
    if(!form.code||!form.name||!form.price){alert("Semua field harus diisi!");return;}
    const price=parseInt(form.price);if(isNaN(price)||price<=0){alert("Harga tidak valid!");return;}
    if(!editing&&menus.find(m=>m.code===form.code)){alert("Kode menu sudah ada!");return;}
    const p={code:form.code,name:form.name,price};
    try{
      await onSaveMenus(editing?allMenus.map(m=>m.id===editing?{...m,...p}:m):[...allMenus,{id:uid(),tenantId:tenant.id,...p}]);
      setShowForm(false);
    }catch(e){
      alert(`❌ GAGAL MENYIMPAN! Menu tidak tersimpan. Cek koneksi, lalu coba lagi.\n(${e.message})`);
    }
  };
  const del=async m=>{
    if(usedIds.has(m.id)){alert("❌ Menu tidak bisa dihapus karena sudah digunakan dalam transaksi!");return;}
    if(!window.confirm("Hapus menu ini?"))return;
    try{ await onSaveMenus(allMenus.filter(x=>x.id!==m.id)); }
    catch(e){ alert("❌ GAGAL HAPUS! "+e.message); }
  };
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div><h2 style={{margin:0,fontSize:17,fontWeight:800,color:"#14532d"}}>Kelola Menu</h2><p style={{color:"#6b7280",margin:"3px 0 0",fontSize:13}}>{menus.length} item menu</p></div>
        <button onClick={openAdd} style={{background:"#16a34a",color:"#fff",border:"none",borderRadius:10,padding:"9px 14px",fontWeight:700,cursor:"pointer",fontSize:13}} onMouseOver={e=>e.currentTarget.style.background="#15803d"} onMouseOut={e=>e.currentTarget.style.background="#16a34a"}>+ Tambah</button>
      </div>
      {showForm&&<Modal title={editing?"Edit Menu":"Tambah Menu Baru"} onClose={()=>setShowForm(false)} accent="#16a34a">
        <FI label="Kode Menu" placeholder="M001" value={form.code} onChange={v=>setForm({...form,code:v.toUpperCase()})} accent="#16a34a"/>
        <FI label="Nama Menu" placeholder="Nasi Goreng Spesial" value={form.name} onChange={v=>setForm({...form,name:v})} accent="#16a34a"/>
        <FI label="Harga (Rp)" placeholder="15000" value={form.price} onChange={v=>setForm({...form,price:v})} money accent="#16a34a"/>
        <div style={{display:"flex",gap:10,marginTop:8}}>
          <button onClick={()=>setShowForm(false)} style={btnSec}>Batal</button>
          <button onClick={save} style={{flex:1,padding:"12px",background:"#16a34a",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}} onMouseOver={e=>e.currentTarget.style.background="#15803d"} onMouseOut={e=>e.currentTarget.style.background="#16a34a"}>Simpan</button>
        </div>
      </Modal>}
      {menus.length===0?<EmptyState icon="🍽️" text="Belum ada menu."/>:
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {menus.map(m=>{const used=usedIds.has(m.id);return(
            <div key={m.id} style={{background:"#fff",border:"1px solid #dcfce7",borderRadius:14,padding:"13px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                  <span style={{background:"#f0fdf4",color:"#16a34a",fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:18,border:"1px solid #dcfce7"}}>{m.code}</span>
                  {used&&<span style={{background:"#f0f9ff",color:"#0284c7",fontSize:10,fontWeight:600,padding:"2px 7px",borderRadius:10}}>🔒 Ada di transaksi</span>}
                </div>
                <p style={{fontWeight:700,color:"#1c0a00",margin:0,fontSize:14}}>{m.name}</p>
                <p style={{color:"#16a34a",fontWeight:800,margin:"4px 0 0",fontSize:14}}>{idr(m.price)}</p>
              </div>
              <div style={{display:"flex",gap:7}}>
                <button onClick={()=>openEdit(m)} title={used?"Tidak bisa diedit":""} style={{padding:"7px 11px",background:used?"#f9fafb":"#eff6ff",color:used?"#9ca3af":"#2563eb",border:"none",borderRadius:9,cursor:used?"not-allowed":"pointer",fontWeight:600,fontSize:12}}>✏️</button>
                <button onClick={()=>del(m)} title={used?"Tidak bisa dihapus":""} style={{padding:"7px 11px",background:used?"#f9fafb":"#fef2f2",color:used?"#9ca3af":"#dc2626",border:"none",borderRadius:9,cursor:used?"not-allowed":"pointer",fontWeight:600,fontSize:12}}>🗑️</button>
              </div>
            </div>
          );})}
        </div>}
    </div>
  );
}

// ─── Tenant History ────────────────────────────────────────────────────────────
function TenantHistory({transactions,tenant,settings}){
  const [filterDate,setFilterDate]=useState(todayStr());
  const [sending,setSending]=useState(null); // id transaksi yang sedang dikirim

  const sendReceiptWA=async(tx)=>{
    setSending(tx.id);
    const lines=tx.items.map(it=>
      `[${it.menuCode}] ${it.menuName} x${it.qty} = ${idr(it.qty*it.price)}`
    ).join("\n");
    const receiptText=
`*${settings?.bazaarName||"BazaarPOS"}*
${tenant.code} - ${tenant.name}
---------------------------
Nota : ${tx.nota}
Tgl  : ${tx.date} ${tx.time}
Bayar: Saldo${tx.walletCustomerName?"\nPlgn : "+tx.walletCustomerName:""}
---------------------------
${lines}
---------------------------
*TOTAL: ${idr(tx.total)}*${tx.walletBalanceAfter!=null?"\nSisa : "+idr(tx.walletBalanceAfter):""}
---------------------------
${settings?.receiptFooter1||"Terima kasih!"}
${waSignature(tenant.name)}`;

    let sent=false;
    if(settings?.fonnteToken&&tx.walletCustomerPhone){
      sent=await sendWhatsApp({token:settings.fonnteToken,phone:tx.walletCustomerPhone,message:receiptText});
    }
    // Fallback: buka WA langsung ke nomor pelanggan
    if(!sent){
      if(tx.walletCustomerPhone){
        const waPhone=tx.walletCustomerPhone.replace(/\D/g,"");
        const target=waPhone.startsWith("0")?"62"+waPhone.slice(1):waPhone;
        window.open(`https://wa.me/${target}?text=${encodeURIComponent(receiptText)}`,"_blank");
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(receiptText)}`,"_blank");
      }
    }
    setSending(null);
  };
  const filtered=[...transactions.filter(t=>t.date===filterDate&&!t.refunded)].sort((a,b)=>{const ta=a.timestamp?new Date(a.timestamp).getTime():0;const tb=b.timestamp?new Date(b.timestamp).getTime():0;return tb-ta;});
  const tot=filtered.reduce((s,t)=>s+t.total,0);


  const bname=settings?.bazaarName||"BazaarPOS";
  const f1=settings?.receiptFooter1||"Terima kasih!";
  const f2=settings?.receiptFooter2||"Selamat menikmati :)";

  const exportXls=()=>{
    const rows=[];
    filtered.forEach(tx=>tx.items.forEach((it,i)=>rows.push([i===0?tx.nota:"",i===0?tx.date:"",i===0?tx.time:"",i===0?"Saldo":"",it.menuCode,it.menuName,it.qty,it.price,it.qty*it.price,i===0?tx.total:""])));
    exportToExcel({filename:`Riwayat-${tenant?.code}-${filterDate}.xlsx`,sheets:[{name:"Riwayat",headers:["No Nota","Tanggal","Jam","Pembayaran","Kode Menu","Nama Menu","Qty","Harga","Subtotal","Total Nota"],rows}]});
  };

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <h2 style={{margin:0,fontSize:17,fontWeight:800,color:"#14532d"}}>Riwayat Transaksi</h2>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <DP value={filterDate} onChange={setFilterDate} accent="#16a34a"/>
          {filtered.length>0&&<button onClick={exportXls} style={{background:"#16a34a",color:"#fff",border:"none",borderRadius:10,padding:"8px 12px",fontWeight:700,cursor:"pointer",fontSize:12,fontFamily:"'Plus Jakarta Sans',sans-serif"}} onMouseOver={e=>e.currentTarget.style.background="#15803d"} onMouseOut={e=>e.currentTarget.style.background="#16a34a"}>📥 Excel</button>}
        </div>
      </div>
      {filtered.length>0&&<>
        <div style={{background:"linear-gradient(135deg,#14532d,#16a34a)",borderRadius:14,padding:16,color:"#fff",marginBottom:12}}>
          <p style={{margin:0,color:"#bbf7d0",fontSize:12}}>Omzet Hari Ini</p>
          <p style={{margin:"4px 0 8px",fontSize:26,fontWeight:800}}>{idr(tot)}</p>
          <p style={{margin:0,color:"#bbf7d0",fontSize:12}}>{filtered.length} transaksi</p>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr",gap:10,marginBottom:14}}>
          <div style={{background:"#f5f0ff",border:"2px solid #c4b5fd",borderRadius:12,padding:12,textAlign:"center"}}>
            <p style={{margin:"0 0 3px",color:"#4c1d95",fontSize:11,fontWeight:700}}>🪙 TOTAL SALDO TRANSAKSI</p>
            <p style={{margin:"0 0 2px",color:"#4c1d95",fontWeight:900,fontSize:18}}>{idr(tot)}</p>
            <p style={{margin:0,color:"#7c3aed",fontSize:11}}>{filtered.length} transaksi</p>
          </div>
        </div>
      </>}
      {filtered.length===0?<EmptyState icon="📜" text="Tidak ada transaksi pada tanggal ini."/>:
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {filtered.map(tx=>(
            <div key={tx.id} style={{background:"#fff",border:"1px solid #dcfce7",borderRadius:14,padding:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,flexWrap:"wrap",gap:6}}>
                <div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:4}}>
                    <Bdg color="#f0fdf4" tc="#16a34a" bc="#bbf7d0" label={`#${tx.nota}`}/>
                    <PayBadge method={tx.paymentMethod}/>
                  </div>
                  {tx.walletCustomerName&&<p style={{color:"#7c3aed",fontSize:12,margin:"2px 0 2px",fontWeight:700}}>👤 {tx.walletCustomerName}</p>}
                  <p style={{color:"#9ca3af",fontSize:11,margin:0}}>{tx.date} • {tx.time}</p>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <p style={{fontWeight:800,color:"#16a34a",fontSize:17,margin:0}}>{idr(tx.total)}</p>
                  <button onClick={()=>sendReceiptWA(tx)} disabled={sending===tx.id}
                    style={{padding:"6px 10px",background:"#16a34a",color:"#fff",border:"none",borderRadius:8,cursor:sending===tx.id?"not-allowed":"pointer",fontSize:12,fontWeight:700,fontFamily:"'Plus Jakarta Sans',sans-serif",opacity:sending===tx.id?0.7:1}}
                    onMouseOver={e=>e.currentTarget.style.background="#15803d"} onMouseOut={e=>e.currentTarget.style.background="#16a34a"}>
                    {sending===tx.id?"⏳":"💬"} {sending===tx.id?"Mengirim...":"Kirim Ulang Struk"}
                  </button>
                </div>
              </div>
              <div style={{borderTop:"1px dashed #dcfce7",paddingTop:8}}>
                {tx.items.map((it,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"3px 0",color:"#374151"}}>
                    <span><span style={{color:"#9ca3af"}}>[{it.menuCode}]</span> {it.menuName} <span style={{fontWeight:600}}>×{it.qty}</span></span>
                    <span style={{fontWeight:600}}>{idr(it.qty*it.price)}</span>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",borderTop:"1px solid #f0fdf4",marginTop:7,paddingTop:7,fontWeight:700,fontSize:13}}>
                <span style={{color:"#374151"}}>TOTAL</span><span style={{color:"#16a34a"}}>{idr(tx.total)}</span>
              </div>
            </div>
          ))}
        </div>}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CUSTOMER CARD PAGE LOADER — fetch SEKALI SAJA (bukan realtime) saat halaman
// dibuka atau di-refresh, untuk meringankan beban koneksi ke database. Halaman
// publik ini TIDAK subscribe ke 9 koleksi sekaligus seperti aplikasi utama —
// hanya ambil 3 dokumen yang benar-benar dibutuhkan untuk kartu pelanggan.
// ═════════════════════════════════════════════════════════════════════════════
function CustomerCardPageLoader({phone}){
  const [data,setData]=useState(null);
  const [loaded,setLoaded]=useState(false);
  const [fetchError,setFetchError]=useState("");
  const [refreshKey,setRefreshKey]=useState(0);
  const [refreshing,setRefreshing]=useState(false);
  const [lastUpdated,setLastUpdated]=useState(null);
  const [justRefreshed,setJustRefreshed]=useState(false);

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      if(refreshKey>0) setRefreshing(true); else setLoaded(false);
      setFetchError("");
      try{
        // Fetch sekali — hanya 3 dokumen yang dipakai kartu pelanggan (bukan 9 realtime listener)
        const [customers,walletLogs,settings]=await Promise.all([
          db.get("bzr_customers"),
          db.get("bzr_wallet_logs"),
          db.get("bzr_settings"),
        ]);
        if(cancelled)return;
        setData({customers:customers||[],walletLogs:walletLogs||[],settings:{...DEF,...(settings||{})}});
        setLastUpdated(new Date());
        if(refreshKey>0){ setJustRefreshed(true); setTimeout(()=>setJustRefreshed(false),2000); }
      }catch(e){
        if(!cancelled) setFetchError("Gagal memuat data. Cek koneksi internet lalu coba refresh lagi.");
      }
      if(!cancelled){ setLoaded(true); setRefreshing(false); }
    })();
    return()=>{cancelled=true;};
  },[refreshKey]);

  if(!loaded) return(
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#4c1d95,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center",color:"#fff"}}>
        <div style={{fontSize:40,marginBottom:12}}>⏳</div>
        <p style={{fontWeight:700,fontSize:16}}>Memuat data...</p>
      </div>
    </div>
  );

  if(fetchError) return(
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#4c1d95,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"#fff",borderRadius:24,padding:40,maxWidth:380,width:"100%",textAlign:"center"}}>
        <div style={{fontSize:52,marginBottom:12}}>📡</div>
        <h2 style={{color:"#dc2626",margin:"0 0 8px"}}>Gagal Memuat Data</h2>
        <p style={{color:"#6b7280",fontSize:14,marginBottom:16}}>{fetchError}</p>
        <button onClick={()=>setRefreshKey(k=>k+1)} style={{padding:"10px 20px",background:"#4c1d95",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:14}}>🔄 Coba Lagi</button>
      </div>
    </div>
  );

  return <CustomerCardPage phone={phone} settings={data.settings} customers={data.customers} walletLogs={data.walletLogs}
    onRefresh={()=>setRefreshKey(k=>k+1)} refreshing={refreshing} lastUpdated={lastUpdated} justRefreshed={justRefreshed}/>;
}

// ═════════════════════════════════════════════════════════════════════════════
// CUSTOMER CARD PAGE — halaman publik ?card=PHONE
// ═════════════════════════════════════════════════════════════════════════════
function CustomerCardPage({phone,settings,customers,walletLogs,onRefresh,refreshing,lastUpdated,justRefreshed}){
  // Cari customer by ID (format baru, aman) atau phone (backward compat QR lama)
  const param=(phone||"").trim();
  const customer=customers.find(c=>c.id===param)||customers.find(c=>c.phone===param)||customers.find(c=>c.phone===param.replace(/\D/g,""));
  const bazaarName=settings?.bazaarName||"BazaarPOS";
  // Share link selalu pakai customer ID — tidak expose nomor HP
  const shareUrl=customer?`${window.location.origin}${window.location.pathname}?card=${customer.id}`:window.location.href;
  const waShare=`https://wa.me/?text=${encodeURIComponent(`Cek saldo kamu di ${bazaarName}:\n${shareUrl}`)}`;
  const [expandedTx,setExpandedTx]=useState(null);
  const [showAllTx,setShowAllTx]=useState(false);

  const idr2=n=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",minimumFractionDigits:0}).format(n||0);

  if(!customer) return(
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#4c1d95,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"#fff",borderRadius:24,padding:40,maxWidth:380,width:"100%",textAlign:"center"}}>
        <div style={{fontSize:52,marginBottom:12}}>❌</div>
        <h2 style={{color:"#dc2626",margin:"0 0 8px"}}>Pelanggan Tidak Ditemukan</h2>
        <p style={{color:"#6b7280",fontSize:14}}>Nomor {phone} belum terdaftar di {bazaarName}.</p>
        <p style={{color:"#9ca3af",fontSize:13,marginTop:8}}>Silakan hubungi kasir untuk mendaftar.</p>
      </div>
    </div>
  );

  const balanceColor=customer.balance>0?"#16a34a":"#dc2626";
  // QR code berisi customer ID (bukan nomor HP)
  const qrUrl=`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(customer.id)}&bgcolor=ffffff&color=4c1d95&margin=10`;

  return(
    <div style={{minHeight:"100vh",background:"linear-gradient(145deg,#4c1d95,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
      {/* Decorative blobs */}
      <div style={{position:"fixed",top:-100,right:-100,width:300,height:300,borderRadius:"50%",background:"rgba(255,255,255,.07)"}}/>
      <div style={{position:"fixed",bottom:-80,left:-80,width:250,height:250,borderRadius:"50%",background:"rgba(255,255,255,.05)"}}/>

      <div style={{width:"100%",maxWidth:400,animation:"slideUp .4s ease"}}>
        {/* Header */}
        <div style={{textAlign:"center",marginBottom:20}}>
          <p style={{color:"rgba(255,255,255,.8)",fontSize:14,margin:0,fontWeight:600}}>🏪 {bazaarName}</p>
          <p style={{color:"rgba(255,255,255,.6)",fontSize:12,margin:"4px 0 0"}}>Kartu Saldo Pelanggan</p>
          {onRefresh&&(
            <button onClick={onRefresh} disabled={refreshing}
              style={{marginTop:10,padding:"6px 16px",background:justRefreshed?"#16a34a":"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",borderRadius:20,cursor:refreshing?"not-allowed":"pointer",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:6,transition:"background .3s"}}>
              <span style={{display:"inline-block",animation:refreshing?"spin 1s linear infinite":"none"}}>{justRefreshed?"✅":"🔄"}</span> {refreshing?"Memuat...":justRefreshed?"Data Terbaru!":"Refresh Data"}
            </button>
          )}
          {lastUpdated&&!refreshing&&(
            <p style={{color:"rgba(255,255,255,.5)",fontSize:11,margin:"6px 0 0"}}>Terakhir diperbarui: {lastUpdated.toLocaleTimeString("id-ID")}</p>
          )}
        </div>

        {/* Card utama */}
        <div style={{background:"#fff",borderRadius:24,overflow:"hidden",boxShadow:"0 32px 80px rgba(0,0,0,.3)"}}>
          {/* Card header */}
          <div style={{background:"linear-gradient(135deg,#4c1d95,#7c3aed)",padding:"24px 24px 20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <p style={{color:"rgba(255,255,255,.7)",fontSize:12,margin:"0 0 6px",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em"}}>Nama Pelanggan</p>
                <h2 style={{color:"#fff",fontSize:22,fontWeight:800,margin:0}}>{customer.name}</h2>
                <p style={{color:"rgba(255,255,255,.7)",fontSize:13,margin:"6px 0 0"}}>📱 {customer.phone}</p>
              </div>
              <div style={{width:44,height:44,borderRadius:12,background:"rgba(255,255,255,.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🪙</div>
            </div>
          </div>

          {/* Saldo real-time */}
          <div style={{padding:"20px 24px",borderBottom:"1px solid #f3f4f6"}}>
            <p style={{color:"#9ca3af",fontSize:12,margin:"0 0 6px",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em"}}>Saldo Tersedia</p>
            <p style={{fontSize:36,fontWeight:900,color:balanceColor,margin:0,letterSpacing:-1}}>
              {idr2(customer.balance)}
            </p>
            <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:"#9ca3af"}}/>
              <p style={{color:"#9ca3af",fontSize:12,margin:0}}>Data per {lastUpdated?lastUpdated.toLocaleTimeString("id-ID"):"-"} — tekan "Refresh Data" untuk update terbaru</p>
            </div>
            {customer.balance<=0&&(
              <div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:10,padding:"8px 12px",marginTop:12}}>
                <p style={{color:"#dc2626",fontSize:13,fontWeight:600,margin:0}}>⚠️ Saldo habis — silakan top up di kasir</p>
              </div>
            )}
          </div>

          {/* QR Code */}
          <div style={{padding:"20px 24px",textAlign:"center",borderBottom:"1px solid #f3f4f6"}}>
            <p style={{color:"#374151",fontSize:13,fontWeight:700,margin:"0 0 14px"}}>QR Code untuk Transaksi</p>
            <div style={{display:"inline-block",background:"#fff",borderRadius:16,padding:12,boxShadow:"0 4px 16px rgba(0,0,0,.1)",border:"2px solid #f5f3ff"}}>
              <img src={qrUrl} alt="QR Code" width={160} height={160} style={{display:"block",borderRadius:8}}/>
            </div>
            <p style={{color:"#9ca3af",fontSize:12,margin:"10px 0 0"}}>Tunjukkan QR ini ke tenant saat transaksi</p>
          </div>

          {/* Info & Share */}
          <div style={{padding:"16px 24px"}}>
            {/* Last top up info */}
            {(()=>{
              const lastTopUp=(walletLogs||[]).filter(l=>l.customerId===customer.id&&l.type==="topup").sort((a,b)=>b.timestamp?.localeCompare(a.timestamp)||0)[0];
              return lastTopUp?(
                <div style={{background:"#f0fdf4",borderRadius:12,padding:"10px 14px",marginBottom:12}}>
                  <p style={{margin:"0 0 2px",color:"#16a34a",fontSize:12,fontWeight:700}}>💰 Top Up Terakhir</p>
                  <p style={{margin:"0 0 2px",color:"#1c0a00",fontSize:13,fontWeight:700}}>+{idr(lastTopUp.amount)}</p>
                  <p style={{margin:0,color:"#6b7280",fontSize:12}}>{new Date(lastTopUp.timestamp).toLocaleString("id-ID")} • oleh <strong>{lastTopUp.adminName||"Admin"}</strong></p>
                </div>
              ):null;
            })()}

            {/* Recent transactions */}
            {(()=>{
              const allTx=(walletLogs||[]).filter(l=>l.customerId===customer.id&&l.type==="payment").sort((a,b)=>b.timestamp?.localeCompare(a.timestamp)||0);
              const visibleTx=showAllTx?allTx:allTx.slice(0,5);
              return allTx.length>0?(
                <div style={{marginBottom:14}}>
                  <p style={{color:"#374151",fontSize:13,fontWeight:700,margin:"0 0 8px"}}>🛒 Transaksi Terakhir <span style={{color:"#9ca3af",fontWeight:400,fontSize:12}}>(tap untuk detail)</span></p>
                  <div style={{maxHeight:showAllTx?320:"none",overflowY:showAllTx?"auto":"visible",WebkitOverflowScrolling:"touch",paddingRight:showAllTx?4:0}}>
                    {visibleTx.map(tx=>(
                      <div key={tx.id} style={{borderRadius:10,marginBottom:6,overflow:"hidden",border:"1px solid #f3f4f6"}}>
                        {/* Header baris - bisa diklik */}
                        <button onClick={()=>setExpandedTx(expandedTx===tx.id?null:tx.id)}
                          style={{width:"100%",background:"#f9fafb",border:"none",padding:"9px 12px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                          <div style={{textAlign:"left"}}>
                            <p style={{margin:0,color:"#374151",fontSize:13,fontWeight:600}}>{tx.tenantName||"Tenant"}</p>
                            <p style={{margin:"1px 0 0",color:"#9ca3af",fontSize:11}}>{tx.nota} • {tx.date} {tx.time}</p>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <p style={{margin:0,color:"#ea580c",fontWeight:800,fontSize:14}}>-{idr(tx.amount)}</p>
                            <span style={{color:"#9ca3af",fontSize:12,transform:expandedTx===tx.id?"rotate(180deg)":"rotate(0)",transition:"transform .2s",display:"inline-block"}}>▼</span>
                          </div>
                        </button>
                        {/* Detail item - muncul saat diklik */}
                        {expandedTx===tx.id&&(
                          <div style={{background:"#fff",padding:"10px 12px",borderTop:"1px dashed #f3f4f6"}}>
                            {(()=>{
                              const items=tx.items||[];
                              return items.length>0?items.map((it,i)=>(
                                <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:12,borderBottom:i<items.length-1?"1px dashed #f9fafb":"none"}}>
                                  <span style={{color:"#374151"}}><span style={{color:"#9ca3af"}}>[{it.menuCode}]</span> {it.menuName} x{it.qty}</span>
                                  <span style={{fontWeight:700,color:"#1c0a00"}}>{idr(it.qty*it.price)}</span>
                                </div>
                              )):<p style={{color:"#9ca3af",fontSize:12,margin:0,textAlign:"center"}}>Detail tidak tersedia</p>;
                            })()}
                            <div style={{display:"flex",justifyContent:"space-between",marginTop:8,paddingTop:8,borderTop:"2px solid #f3f4f6",fontWeight:800,fontSize:13}}>
                              <span style={{color:"#374151"}}>TOTAL</span>
                              <span style={{color:"#ea580c"}}>{idr(tx.amount)}</span>
                            </div>
                            <p style={{color:"#9ca3af",fontSize:11,margin:"6px 0 0",textAlign:"center"}}>Sisa saldo: <strong style={{color:"#4c1d95"}}>{idr(tx.balanceAfter)}</strong></p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {allTx.length>5&&(
                    <button onClick={()=>setShowAllTx(p=>!p)}
                      style={{width:"100%",padding:"8px",background:"#f5f3ff",color:"#7c3aed",border:"1px solid #ddd6fe",borderRadius:10,cursor:"pointer",fontSize:12,fontWeight:700,marginTop:4,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
                      {showAllTx?"▲ Tampilkan 5 Terbaru Saja":`▼ Lihat Semua Transaksi (${allTx.length})`}
                    </button>
                  )}
                </div>
              ):null;
            })()}

            <p style={{color:"#6b7280",fontSize:12,margin:"0 0 12px",textAlign:"center"}}>
              ID: <span style={{fontFamily:"monospace",color:"#374151",fontWeight:600}}>{customer.id?.slice(0,8).toUpperCase()}</span>
            </p>

            {/* Tombol share WA */}
            <a href={waShare} target="_blank" rel="noopener noreferrer"
              style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,width:"100%",padding:"14px",background:"#16a34a",color:"#fff",border:"none",borderRadius:14,fontWeight:700,fontSize:15,textDecoration:"none",boxSizing:"border-box",fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
              <span style={{fontSize:20}}>💬</span> Share ke WhatsApp
            </a>

            {/* Tombol copy link */}
            <button onClick={()=>{navigator.clipboard.writeText(shareUrl).then(()=>alert("✅ Link berhasil disalin!"));}}
              style={{width:"100%",padding:"12px",background:"#f5f3ff",color:"#7c3aed",border:"1px solid #ddd6fe",borderRadius:12,fontWeight:600,cursor:"pointer",fontSize:14,marginTop:8,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
              🔗 Salin Link Kartu
            </button>
          </div>
        </div>

        {/* Footer */}
        <p style={{textAlign:"center",color:"rgba(255,255,255,.5)",fontSize:12,marginTop:16}}>
          Powered by {bazaarName} • BazaarPOS
        </p>
      </div>
    </div>
  );
}

// ─── Back Button Confirmation ─────────────────────────────────────────────────
function useBackConfirm(active=true){
  const [showConfirm,setShowConfirm]=useState(false);
  const [pendingBack,setPendingBack]=useState(false);

  useEffect(()=>{
    if(!active)return;
    // Push state agar back button bisa dicegat
    window.history.pushState({backGuard:true},document.title);

    const handlePop=(e)=>{
      // Cegat back button
      window.history.pushState({backGuard:true},document.title);
      setShowConfirm(true);
    };
    window.addEventListener("popstate",handlePop);
    return()=>window.removeEventListener("popstate",handlePop);
  },[active]);

  const BackConfirmModal=()=>showConfirm?(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:99999,padding:20}}>
      <div className="pop-in" style={{background:"#fff",borderRadius:20,padding:28,maxWidth:360,width:"100%",textAlign:"center",boxShadow:"0 24px 60px rgba(0,0,0,.3)"}}>
        <div style={{fontSize:48,marginBottom:12}}>⚠️</div>
        <h3 style={{margin:"0 0 8px",fontSize:18,fontWeight:800,color:"#1c0a00"}}>Keluar dari Aplikasi?</h3>
        <p style={{color:"#6b7280",fontSize:14,margin:"0 0 20px"}}>Anda yakin ingin keluar dari aplikasi ini?</p>
        <div style={{display:"flex",gap:12}}>
          <button onClick={()=>setShowConfirm(false)}
            style={{flex:1,padding:"13px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:15,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
            Tidak
          </button>
          <button onClick={()=>{
            setShowConfirm(false);
            // Kembali ke halaman login (logout)
            window.history.go(-2);
            setTimeout(()=>window.location.replace(window.location.pathname),200);
          }}
            style={{flex:1,padding:"13px",background:"#dc2626",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:15,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
            onMouseOver={e=>e.currentTarget.style.background="#b91c1c"} onMouseOut={e=>e.currentTarget.style.background="#dc2626"}>
            Ya, Keluar
          </button>
        </div>
      </div>
    </div>
  ):null;

  return {BackConfirmModal};
}

// ═════════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════
function Modal({title,onClose,children,accent="#ea580c"}){
  const backdropRef=useRef(null);
  useEffect(()=>{
    // Reset scroll: window DAN scroll internal backdrop modal itu sendiri.
    // Backdrop pakai overflowY:"scroll" sendiri (position:fixed), jadi window.scrollTo
    // saja tidak cukup — backdrop bisa membawa posisi scroll dari modal sebelumnya,
    // membuat bagian atas modal baru (judul/header) tidak terlihat sampai discroll manual.
    window.scrollTo({top:0,behavior:"instant"});
    if(backdropRef.current) backdropRef.current.scrollTop=0;
  },[]);
  // Render lewat Portal langsung ke <body> — supaya position:fixed TIDAK terpengaruh
  // oleh transform/overflow di elemen induk manapun (penyebab umum modal "terpotong"
  // di sebagian device/browser mobile, dimana sebagian layar di bawah modal kosong
  // menampilkan background halaman di belakangnya).
  return createPortal(
    <div
      ref={backdropRef}
      onClick={e=>{if(e.target===e.currentTarget&&onClose)onClose();}}
      style={{
        position:"fixed",top:0,left:0,right:0,bottom:0,
        height:"100dvh",
        background:"rgba(0,0,0,.65)",
        zIndex:9999,
        overflowY:"scroll",
        WebkitOverflowScrolling:"touch",
        padding:"16px 16px 48px",
        boxSizing:"border-box",
      }}>
      <div
        className="pop-in"
        style={{
          background:"#fff",
          borderRadius:20,
          boxShadow:"0 20px 60px rgba(0,0,0,.3)",
          width:"100%",
          maxWidth:460,
          margin:"0 auto",
          padding:20,
          position:"relative",
        }}>
        {title&&<h3 style={{margin:"0 0 14px",fontSize:17,fontWeight:800,color:"#1c0a00"}}>{title}</h3>}
        {children}
      </div>
    </div>,
    document.body
  );
}

function FI({label,placeholder,value,onChange,disabled,type="text",accent="#ea580c",money=false}){
  const [f,setF]=useState(false);
  const inputRef=useRef(null);

  // ── Format ribuan: "50000" → "50.000" (tampilan saja, value tetap angka mentah) ──
  const fmt=v=>{
    const d=String(v||"").replace(/\D/g,"");
    return d?d.replace(/\B(?=(\d{3})+(?!\d))/g,"."):""
  };

  if(money){
    const displayVal=fmt(value);
    const handleChange=e=>{
      const el=e.target;
      const before=el.selectionStart; // posisi kursor SEBELUM reformat
      const oldVal=el.value;
      const raw=oldVal.replace(/\./g,"").replace(/\D/g,""); // angka mentah saja
      const newFormatted=raw?raw.replace(/\B(?=(\d{3})+(?!\d))/g,"."):""
      // Hitung berapa dot yang ada sebelum kursor di string lama vs baru
      const dotsBeforeCursor_old=(oldVal.slice(0,before).match(/\./g)||[]).length;
      const dotsBeforeCursor_new=(newFormatted.slice(0,before).match(/\./g)||[]).length;
      const cursorAdjust=dotsBeforeCursor_new-dotsBeforeCursor_old;
      const newCursor=Math.max(0,before+cursorAdjust);
      onChange(raw);
      // Restore posisi kursor setelah React re-render (rAF = setelah paint)
      requestAnimationFrame(()=>{
        if(inputRef.current){
          inputRef.current.setSelectionRange(newCursor,newCursor);
        }
      });
    };
    return(
      <div style={{marginBottom:13}}>
        <label style={{display:"block",fontWeight:600,color:"#374151",fontSize:13,marginBottom:5}}>{label}</label>
        <div style={{position:"relative"}}>
          <input
            ref={inputRef}
            inputMode="numeric"
            autoComplete="off"
            placeholder={placeholder?fmt(String(placeholder).replace(/\D/g,""))||placeholder:placeholder}
            value={displayVal}
            disabled={disabled}
            onFocus={()=>setF(true)} onBlur={()=>setF(false)}
            onChange={handleChange}
            style={{width:"100%",border:`2px solid ${f?accent:"#e5e7eb"}`,borderRadius:11,padding:"11px 46px 11px 14px",fontSize:14,outline:"none",fontFamily:"'Plus Jakarta Sans',sans-serif",background:disabled?"#f9fafb":"#fff",color:"#111",transition:"border-color .2s",boxSizing:"border-box"}}/>
          <span style={{position:"absolute",right:13,top:"50%",transform:"translateY(-50%)",fontSize:12,fontWeight:700,color:"#9ca3af",pointerEvents:"none",userSelect:"none"}}>Rp</span>
        </div>
      </div>
    );
  }

  return(
    <div style={{marginBottom:13}}>
      <label style={{display:"block",fontWeight:600,color:"#374151",fontSize:13,marginBottom:5}}>{label}</label>
      <input type={type} placeholder={placeholder} value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}
        onFocus={()=>setF(true)} onBlur={()=>setF(false)}
        style={{width:"100%",border:`2px solid ${f?accent:"#e5e7eb"}`,borderRadius:11,padding:"11px 14px",fontSize:14,outline:"none",fontFamily:"'Plus Jakarta Sans',sans-serif",background:disabled?"#f9fafb":"#fff",color:"#111",transition:"border-color .2s",boxSizing:"border-box"}}/>
    </div>
  );
}

function Bdg({color,tc,bc,label}){
  return <span style={{background:color,color:tc,border:`1px solid ${bc}`,fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20}}>{label}</span>;
}

function DP({value,onChange,accent="#ea580c"}){
  const [f,setF]=useState(false);
  return(
    <input type="date" value={value} onChange={e=>onChange(e.target.value)}
      onFocus={()=>setF(true)} onBlur={()=>setF(false)}
      style={{border:`2px solid ${f?accent:"#e5e7eb"}`,borderRadius:11,padding:"8px 13px",fontSize:14,outline:"none",fontFamily:"'Plus Jakarta Sans',sans-serif",transition:"border-color .2s",background:"#fff",color:"#111"}}/>
  );
}

function Pill({active,color,onClick,label}){
  return <button onClick={onClick} style={{padding:"7px 14px",borderRadius:20,border:"2px solid",borderColor:active?color:"#e5e7eb",background:active?"#fff7ed":"#fff",color:active?color:"#6b7280",fontWeight:700,cursor:"pointer",fontSize:13,transition:"all .15s",fontFamily:"'Plus Jakarta Sans',sans-serif"}}>{label}</button>;
}

function Sec({label,children}){
  return(
    <div style={{background:"#fff",borderRadius:18,padding:22,boxShadow:"0 2px 12px rgba(0,0,0,.06)",marginBottom:16}}>
      <p style={{fontWeight:700,color:"#ea580c",fontSize:13,margin:"0 0 14px",borderLeft:"4px solid #ea580c",paddingLeft:10}}>{label}</p>
      {children}
    </div>
  );
}

function EmptyState({icon,text}){
  return(
    <div style={{textAlign:"center",padding:"50px 20px",color:"#9ca3af"}}>
      <div style={{fontSize:48,marginBottom:10}}>{icon}</div>
      <p style={{fontSize:14,margin:0}}>{text}</p>
    </div>
  );
}

const btnOrg={flex:1,padding:"12px 20px",background:"#ea580c",color:"#fff",border:"none",borderRadius:12,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'Plus Jakarta Sans',sans-serif",transition:"background .2s"};
const btnSec={flex:1,padding:"12px 20px",background:"#fff",color:"#6b7280",border:"2px solid #e5e7eb",borderRadius:12,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'Plus Jakarta Sans',sans-serif"};
