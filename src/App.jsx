import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";

// ─── Fonts & Global Style ─────────────────────────────────────────────────────
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
  .fade-in{animation:fadeIn .35s ease forwards}
  .slide-up{animation:slideUp .4s ease forwards}
  .pop-in{animation:pop .25s ease forwards}
  .card-hover{transition:all .2s ease}
  .card-hover:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.1)}
  .btn-press:active{transform:scale(.95)}
  .pulse{animation:pulse 1.8s infinite}
  @keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}
  input[type="date"]{color:#111!important}
`;
document.head.appendChild(_gs);

// ─── Storage ──────────────────────────────────────────────────────────────────


// ─── Utilities ────────────────────────────────────────────────────────────────
const idr = n => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",minimumFractionDigits:0}).format(n);
const todayStr = () => new Date().toISOString().split("T")[0];
const timeStr = () => new Date().toTimeString().slice(0,5);
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const genNota = (tenantCode, allTx) => {
  const d = todayStr().replace(/-/g,"");
  const n = allTx.filter(t=>t.tenantCode===tenantCode&&t.date===todayStr()).length+1;
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

// ─── Offline Queue ────────────────────────────────────────────────────────────
const offQ = {
  add(tx){ const q=JSON.parse(localStorage.getItem("bzr_offq")||"[]"); q.push(tx); localStorage.setItem("bzr_offq",JSON.stringify(q)); },
  get(){ return JSON.parse(localStorage.getItem("bzr_offq")||"[]"); },
  clear(){ localStorage.removeItem("bzr_offq"); },
};

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEF = {
  bazaarName:"Bazaar 2026", receiptFooter1:"Terima kasih!", receiptFooter2:"Selamat menikmati :)",
  saUser:"superadmin", saPass:"superadmin123", resetPass:"reset123",
  autoBackup:false, backupInterval:30,
};

// ─── Payment ──────────────────────────────────────────────────────────────────
const PAY = {
  emoney:{label:"💳 E-Money",color:"#6d28d9",bg:"#f5f3ff",border:"#ddd6fe"},
  cash:  {label:"💵 Cash",   color:"#b45309",bg:"#fffbeb",border:"#fde68a"},
};
function PayBadge({method}){
  const p=PAY[method]||PAY.cash;
  return <span style={{background:p.bg,color:p.color,border:`1px solid ${p.border}`,fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20}}>{p.label}</span>;
}

// ─── Excel Export ─────────────────────────────────────────────────────────────
function exportToExcel({filename,sheets}){
  const run=X=>{const wb=X.utils.book_new();sheets.forEach(({name,headers,rows})=>{const ws=X.utils.aoa_to_sheet([headers,...rows]);X.utils.book_append_sheet(wb,ws,name.slice(0,31));});X.writeFile(wb,filename);};
  if(window.XLSX){run(window.XLSX);return;}
  const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";s.onload=()=>run(window.XLSX);document.head.appendChild(s);
}

// ─── Thermal Print ────────────────────────────────────────────────────────────
function printThermal({tx,tenantName,tenantCode,bazaarName="BazaarPOS",footer1="Terima kasih!",footer2="Selamat menikmati :)"}){
  const payLabel=tx.paymentMethod==="emoney"?"E-Money":"Cash";
  const rows=tx.items.map(it=>`
    <tr><td colspan="2" style="padding:1px 0;font-size:12px;word-break:break-word">[${it.menuCode}] ${it.menuName}</td></tr>
    <tr><td style="padding:0 0 5px;font-size:12px">  ${it.qty} x ${idr(it.price)}</td>
        <td style="text-align:right;padding:0 0 5px;font-size:12px;font-weight:700">${idr(it.qty*it.price)}</td></tr>`).join("");
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

// ─── Bluetooth Printer ────────────────────────────────────────────────────────
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
export default function App(){
  const [screen,setScreen]=useState("login");
  const [session,setSession]=useState(null);
  const [tenants,setTenants]=useState([]);
  const [menus,setMenus]=useState([]);
  const [transactions,setTransactions]=useState([]);
  const [settings,setSettings]=useState(DEF);
  const [admins,setAdmins]=useState([]);
  const [alerts,setAlerts]=useState([]);
  const [loaded,setLoaded]=useState(false);
  const bkRef=useRef(null);

  useEffect(()=>{
    (async()=>{
      const t=await db.get("bzr_tenants")||[];
      const m=await db.get("bzr_menus")||[];
      const tx=await db.get("bzr_transactions")||[];
      const s=await db.get("bzr_settings")||{};
      const a=await db.get("bzr_admins")||[];
      const al=await db.get("bzr_alerts")||[];
      setTenants(t);setMenus(m);setTransactions(tx);
      setSettings({...DEF,...s});setAdmins(a);setAlerts(al);
      setLoaded(true);
    })();
  },[]);

  useEffect(()=>{
    clearInterval(bkRef.current);
    if(!settings.autoBackup)return;
    bkRef.current=setInterval(()=>doLocalBackup({tenants,menus,transactions,settings,admins}),(settings.backupInterval||30)*60*1000);
    return()=>clearInterval(bkRef.current);
  },[settings.autoBackup,settings.backupInterval,tenants,menus,transactions,admins]);

  useEffect(()=>{
    if(screen!=="superadmin"&&screen!=="admin")return;
    const iv=setInterval(async()=>{const al=await db.get("bzr_alerts")||[];setAlerts(al);},8000);
    return()=>clearInterval(iv);
  },[screen]);

  useEffect(()=>{
    const sync=async()=>{
      const q=offQ.get(); if(!q.length)return;
      const fresh=await db.get("bzr_transactions")||[];
      const merged=[...fresh,...q.filter(qt=>!fresh.find(t=>t.id===qt.id))];
      await db.set("bzr_transactions",merged); setTransactions(merged); offQ.clear();
    };
    window.addEventListener("online",sync);
    return()=>window.removeEventListener("online",sync);
  },[]);

  const saveTenants=async d=>{setTenants(d);await db.set("bzr_tenants",d);};
  const saveMenus=async d=>{setMenus(d);await db.set("bzr_menus",d);};
  const saveTx=async d=>{setTransactions(d);await db.set("bzr_transactions",d);};
  const saveSettings=async d=>{setSettings(d);await db.set("bzr_settings",d);};
  const saveAdmins=async d=>{setAdmins(d);await db.set("bzr_admins",d);};
  const saveAlerts=async d=>{setAlerts(d);await db.set("bzr_alerts",d);};
  const logout=()=>{setSession(null);setScreen("login");};

  // Restore atomik — update semua state sekaligus lalu simpan ke storage
  const restoreBackup=async(bk)=>{
    const newTenants     = Array.isArray(bk.tenants)     ? bk.tenants     : tenants;
    const newMenus       = Array.isArray(bk.menus)       ? bk.menus       : menus;
    const newTx          = Array.isArray(bk.transactions) ? bk.transactions : transactions;
    const newAdmins      = Array.isArray(bk.admins)      ? bk.admins      : admins;
    const newSettings    = bk.settings ? {...DEF,...bk.settings} : settings;
    // Update semua state React sekaligus
    setTenants(newTenants);
    setMenus(newMenus);
    setTransactions(newTx);
    setAdmins(newAdmins);
    setSettings(newSettings);
    // Simpan ke storage
    await db.set("bzr_tenants",     newTenants);
    await db.set("bzr_menus",       newMenus);
    await db.set("bzr_transactions",newTx);
    await db.set("bzr_admins",      newAdmins);
    await db.set("bzr_settings",    newSettings);
  };

  const unreadAlerts=alerts.filter(a=>!a.read);

  const commonProps={
    tenants,menus,transactions,settings,admins,
    alerts:unreadAlerts, allAlerts:alerts,
    onSaveTenants:saveTenants, onSaveMenus:saveMenus, onSaveTx:saveTx,
    onSaveSettings:saveSettings, onSaveAdmins:saveAdmins, onSaveAlerts:saveAlerts,
    onRestoreBackup:restoreBackup,
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
      onSaveMenus={saveMenus} onSaveTx={saveTx} onSaveAlerts={saveAlerts} alerts={alerts}
      onLogout={logout}/>);

  return <LoginScreen tenants={tenants} admins={admins} settings={settings}
    onLogin={(type,data)=>{setSession({type,data});setScreen(type);}}/>;
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
    else onLogin("tenant",t);
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
  const {tenants,transactions,settings,alerts,allAlerts,onSaveAlerts,onSaveSettings,onLogout}=props;
  const [tab,setTab]=useState("tenants");
  const [filterDate,setFilterDate]=useState(todayStr());
  const [editBazaar,setEditBazaar]=useState(false);
  const [bazaarInput,setBazaarInput]=useState(settings.bazaarName||"");
  const [showAlertPop,setShowAlertPop]=useState(true);
  const todayTx=transactions.filter(t=>t.date===todayStr());

  const tabs=[
    {k:"tenants",i:"🏪",l:"Tenant"},{k:"admins",i:"🔑",l:"Admin"},
    {k:"transactions",i:"📋",l:"Transaksi"},{k:"report",i:"📑",l:"Laporan"},
    {k:"summary",i:"📊",l:"Rekap"},{k:"settings",i:"⚙️",l:"Pengaturan"},
    {k:"backup",i:"💾",l:"Backup"},{k:"reset",i:"🗑️",l:"Reset Data"},
  ];

  const saveBazaar=()=>{onSaveSettings({...settings,bazaarName:bazaarInput});setEditBazaar(false);};
  const dismissAlerts=async()=>{await onSaveAlerts(allAlerts.map(a=>({...a,read:true})));setShowAlertPop(false);};

  return(
    <div style={{minHeight:"100vh",background:"#fafaf9"}}>
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
          <button onClick={onLogout} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",borderRadius:10,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:600}}>Keluar</button>
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
        {tab==="transactions"&&<AdminTransactions {...props} filterDate={filterDate} setFilterDate={setFilterDate}/>}
        {tab==="report"&&<AdminTenantReport {...props} filterDate={filterDate} setFilterDate={setFilterDate}/>}
        {tab==="summary"&&<AdminSummary {...props} filterDate={filterDate} setFilterDate={setFilterDate}/>}
        {tab==="settings"&&<SettingsPanel {...props}/>}
        {tab==="backup"&&<BackupPanel {...props} isSuperAdmin={true}/>}
        {tab==="reset"&&<ResetPanel {...props}/>}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN BIASA DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════
function AdminDashboard(props){
  const {tenants,transactions,settings,alerts,allAlerts,onSaveAlerts,adminData,onLogout}=props;
  const [tab,setTab]=useState("tenants");
  const [filterDate,setFilterDate]=useState(todayStr());
  const [showAlertPop,setShowAlertPop]=useState(true);
  const todayTx=transactions.filter(t=>t.date===todayStr());
  const tabs=[
    {k:"tenants",i:"🏪",l:"Tenant"},{k:"transactions",i:"📋",l:"Transaksi"},
    {k:"report",i:"📑",l:"Laporan"},{k:"summary",i:"📊",l:"Rekap"},{k:"backup",i:"💾",l:"Backup"},
  ];
  const dismissAlerts=async()=>{await onSaveAlerts(allAlerts.map(a=>({...a,read:true})));setShowAlertPop(false);};

  return(
    <div style={{minHeight:"100vh",background:"#fafaf9"}}>
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
          <button onClick={onLogout} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",borderRadius:10,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:600}}>Keluar</button>
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
        {tab==="transactions"&&<AdminTransactions {...props} filterDate={filterDate} setFilterDate={setFilterDate}/>}
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
  const [form,setForm]=useState({username:"",password:"",name:""});
  const openAdd=()=>{setForm({username:"",password:"",name:""});setEditing(null);setShowForm(true);};
  const openEdit=a=>{setForm({username:a.username,password:a.password,name:a.name});setEditing(a.id);setShowForm(true);};
  const save=()=>{
    if(!form.username||!form.password||!form.name){alert("Semua field harus diisi!");return;}
    if(!editing&&admins.find(a=>a.username===form.username)){alert("Username sudah ada!");return;}
    onSaveAdmins(editing?admins.map(a=>a.id===editing?{...a,...form}:a):[...admins,{id:uid(),...form}]);
    setShowForm(false);
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
        <div style={{display:"flex",gap:12,marginTop:8}}>
          <button onClick={()=>setShowForm(false)} style={btnSec}>Batal</button>
          <button onClick={save} style={{...btnSec,background:"#7c3aed",color:"#fff",border:"none"}}>Simpan</button>
        </div>
      </Modal>}
      {admins.length===0?<EmptyState icon="🔑" text="Belum ada admin terdaftar."/>:
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
          {admins.map(a=>(
            <div key={a.id} className="card-hover" style={{background:"#fff",border:"1px solid #f3f4f6",borderRadius:16,padding:20,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                <div style={{width:44,height:44,borderRadius:12,background:"#f5f3ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🔑</div>
                <div><p style={{fontWeight:800,fontSize:16,color:"#1c0a00",margin:0}}>{a.name}</p>
                  <p style={{color:"#7c3aed",fontSize:12,margin:"2px 0 0",fontWeight:600}}>@{a.username}</p></div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>openEdit(a)} style={{flex:1,padding:"8px",background:"#eff6ff",color:"#2563eb",border:"none",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:13}}>✏️ Edit</button>
                <button onClick={()=>{if(window.confirm("Hapus admin ini?"))onSaveAdmins(admins.filter(x=>x.id!==a.id));}} style={{flex:1,padding:"8px",background:"#fef2f2",color:"#dc2626",border:"none",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:13}}>🗑️ Hapus</button>
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
  const save=()=>{
    if(!form.code||!form.name||!form.password){alert("Semua field harus diisi!");return;}
    if(!editing&&tenants.find(t=>t.code===form.code)){alert("Kode tenant sudah ada!");return;}
    onSaveTenants(editing?tenants.map(t=>t.id===editing?{...t,...form}:t):[...tenants,{id:uid(),...form}]);
    setShowForm(false);
  };
  const del=id=>{
    if(transactions.some(t=>t.tenantId===id)){alert("❌ Tenant tidak bisa dihapus karena sudah memiliki data transaksi!");return;}
    if(window.confirm("Hapus tenant ini?")) onSaveTenants(tenants.filter(t=>t.id!==id));
  };

  return(
    <div>
      {/* ── Modal Daftar Menu Tenant ── */}
      {viewMenuOf&&(()=>{
        const tenantMenus=(menus||[]).filter(m=>m.tenantId===viewMenuOf.id);
        const todayTx=transactions.filter(t=>t.tenantId===viewMenuOf.id&&t.date===todayStr());
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
function BackupPanel({tenants,menus,transactions,settings,admins,onSaveSettings,onRestoreBackup,isSuperAdmin}){
  const [backups,setBackups]=useState(getLocalBackups());
  const [restoring,setRestoring]=useState(false);
  const [previewData,setPreviewData]=useState(null);
  const [previewSrc,setPreviewSrc]=useState("");
  const [restoreStep,setRestoreStep]=useState(0); // 0=preview, 1=konfirmasi, 2=selesai
  const [restoreErr,setRestoreErr]=useState("");
  const [restoredSummary,setRestoredSummary]=useState(null);
  const [backupMsg,setBackupMsg]=useState("");
  const fileRef=useRef(null);
  const data={tenants,menus,transactions,settings,admins};

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
          <button onClick={()=>onSaveSettings({...settings,autoBackup:!settings.autoBackup})}
            style={{padding:"8px 18px",background:settings.autoBackup?"#16a34a":"#f3f4f6",color:settings.autoBackup?"#fff":"#6b7280",border:"none",borderRadius:20,fontWeight:700,cursor:"pointer",fontSize:13,transition:"all .2s"}}>
            {settings.autoBackup?"🟢 Aktif":"⚫ Nonaktif"}
          </button>
        </div>
        {settings.autoBackup&&(
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <label style={{fontSize:13,color:"#374151",fontWeight:600}}>Interval</label>
            <select value={settings.backupInterval||30} onChange={e=>onSaveSettings({...settings,backupInterval:parseInt(e.target.value)})}
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
              {l:"Tenant",v:(previewData.tenants||[]).length,c:"#ea580c",i:"🏪"},
              {l:"Menu",  v:(previewData.menus||[]).length,  c:"#16a34a",i:"🍽️"},
              {l:"Transaksi",v:(previewData.transactions||[]).length,c:"#0284c7",i:"📋"},
              {l:"Admin", v:(previewData.admins||[]).length,  c:"#7c3aed",i:"🔑"},
            ].map(s=>(
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
              {l:"Tenant",    v:restoredSummary.tenants,    i:"🏪"},
              {l:"Menu",      v:restoredSummary.menus,      i:"🍽️"},
              {l:"Transaksi", v:restoredSummary.transactions,i:"📋"},
              {l:"Admin",     v:restoredSummary.admins,     i:"🔑"},
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
function ResetPanel({transactions,settings,onSaveTx}){
  const [pass,setPass]=useState("");
  const [unlocked,setUnlocked]=useState(false);
  const [step,setStep]=useState(0); // 0=idle, 1=konfirmasi1, 2=konfirmasi2, 3=done
  const [loading,setLoading]=useState(false);

  const tryUnlock=()=>{
    const resetPass=settings?.resetPass||"reset123";
    if(pass.trim()===resetPass){setUnlocked(true);setPass("");setStep(0);}
    else alert("❌ Password reset salah!");
  };

  const doReset=async()=>{
    setLoading(true);
    try{
      await onSaveTx([]);
      setStep(3);
    }catch(e){
      alert("❌ Gagal reset: "+e.message);
    }
    setLoading(false);
  };

  const lockBack=()=>{setUnlocked(false);setStep(0);setPass("");};

  return(
    <div style={{maxWidth:500}}>
      <h2 style={{margin:"0 0 6px",fontSize:20,fontWeight:800,color:"#dc2626"}}>🗑️ Reset Data Transaksi</h2>
      <p style={{color:"#6b7280",fontSize:13,margin:"0 0 20px"}}>Hapus SEMUA data transaksi secara permanen. Gunakan dengan sangat hati-hati.</p>

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

      {/* ── TERBUKA — IDLE ── */}
      {unlocked&&step===0&&(
        <div style={{background:"#fff",borderRadius:18,padding:24,border:"2px solid #fecaca"}}>
          <div style={{background:"#fef2f2",borderRadius:12,padding:16,marginBottom:20}}>
            <p style={{color:"#dc2626",fontWeight:700,margin:"0 0 6px",fontSize:14}}>⚠️ Perhatian!</p>
            <p style={{color:"#374151",fontSize:13,margin:0}}>Saat ini terdapat <strong style={{color:"#dc2626"}}>{transactions.length} transaksi</strong> yang akan dihapus permanen. Pastikan sudah backup sebelum melanjutkan.</p>
          </div>
          <button onClick={()=>setStep(1)}
            style={{width:"100%",padding:"14px",background:"#dc2626",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:"pointer",fontSize:15,fontFamily:"'Plus Jakarta Sans',sans-serif",marginBottom:10}}
            onMouseOver={e=>e.currentTarget.style.background="#b91c1c"} onMouseOut={e=>e.currentTarget.style.background="#dc2626"}>
            🗑️ Reset Semua Transaksi
          </button>
          <button onClick={lockBack}
            style={{width:"100%",padding:"12px",background:"#f3f4f6",color:"#6b7280",border:"none",borderRadius:12,fontWeight:600,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
            🔒 Kunci Kembali
          </button>
        </div>
      )}

      {/* ── KONFIRMASI TAHAP 1 ── */}
      {unlocked&&step===1&&(
        <div className="pop-in" style={{background:"#fff",borderRadius:18,padding:24,border:"2px solid #f97316"}}>
          <div style={{textAlign:"center",marginBottom:18}}>
            <div style={{fontSize:48,marginBottom:8}}>⚠️</div>
            <h3 style={{margin:0,fontSize:18,fontWeight:800,color:"#ea580c"}}>Konfirmasi Pertama</h3>
            <p style={{color:"#374151",fontSize:14,margin:"10px 0 0"}}>Anda yakin ingin menghapus <strong>{transactions.length} transaksi</strong>?</p>
            <p style={{color:"#9ca3af",fontSize:13,margin:"6px 0 0"}}>Tindakan ini <strong>tidak dapat dibatalkan.</strong></p>
          </div>
          <div style={{display:"flex",gap:12}}>
            <button onClick={()=>setStep(0)} style={{...btnSec,flex:1}}>Batal</button>
            <button onClick={()=>setStep(2)}
              style={{flex:1,padding:"13px",background:"#ea580c",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
              onMouseOver={e=>e.currentTarget.style.background="#c2410c"} onMouseOut={e=>e.currentTarget.style.background="#ea580c"}>
              Ya, Lanjutkan →
            </button>
          </div>
        </div>
      )}

      {/* ── KONFIRMASI TAHAP 2 ── */}
      {unlocked&&step===2&&(
        <div className="pop-in" style={{background:"#fff",borderRadius:18,padding:24,border:"2px solid #dc2626"}}>
          <div style={{textAlign:"center",marginBottom:18}}>
            <div style={{fontSize:48,marginBottom:8}}>🚨</div>
            <h3 style={{margin:0,fontSize:18,fontWeight:800,color:"#dc2626"}}>Konfirmasi Akhir</h3>
            <p style={{color:"#374151",fontSize:14,margin:"10px 0 0"}}>Ini adalah konfirmasi terakhir.</p>
            <p style={{color:"#dc2626",fontSize:14,margin:"6px 0 0",fontWeight:700}}>Semua {transactions.length} transaksi akan dihapus PERMANEN.</p>
          </div>
          <div style={{display:"flex",gap:12}}>
            <button onClick={()=>setStep(0)} style={{...btnSec,flex:1}}>Batalkan</button>
            <button onClick={doReset} disabled={loading}
              style={{flex:1,padding:"13px",background:loading?"#9ca3af":"#dc2626",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:loading?"not-allowed":"pointer",fontSize:14,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
              onMouseOver={e=>{if(!loading)e.currentTarget.style.background="#b91c1c";}} onMouseOut={e=>{if(!loading)e.currentTarget.style.background="#dc2626";}}>
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
          <p style={{color:"#6b7280",fontSize:14,margin:"0 0 20px"}}>Semua data transaksi telah dihapus.</p>
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

// ─── Admin Transactions ───────────────────────────────────────────────────────
function AdminTransactions({tenants,transactions,settings,filterDate,setFilterDate}){
  const getTn=id=>tenants.find(t=>t.id===id)||{};
  const filtered=[...transactions.filter(t=>t.date===filterDate)].sort((a,b)=>b.nota.localeCompare(a.nota));
  const bname=settings?.bazaarName||"BazaarPOS";
  const et=filtered.filter(t=>t.paymentMethod==="emoney").reduce((s,t)=>s+t.total,0);
  const ct=filtered.filter(t=>t.paymentMethod==="cash").reduce((s,t)=>s+t.total,0);
  const gt=filtered.reduce((s,t)=>s+t.total,0);

  const doPrint=()=>{
    const rows=filtered.map(tx=>{const tn=getTn(tx.tenantId);const pc=tx.paymentMethod==="emoney"?"pe":"pc";const pl=tx.paymentMethod==="emoney"?"💳 E-Money":"💵 Cash";const its=tx.items.map(it=>`[${it.menuCode}] ${it.menuName} ×${it.qty}=${idr(it.qty*it.price)}`).join("<br/>");return`<tr><td><strong>${tx.nota}</strong></td><td><strong>${tn.code||""}</strong><br/><span style="color:#6b7280;font-size:10px">${tn.name||""}</span></td><td>${tx.date}<br/>${tx.time}</td><td class="${pc}">${pl}</td><td style="font-size:10px">${its}</td><td style="text-align:right;font-weight:700">${idr(tx.total)}</td></tr>`;}).join("");
    printA4({title:"Data Transaksi Harian",subtitle:`Tanggal: ${filterDate} | Dicetak: ${new Date().toLocaleString("id-ID")}`,bazaarName:bname,bodyHtml:`<div class="sr"><div class="sb"><p class="lbl">Jumlah Tx</p><p class="val" style="color:#1c0a00">${filtered.length}</p></div><div class="sb em"><p class="lbl">💳 E-Money</p><p class="val">${idr(et)}</p></div><div class="sb cs"><p class="lbl">💵 Cash</p><p class="val">${idr(ct)}</p></div><div class="sb"><p class="lbl">Grand Total</p><p class="val">${idr(gt)}</p></div></div><div class="sec">Daftar Transaksi</div><table><thead><tr><th>No Nota</th><th>Tenant</th><th>Waktu</th><th>Pembayaran</th><th>Item</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5"><strong>TOTAL</strong></td><td style="text-align:right"><strong>${idr(gt)}</strong></td></tr></tfoot></table>`});
  };

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div><h2 style={{margin:0,fontSize:20,fontWeight:800,color:"#1c0a00"}}>Data Transaksi</h2>
          <p style={{color:"#9ca3af",margin:"4px 0 0",fontSize:13}}>{filtered.length} transaksi ditemukan</p></div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <DP value={filterDate} onChange={setFilterDate}/>
          {filtered.length>0&&<button onClick={doPrint} style={{background:"#1c0a00",color:"#fff",border:"none",borderRadius:12,padding:"10px 16px",fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Plus Jakarta Sans',sans-serif"}} onMouseOver={e=>e.currentTarget.style.background="#431407"} onMouseOut={e=>e.currentTarget.style.background="#1c0a00"}>🖨️ Print A4</button>}
        </div>
      </div>
      {filtered.length===0?<EmptyState icon="📋" text="Tidak ada transaksi pada tanggal ini."/>:
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {filtered.map(tx=>{const tn=getTn(tx.tenantId);return(
            <div key={tx.id} className="card-hover" style={{background:"#fff",border:"1px solid #f3f4f6",borderRadius:16,padding:18,boxShadow:"0 2px 8px rgba(0,0,0,.05)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
                <div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:4}}>
                    <Bdg color="#fff7ed" tc="#ea580c" bc="#fed7aa" label={tn.code||"?"}/>
                    <Bdg color="#f0fdf4" tc="#16a34a" bc="#bbf7d0" label={`#${tx.nota}`}/>
                    <PayBadge method={tx.paymentMethod}/>
                  </div>
                  <p style={{fontWeight:700,color:"#1c0a00",margin:"6px 0 2px",fontSize:14}}>{tn.name||"—"}</p>
                  <p style={{color:"#9ca3af",fontSize:12,margin:0}}>{tx.date} • {tx.time}</p>
                </div>
                <p style={{color:"#ea580c",fontWeight:800,fontSize:20,margin:0}}>{idr(tx.total)}</p>
              </div>
              <div style={{marginTop:12,borderTop:"1px dashed #f3f4f6",paddingTop:10}}>
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
  const filtered=transactions.filter(t=>t.date===filterDate);
  const actv=tenants.filter(tn=>filtered.some(t=>t.tenantId===tn.id));
  const disp=selTn==="all"?actv:actv.filter(t=>t.id===selTn);
  const COLS=["#ea580c","#0284c7","#16a34a","#7c3aed","#db2777","#ca8a04","#0891b2","#dc2626"];
  const bname=settings?.bazaarName||"BazaarPOS";

  const exportXls=()=>{
    const sheets=disp.map(tn=>{
      const txs=filtered.filter(t=>t.tenantId===tn.id).sort((a,b)=>a.nota.localeCompare(b.nota));
      const rows=[];txs.forEach(tx=>tx.items.forEach((it,i)=>rows.push([i===0?tx.nota:"",i===0?tx.date:"",i===0?tx.time:"",i===0?(tx.paymentMethod==="emoney"?"E-Money":"Cash"):"",it.menuCode,it.menuName,it.qty,it.price,it.qty*it.price,i===0?tx.total:""])));
      const em=txs.filter(t=>t.paymentMethod==="emoney").reduce((s,t)=>s+t.total,0);
      const cs=txs.filter(t=>t.paymentMethod==="cash").reduce((s,t)=>s+t.total,0);
      rows.push([],[],[`TOTAL E-MONEY`,"","","","","","","","",em],[`TOTAL CASH`,"","","","","","","","",cs],[`GRAND TOTAL`,"","","","","","","","",txs.reduce((s,t)=>s+t.total,0)]);
      return{name:tn.code,headers:["No Nota","Tanggal","Jam","Pembayaran","Kode Menu","Nama Menu","Qty","Harga","Subtotal","Total Nota"],rows};
    });
    exportToExcel({filename:`Laporan-Tenant-${filterDate}.xlsx`,sheets});
  };

  const doPrint=()=>{
    let body="";
    disp.forEach(tn=>{
      const txs=filtered.filter(t=>t.tenantId===tn.id).sort((a,b)=>a.nota.localeCompare(b.nota));
      const tt=txs.reduce((s,t)=>s+t.total,0);const em=txs.filter(t=>t.paymentMethod==="emoney").reduce((s,t)=>s+t.total,0);const cs=txs.filter(t=>t.paymentMethod==="cash").reduce((s,t)=>s+t.total,0);
      const ms={};txs.forEach(tx=>tx.items.forEach(it=>{if(!ms[it.menuCode])ms[it.menuCode]={name:it.menuName,qty:0,total:0};ms[it.menuCode].qty+=it.qty;ms[it.menuCode].total+=it.qty*it.price;}));
      const mr=Object.entries(ms).map(([c,m])=>`<tr><td>[${c}]</td><td>${m.name}</td><td style="text-align:center">${m.qty}</td><td style="text-align:right">${idr(m.total)}</td></tr>`).join("");
      const nr=txs.map(tx=>`<tr><td>${tx.nota}</td><td>${tx.time}</td><td class="${tx.paymentMethod==="emoney"?"pe":"pc"}">${tx.paymentMethod==="emoney"?"💳 E-Money":"💵 Cash"}</td><td style="font-size:10px">${tx.items.map(it=>`[${it.menuCode}] ${it.menuName} ×${it.qty}=${idr(it.qty*it.price)}`).join("<br/>")}</td><td style="text-align:right;font-weight:700">${idr(tx.total)}</td></tr>`).join("");
      body+=`<div class="th"><h3>${tn.code} — ${tn.name}</h3><p>${txs.length} transaksi &nbsp;|&nbsp; <span class="pe">💳 E-Money: ${idr(em)}</span> &nbsp;|&nbsp; <span class="pc">💵 Cash: ${idr(cs)}</span> &nbsp;|&nbsp; Total: <strong>${idr(tt)}</strong></p></div><div class="sec">Ringkasan Menu</div><table><thead><tr><th>Kode</th><th>Nama Menu</th><th style="text-align:center">Terjual</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>${mr}</tbody><tfoot><tr><td colspan="3"><strong>Total</strong></td><td style="text-align:right"><strong>${idr(tt)}</strong></td></tr></tfoot></table><div class="sec">Rincian Nota</div><table><thead><tr><th>No Nota</th><th>Jam</th><th>Pembayaran</th><th>Item</th><th style="text-align:right">Total</th></tr></thead><tbody>${nr}</tbody><tfoot><tr><td colspan="4"><strong>Total ${tn.name}</strong></td><td style="text-align:right"><strong>${idr(tt)}</strong></td></tr></tfoot></table>`;
    });
    if(selTn==="all"&&disp.length>1){const gt=filtered.reduce((s,t)=>s+t.total,0);const em=filtered.filter(t=>t.paymentMethod==="emoney").reduce((s,t)=>s+t.total,0);const cs=filtered.filter(t=>t.paymentMethod==="cash").reduce((s,t)=>s+t.total,0);body+=`<div style="background:#fff7ed;border:2px solid #ea580c;border-radius:6px;padding:12px 16px;margin-top:16px"><strong>🏆 GRAND TOTAL — ${filterDate}</strong><br/><span class="pe">💳 E-Money: ${idr(em)}</span> &nbsp;|&nbsp; <span class="pc">💵 Cash: ${idr(cs)}</span> &nbsp;|&nbsp; <strong style="color:#ea580c">Total: ${idr(gt)}</strong></div>`;}
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
            const txs=[...filtered.filter(t=>t.tenantId===tn.id)].sort((a,b)=>a.nota.localeCompare(b.nota));
            const tt=txs.reduce((s,t)=>s+t.total,0);const em=txs.filter(t=>t.paymentMethod==="emoney").reduce((s,t)=>s+t.total,0);const cs=txs.filter(t=>t.paymentMethod==="cash").reduce((s,t)=>s+t.total,0);
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
                      <span style={{fontSize:12,color:"#6d28d9",background:"#f5f3ff",border:"1px solid #ddd6fe",borderRadius:10,padding:"3px 10px",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                        <span>💳</span><span>E-Money: {idr(em)}</span>
                      </span>
                      <span style={{fontSize:12,color:"#b45309",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"3px 10px",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                        <span>💵</span><span>Cash: {idr(cs)}</span>
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
                      <div style={{background:"#f5f3ff",border:"1px solid #ddd6fe",borderRadius:10,padding:"8px 12px",flex:1}}>
                        <p style={{margin:"0 0 2px",color:"#7c3aed",fontSize:12,fontWeight:700}}>💳 E-Money</p>
                        <p style={{margin:0,color:"#4c1d95",fontWeight:800,fontSize:14}}>{idr(em)}</p>
                      </div>
                      <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"8px 12px",flex:1}}>
                        <p style={{margin:"0 0 2px",color:"#b45309",fontSize:12,fontWeight:700}}>💵 Cash</p>
                        <p style={{margin:0,color:"#78350f",fontWeight:800,fontSize:14}}>{idr(cs)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {selTn==="all"&&disp.length>1&&(()=>{const gt=filtered.reduce((s,t)=>s+t.total,0);const em=filtered.filter(t=>t.paymentMethod==="emoney").reduce((s,t)=>s+t.total,0);const cs=filtered.filter(t=>t.paymentMethod==="cash").reduce((s,t)=>s+t.total,0);return(
            <div style={{background:"#1c0a00",borderRadius:16,padding:"18px 22px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:12}}>
                <div><p style={{color:"#fed7aa",fontWeight:700,margin:0,fontSize:14}}>🏆 GRAND TOTAL</p><p style={{color:"#9ca3af",fontSize:12,margin:"2px 0 0"}}>{filtered.length} transaksi • {disp.length} tenant • {filterDate}</p></div>
                <p style={{color:"#fb923c",fontWeight:900,fontSize:26,margin:0}}>{idr(gt)}</p>
              </div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <div style={{background:"rgba(109,40,217,.25)",borderRadius:10,padding:"8px 14px",flex:1}}><p style={{margin:"0 0 2px",color:"#c4b5fd",fontSize:11,fontWeight:600}}>💳 E-Money</p><p style={{margin:0,color:"#fff",fontWeight:800,fontSize:15}}>{idr(em)}</p></div>
                <div style={{background:"rgba(180,83,9,.25)",borderRadius:10,padding:"8px 14px",flex:1}}><p style={{margin:"0 0 2px",color:"#fde68a",fontSize:11,fontWeight:600}}>💵 Cash</p><p style={{margin:0,color:"#fff",fontWeight:800,fontSize:15}}>{idr(cs)}</p></div>
              </div>
            </div>
          );})()}
        </div>}
    </div>
  );
}

// ─── Admin Summary ────────────────────────────────────────────────────────────
function AdminSummary({tenants,transactions,settings,filterDate,setFilterDate}){
  const filtered=transactions.filter(t=>t.date===filterDate);
  const gt=filtered.reduce((s,t)=>s+t.total,0);const et=filtered.filter(t=>t.paymentMethod==="emoney").reduce((s,t)=>s+t.total,0);const ct=filtered.filter(t=>t.paymentMethod==="cash").reduce((s,t)=>s+t.total,0);
  const bname=settings?.bazaarName||"BazaarPOS";
  const byTn=tenants.map(tn=>{const txs=filtered.filter(t=>t.tenantId===tn.id);return{...tn,n:txs.length,tt:txs.reduce((s,t)=>s+t.total,0),em:txs.filter(t=>t.paymentMethod==="emoney").reduce((s,t)=>s+t.total,0),cs:txs.filter(t=>t.paymentMethod==="cash").reduce((s,t)=>s+t.total,0)};}).filter(t=>t.n>0).sort((a,b)=>b.tt-a.tt);

  const exportXls=()=>{
    const sr=byTn.map(t=>[t.code,t.name,t.n,t.em,t.cs,t.tt]);
    const tr=filtered.map(tx=>{const tn=tenants.find(t=>t.id===tx.tenantId)||{};return[tx.nota,tn.code||"",tn.name||"",tx.date,tx.time,tx.paymentMethod==="emoney"?"E-Money":"Cash",tx.total];});
    exportToExcel({filename:`Rekap-${filterDate}.xlsx`,sheets:[{name:"Rekap Tenant",headers:["Kode","Nama","Jml Tx","E-Money","Cash","Total"],rows:sr},{name:"Detail Transaksi",headers:["No Nota","Kode","Nama","Tanggal","Jam","Pembayaran","Total"],rows:tr}]});
  };
  const doPrint=()=>{
    const rows=byTn.map((t,i)=>`<tr><td>${i+1}</td><td><strong>${t.code}</strong></td><td>${t.name}</td><td style="text-align:center">${t.n}</td><td class="pe" style="text-align:right">${idr(t.em)}</td><td class="pc" style="text-align:right">${idr(t.cs)}</td><td style="text-align:right;font-weight:700">${idr(t.tt)}</td></tr>`).join("");
    printA4({title:"Rekapitulasi Harian",subtitle:`Tanggal: ${filterDate} | Dicetak: ${new Date().toLocaleString("id-ID")}`,bazaarName:bname,bodyHtml:`<div class="sr"><div class="sb"><p class="lbl">Transaksi</p><p class="val" style="color:#1c0a00">${filtered.length}</p></div><div class="sb"><p class="lbl">Tenant Aktif</p><p class="val" style="color:#1c0a00">${byTn.length}</p></div><div class="sb em"><p class="lbl">💳 E-Money</p><p class="val">${idr(et)}</p></div><div class="sb cs"><p class="lbl">💵 Cash</p><p class="val">${idr(ct)}</p></div><div class="sb"><p class="lbl">Grand Total</p><p class="val">${idr(gt)}</p></div></div><div class="sec">Rekapitulasi per Tenant</div><table><thead><tr><th>#</th><th>Kode</th><th>Nama Tenant</th><th style="text-align:center">Transaksi</th><th style="text-align:right">E-Money</th><th style="text-align:right">Cash</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="3"><strong>GRAND TOTAL</strong></td><td style="text-align:center"><strong>${filtered.length}</strong></td><td class="pe" style="text-align:right"><strong>${idr(et)}</strong></td><td class="pc" style="text-align:right"><strong>${idr(ct)}</strong></td><td style="text-align:right"><strong>${idr(gt)}</strong></td></tr></tfoot></table>`});
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
      {filtered.length>0&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:18}}>
        <div style={{background:"#f5f3ff",border:"2px solid #ddd6fe",borderRadius:14,padding:16}}><p style={{margin:"0 0 4px",color:"#7c3aed",fontSize:11,fontWeight:700}}>💳 E-MONEY</p><p style={{margin:"0 0 4px",color:"#4c1d95",fontWeight:900,fontSize:20}}>{idr(et)}</p><p style={{margin:0,color:"#7c3aed",fontSize:12}}>{filtered.filter(t=>t.paymentMethod==="emoney").length} transaksi</p></div>
        <div style={{background:"#fffbeb",border:"2px solid #fde68a",borderRadius:14,padding:16}}><p style={{margin:"0 0 4px",color:"#b45309",fontSize:11,fontWeight:700}}>💵 CASH</p><p style={{margin:"0 0 4px",color:"#78350f",fontWeight:900,fontSize:20}}>{idr(ct)}</p><p style={{margin:0,color:"#b45309",fontSize:12}}>{filtered.filter(t=>t.paymentMethod==="cash").length} transaksi</p></div>
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
                    <span style={{fontSize:12,color:"#6d28d9",background:"#f5f3ff",border:"1px solid #ddd6fe",borderRadius:10,padding:"3px 10px",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                      <span>💳</span><span>E-Money: {idr(t.em)}</span>
                    </span>
                    <span style={{fontSize:12,color:"#b45309",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"3px 10px",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                      <span>💵</span><span>Cash: {idr(t.cs)}</span>
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
function TenantApp({tenant,menus,allMenus,transactions,allTransactions,settings,onSaveMenus,onSaveTx,onSaveAlerts,alerts,onLogout}){
  const [tab,setTab]=useState("pos");
  const [btPrinter,setBtPrinter]=useState(null);
  const [btConnecting,setBtConnecting]=useState(false);
  const [isOnline,setIsOnline]=useState(navigator.onLine);
  const [showEmerg,setShowEmerg]=useState(false);
  const [emergMsg,setEmergMsg]=useState("");

  useEffect(()=>{
    const on=()=>setIsOnline(true); const off=()=>setIsOnline(false);
    window.addEventListener("online",on); window.addEventListener("offline",off);
    return()=>{window.removeEventListener("online",on);window.removeEventListener("offline",off);};
  },[]);

  const connectBT=async()=>{setBtConnecting(true);const p=await connectBTPrinter();if(p){setBtPrinter(p);alert(`✅ Terhubung ke: ${p.name}`);}setBtConnecting(false);};

  const sendEmergency=async()=>{
    if(!emergMsg.trim()){alert("Tulis pesan darurat terlebih dahulu!");return;}
    const newAlert={id:uid(),tenantId:tenant.id,tenantCode:tenant.code,tenantName:tenant.name,message:emergMsg.trim(),time:new Date().toLocaleString("id-ID"),read:false};
    await onSaveAlerts([...alerts,newAlert]);
    setEmergMsg("");setShowEmerg(false);alert("✅ Pesan darurat telah dikirim ke Admin!");
  };

  return(
    <div style={{minHeight:"100vh",background:"#f0fdf4"}}>
      {!isOnline&&<div style={{background:"#dc2626",color:"#fff",textAlign:"center",padding:"8px",fontSize:13,fontWeight:700}}>⚠️ Offline — Transaksi tersimpan lokal, sync otomatis saat online</div>}

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
              {btPrinter&&<span style={{background:"rgba(255,255,255,.2)",color:"#fff",fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:20}}>🖨️ {btPrinter.name}</span>}
            </div>
            <h1 style={{color:"#fff",fontSize:18,fontWeight:800,margin:0}}>{tenant.name}</h1>
            <p style={{color:"#bbf7d0",fontSize:11,margin:"2px 0 0"}}>Tenant App • {todayStr()}</p>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{color:"#fff",fontSize:15,fontWeight:800}}>{settings?.bazaarName}</span>
            <button onClick={()=>setShowEmerg(true)} className="pulse" style={{background:"#dc2626",color:"#fff",border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>🆘</button>
            <button onClick={connectBT} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12,fontWeight:600}} disabled={btConnecting}>
              {btConnecting?"⏳":"🖨️"} {btPrinter?"Ganti BT":"Koneksi BT"}
            </button>
            <button onClick={onLogout} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12,fontWeight:600}}>Keluar</button>
          </div>
        </div>
      </div>

      <div style={{background:"#fff",borderBottom:"1px solid #e5e7eb",display:"flex"}}>
        {[{k:"pos",i:"🛒",l:"Transaksi"},{k:"menu",i:"📝",l:"Menu"},{k:"history",i:"📜",l:"Riwayat"}].map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k)} style={{flex:1,padding:"13px 4px",background:"none",border:"none",borderBottom:tab===t.k?"3px solid #16a34a":"3px solid transparent",color:tab===t.k?"#16a34a":"#6b7280",fontWeight:tab===t.k?700:500,cursor:"pointer",fontSize:13}}>
            <div>{t.i}</div><div style={{marginTop:2}}>{t.l}</div>
          </button>
        ))}
      </div>

      <div style={{padding:16,maxWidth:520,margin:"0 auto"}} className="fade-in">
        {tab==="pos"&&<TenantPOS tenant={tenant} menus={menus} allTransactions={allTransactions} onSaveTx={onSaveTx} settings={settings} isOnline={isOnline}/>}
        {tab==="menu"&&<TenantMenuMgr tenant={tenant} menus={menus} allMenus={allMenus} allTransactions={allTransactions} onSaveMenus={onSaveMenus}/>}
        {tab==="history"&&<TenantHistory transactions={transactions} tenant={tenant} settings={settings}/>}
      </div>
    </div>
  );
}

// ─── Tenant POS ───────────────────────────────────────────────────────────────
function TenantPOS({tenant,menus,allTransactions,onSaveTx,settings,isOnline}){
  const [cart,setCart]=useState([]);
  const [lastNota,setLastNota]=useState(null);
  const [printed,setPrinted]=useState(false);

  const addToCart=m=>setCart(p=>{const ex=p.find(c=>c.menuId===m.id);return ex?p.map(c=>c.menuId===m.id?{...c,qty:c.qty+1}:c):[...p,{menuId:m.id,menuCode:m.code,menuName:m.name,price:m.price,qty:1}];});
  const updQty=(id,q)=>{if(q<=0)setCart(p=>p.filter(c=>c.menuId!==id));else setCart(p=>p.map(c=>c.menuId===id?{...c,qty:q}:c));};
  const total=cart.reduce((s,c)=>s+c.price*c.qty,0);

  const handleCheckout=async pay=>{
    if(!cart.length){alert("Keranjang kosong!");return;}
    const nota=genNota(tenant.code,allTransactions);
    const tx={id:uid(),tenantId:tenant.id,tenantCode:tenant.code,nota,items:cart,total,paymentMethod:pay,date:todayStr(),time:timeStr()};
    if(isOnline){await onSaveTx([...allTransactions,tx]);}
    else{offQ.add(tx);}
    setLastNota(tx);setPrinted(false);setCart([]);
  };

  const doPrint=()=>{
    printThermal({tx:lastNota,tenantName:tenant.name,tenantCode:tenant.code,bazaarName:settings?.bazaarName||"BazaarPOS",footer1:settings?.receiptFooter1||"Terima kasih!",footer2:settings?.receiptFooter2||"Selamat menikmati :)"});
    setPrinted(true);
  };

  return(
    <div>
      {lastNota&&(
        <Modal title="" onClose={()=>{}}>
          {/* Header ringkas */}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10,background:"#f0fdf4",borderRadius:12,padding:"10px 14px"}}>
            <div style={{fontSize:28}}>{lastNota.paymentMethod==="emoney"?"💳":"💵"}</div>
            <div style={{flex:1}}>
              <p style={{margin:0,fontWeight:800,fontSize:15,color:"#14532d"}}>Transaksi Berhasil!</p>
              <p style={{margin:"2px 0 0",fontSize:12,color:"#6b7280"}}>Nota: <strong style={{color:"#1c0a00"}}>{lastNota.nota}</strong></p>
            </div>
            <PayBadge method={lastNota.paymentMethod}/>
          </div>

          {!isOnline&&<div style={{background:"#fef3c7",border:"1px solid #fbbf24",borderRadius:8,padding:"5px 10px",marginBottom:8,fontSize:11,color:"#92400e",fontWeight:600,textAlign:"center"}}>⚠️ Tersimpan offline — sync saat online</div>}

          {/* List item — max 120px scroll */}
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

          {/* Tombol cetak */}
          <button onClick={doPrint}
            style={{width:"100%",padding:"12px",background:"#1c0a00",color:"#fff",border:"none",borderRadius:11,fontSize:14,fontWeight:700,cursor:"pointer",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
            onMouseOver={e=>e.currentTarget.style.background="#431407"} onMouseOut={e=>e.currentTarget.style.background="#1c0a00"}>
            🖨️ {printed?"Cetak Ulang Struk":"Cetak Struk Thermal"}
          </button>

          {/* Tombol transaksi baru — disabled sampai struk dicetak */}
          <button onClick={()=>{setLastNota(null);setPrinted(false);}} disabled={!printed}
            style={{width:"100%",padding:"12px",background:printed?"#16a34a":"#e5e7eb",color:printed?"#fff":"#9ca3af",border:"none",borderRadius:11,fontSize:14,fontWeight:700,cursor:printed?"pointer":"not-allowed",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"'Plus Jakarta Sans',sans-serif",transition:"all .2s"}}
            onMouseOver={e=>{if(printed)e.currentTarget.style.background="#15803d";}} onMouseOut={e=>{if(printed)e.currentTarget.style.background="#16a34a";}}>
            {printed?"➕ Transaksi Baru":"🔒 Cetak Struk Dulu"}
          </button>
          {!printed&&<p style={{textAlign:"center",color:"#9ca3af",fontSize:11,margin:"5px 0 0"}}>Cetak struk terlebih dahulu</p>}
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
          <p style={{margin:"0 0 8px",fontSize:12,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:".05em"}}>Pilih Cara Bayar</p>
          <button onClick={()=>handleCheckout("emoney")} className="btn-press"
            style={{width:"100%",padding:"15px",background:"linear-gradient(135deg,#6d28d9,#7c3aed)",color:"#fff",border:"none",borderRadius:14,fontSize:16,fontWeight:800,cursor:"pointer",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"center",gap:10,boxShadow:"0 4px 16px rgba(109,40,217,.35)",fontFamily:"'Plus Jakarta Sans',sans-serif"}}
            onMouseOver={e=>e.currentTarget.style.background="linear-gradient(135deg,#5b21b6,#6d28d9)"} onMouseOut={e=>e.currentTarget.style.background="linear-gradient(135deg,#6d28d9,#7c3aed)"}>
            <span style={{fontSize:20}}>💳</span> Bayar E-Money
          </button>
          <button onClick={()=>handleCheckout("cash")} className="btn-press"
            style={{width:"100%",padding:"9px",background:"#fffbeb",color:"#b45309",border:"2px solid #fde68a",borderRadius:11,fontSize:13,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"'Plus Jakarta Sans',sans-serif"}}
            onMouseOver={e=>{e.currentTarget.style.background="#fef3c7";e.currentTarget.style.borderColor="#fbbf24";}} onMouseOut={e=>{e.currentTarget.style.background="#fffbeb";e.currentTarget.style.borderColor="#fde68a";}}>
            <span>💵</span> Cash
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tenant Menu Manager ──────────────────────────────────────────────────────
function TenantMenuMgr({tenant,menus,allMenus,allTransactions,onSaveMenus}){
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState({code:"",name:"",price:""});
  const usedIds=new Set(allTransactions.flatMap(tx=>tx.items.map(it=>it.menuId)));
  const openAdd=()=>{setForm({code:"",name:"",price:""});setEditing(null);setShowForm(true);};
  const openEdit=m=>{
    if(usedIds.has(m.id)){alert("❌ Menu yang sudah dipakai dalam transaksi tidak bisa diedit!");return;}
    setForm({code:m.code,name:m.name,price:m.price.toString()});setEditing(m.id);setShowForm(true);
  };
  const save=()=>{
    if(!form.code||!form.name||!form.price){alert("Semua field harus diisi!");return;}
    const price=parseInt(form.price);if(isNaN(price)||price<=0){alert("Harga tidak valid!");return;}
    if(!editing&&menus.find(m=>m.code===form.code)){alert("Kode menu sudah ada!");return;}
    const p={code:form.code,name:form.name,price};
    onSaveMenus(editing?allMenus.map(m=>m.id===editing?{...m,...p}:m):[...allMenus,{id:uid(),tenantId:tenant.id,...p}]);
    setShowForm(false);
  };
  const del=m=>{
    if(usedIds.has(m.id)){alert("❌ Menu tidak bisa dihapus karena sudah digunakan dalam transaksi!");return;}
    if(window.confirm("Hapus menu ini?")) onSaveMenus(allMenus.filter(x=>x.id!==m.id));
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
        <FI label="Harga (Rp)" placeholder="15000" value={form.price} onChange={v=>setForm({...form,price:v})} type="number" accent="#16a34a"/>
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
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
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
  const filtered=[...transactions.filter(t=>t.date===filterDate)].sort((a,b)=>b.nota.localeCompare(a.nota));
  const tot=filtered.reduce((s,t)=>s+t.total,0);
  const em=filtered.filter(t=>t.paymentMethod==="emoney").reduce((s,t)=>s+t.total,0);
  const cs=filtered.filter(t=>t.paymentMethod==="cash").reduce((s,t)=>s+t.total,0);
  const bname=settings?.bazaarName||"BazaarPOS";
  const f1=settings?.receiptFooter1||"Terima kasih!";
  const f2=settings?.receiptFooter2||"Selamat menikmati :)";

  const exportXls=()=>{
    const rows=[];
    filtered.forEach(tx=>tx.items.forEach((it,i)=>rows.push([i===0?tx.nota:"",i===0?tx.date:"",i===0?tx.time:"",i===0?(tx.paymentMethod==="emoney"?"E-Money":"Cash"):"",it.menuCode,it.menuName,it.qty,it.price,it.qty*it.price,i===0?tx.total:""])));
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
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          <div style={{background:"#f5f3ff",border:"2px solid #ddd6fe",borderRadius:12,padding:12}}><p style={{margin:"0 0 3px",color:"#7c3aed",fontSize:11,fontWeight:700}}>💳 E-MONEY</p><p style={{margin:"0 0 2px",color:"#4c1d95",fontWeight:900,fontSize:16}}>{idr(em)}</p><p style={{margin:0,color:"#7c3aed",fontSize:11}}>{filtered.filter(t=>t.paymentMethod==="emoney").length} tx</p></div>
          <div style={{background:"#fffbeb",border:"2px solid #fde68a",borderRadius:12,padding:12}}><p style={{margin:"0 0 3px",color:"#b45309",fontSize:11,fontWeight:700}}>💵 CASH</p><p style={{margin:"0 0 2px",color:"#78350f",fontWeight:900,fontSize:16}}>{idr(cs)}</p><p style={{margin:0,color:"#b45309",fontSize:11}}>{filtered.filter(t=>t.paymentMethod==="cash").length} tx</p></div>
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
                  <p style={{color:"#9ca3af",fontSize:11,margin:0}}>{tx.date} • {tx.time}</p>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <p style={{fontWeight:800,color:"#16a34a",fontSize:17,margin:0}}>{idr(tx.total)}</p>
                  <button onClick={()=>printThermal({tx,tenantName:tenant?.name||"",tenantCode:tenant?.code||"",bazaarName:bname,footer1:f1,footer2:f2})}
                    style={{padding:"6px 10px",background:"#1c0a00",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Plus Jakarta Sans',sans-serif"}} onMouseOver={e=>e.currentTarget.style.background="#431407"} onMouseOut={e=>e.currentTarget.style.background="#1c0a00"}>
                    🖨️ Cetak
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
// SHARED COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════
function Modal({title,onClose,children,accent="#ea580c"}){
  return(
    <div
      onClick={e=>{if(e.target===e.currentTarget&&onClose)onClose();}}
      style={{
        position:"fixed",inset:0,
        background:"rgba(0,0,0,.6)",
        zIndex:999,
        display:"flex",
        alignItems:"center",
        justifyContent:"center",
        padding:16,
      }}>
      <div
        className="pop-in"
        style={{
          background:"#fff",
          borderRadius:20,
          boxShadow:"0 20px 60px rgba(0,0,0,.3)",
          width:"100%",
          maxWidth:420,
          // Kunci: maxHeight + overflowY scroll di CARD, bukan backdrop
          maxHeight:"calc(100vh - 32px)",
          overflowY:"auto",
          WebkitOverflowScrolling:"touch",
          padding:20,
        }}>
        {title&&<h3 style={{margin:"0 0 14px",fontSize:17,fontWeight:800,color:"#1c0a00"}}>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

function FI({label,placeholder,value,onChange,disabled,type="text",accent="#ea580c"}){
  const [f,setF]=useState(false);
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
