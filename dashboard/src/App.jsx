/**
 * Neptune - POD Processor Dashboard
 * React JSX - paste into src/App.jsx in a Vite project
 *
 * Architecture:
 *   Browser -> React -> fetch("/api/*") -> Node/Express -> 05_Neptune SQL Server
 *                                                -> Python agent (ar_barcode_sorter.py)
 *
 * Same design system as Mercury Travel Billing / IC Billing, so Neptune's
 * agent page looks/feels consistent across the family of HC agent tools.
 * Vite dev proxy: vite.config.js proxies /api -> http://localhost:5001 (or
 * whichever port the Neptune backend runs on).
 *
 * Backend contract expected by this page:
 *   GET  /api/me                              -> { user }
 *   GET  /api/dashboard/summary?period=...    -> { processed, success, failed,
 *                                                    hcSuccess, hcFailed,
 *                                                    tpSuccess, tpFailed,
 *                                                    lastRunAt }
 *   GET  /api/runs                            -> [{ Id, RunTimestamp, Company,
 *                                                    SuccessCount, FailedCount }]
 *   GET  /api/control-mappings                -> [{ Id, MappingKey, MappingValue,
 *                                                    Description, ModifiedAt, ModifiedBy }]
 *   PUT  /api/control-mappings/:id            -> body { mappingValue, modifiedBy }
 */

import { useState, useEffect, useCallback, useRef } from "react";

// --- Design tokens ---------------------------------------------------------
// Neptune brand palette: #EA1D48 (red) is the bold/primary Neptune colour,
// with the same silver/grey/navy supporting shades used across every HC
// agent page, so Neptune reads as part of the same family as Mercury and IC.
// Status colours (success/warn/danger) stay standard semantic red/amber/
// green - those communicate meaning, not brand, so they're left alone even
// though danger and the brand colour are both in the red family."#0D0D0F"
const T = {
  pageBg:      "#F0F2F5",
  cardBg:      "#FFFFFF",
  navBg:       "#EA1D48",
  rowAlt:      "#F8F9FB",
  inputBg:     "#F8F9FB",
  border:      "#DDE1E9",
  borderMid:   "#C8CEDB",
  navy:        "#0D0D0F",
  navyLo:      "#E8E9EB",
  accent:      "#EA1D48",
  accentLo:    "#FDECEF",
  success:     "#0A7A45",
  successBg:   "#E6F5EE",
  successBd:   "#B3DFC8",
  warn:        "#B45309",
  warnBg:      "#FEF3C7",
  warnBd:      "#FCD34D",
  danger:      "#B91C1C",
  dangerBg:    "#FEF2F2",
  dangerBd:    "#FCA5A5",
  textPrimary:   "#111827",
  textSecondary: "#374151",
  textMuted:     "#6B7280",
  textDim:       "#9CA3AF",
  white:         "#FFFFFF",
};

// In local dev, "/api" is same-origin and Vite's proxy (vite.config.js) sends
// it to the backend. In production the frontend is a standalone IIS site on
// its own port with no proxy in front of it, so the browser needs the
// backend's real host:port to call it at all - that's VITE_API_BASE, baked
// in at build time (see frontend/.env.production).
const API = `${import.meta.env.VITE_API_BASE ?? ""}/api`;

// Who may see and use the Control Mappings page. This is a UI convenience,
// not a security boundary - the /api/control-mappings endpoints underneath
// do NOT check this list. Compared case-insensitively since AD domain
// casing (HC\ vs hc\) isn't reliable.

const CONTROL_MAPPINGS_EDITORS = ["hc\\tedder.bruce", "hc\\raw.chantel"];

function normaliseAdUser(value) {
  return (value ?? "").trim().toLowerCase();
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// --- Formatters ------------------------------------------------------------
const fmt24 = iso => { if (!iso) return "—"; const d = new Date(iso); return d.toLocaleDateString("en-ZA")+" "+d.toLocaleTimeString("en-ZA",{hour12:false}); };

const mkBtn = (bg, color, extra={}) => ({
  background:bg, color, border: extra.bd||"none",
  borderRadius:6, padding: extra.sm?"5px 12px":"9px 18px",
  fontSize: extra.sm?12:13, fontWeight:600, cursor:"pointer",
  lineHeight:1, display:"inline-flex", alignItems:"center", gap:4,
});

// --- Primitives --------------------------------------------------------------
function CompanyBadge({company}) {
  const m = {
    HC:    {bg:T.accentLo, col:T.accent, bd:"#F6B9C6"},
    TP:    {bg:"#EAF1FF",  col:"#1D4ED8", bd:"#BFD3FE"},
    ERROR: {bg:T.dangerBg, col:T.danger, bd:T.dangerBd},
  };
  const s = m[company] || {bg:"#F3F4F6", col:T.textMuted, bd:T.border};
  return <span style={{background:s.bg,color:s.col,border:`1px solid ${s.bd}`,borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,letterSpacing:"0.06em",fontFamily:"'Roboto Mono','Courier New',monospace",whiteSpace:"nowrap"}}>{company}</span>;
}

function KpiCard({label,value,sub,topColor,wide}) {
  return (
    <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderTop:`3px solid ${topColor||T.border}`,borderRadius:8,padding:"16px 18px",gridColumn:wide?"span 2":"span 1",display:"flex",flexDirection:"column",gap:4}}>
      <span style={{fontSize:11,fontWeight:600,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em"}}>{label}</span>
      <span style={{fontSize:24,fontWeight:700,color:T.textPrimary,lineHeight:1.15}}>{value}</span>
      {sub && <span style={{fontSize:12,color:T.textDim}}>{sub}</span>}
    </div>
  );
}

function Card({title,sub,action,children,flush}) {
  return (
    <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
      {(title||action) && (
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:flush?"14px 20px 0":"14px 20px",borderBottom:flush?"none":`1px solid ${T.border}`}}>
          <div>
            <span style={{fontSize:14,fontWeight:600,color:T.textPrimary}}>{title}</span>
            {sub && <span style={{fontSize:12,color:T.textMuted,marginLeft:8}}>{sub}</span>}
          </div>
          {action}
        </div>
      )}
      <div style={{padding:flush?0:20}}>{children}</div>
    </div>
  );
}

function Overlay({children,zIndex=999}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(17,24,39,0.45)",display:"flex",alignItems:"flex-start",justifyContent:"center",overflowY:"auto",zIndex,padding:"48px 16px"}}>
      {children}
    </div>
  );
}

function ConfirmDialog({title,body,onConfirm,onCancel,danger}) {
  return (
    <Overlay zIndex={9999}>
      <div style={{background:T.cardBg,borderRadius:10,border:`1px solid ${T.border}`,padding:28,maxWidth:500,width:"90%",boxShadow:"0 20px 40px rgba(0,0,0,0.14)"}}>
        <h3 style={{margin:"0 0 12px",color:T.textPrimary,fontSize:16,fontWeight:600}}>{title}</h3>
        <div style={{color:T.textSecondary,fontSize:13,lineHeight:1.6,marginBottom:22}}>{body}</div>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onCancel} style={mkBtn(T.pageBg,T.textSecondary,{bd:`1px solid ${T.border}`})}>Cancel</button>
          <button onClick={onConfirm} style={mkBtn(danger?T.danger:T.accent,T.white)}>{danger?"Yes, proceed":"Confirm"}</button>
        </div>
      </div>
    </Overlay>
  );
}

function FieldRow({label,error,wide,children}) {
  return (
    <div style={{gridColumn:wide?"span 2":"span 1",display:"flex",flexDirection:"column",gap:4}}>
      <label style={{fontSize:12,fontWeight:600,color:T.textSecondary,letterSpacing:"0.04em"}}>{label}</label>
      {children}
      {error && <span style={{fontSize:11,color:T.danger}}>{error}</span>}
    </div>
  );
}

const inpStyle = err => ({background:T.inputBg,border:`1px solid ${err?T.danger:T.borderMid}`,borderRadius:6,color:T.textPrimary,padding:"8px 10px",fontSize:13,width:"100%",boxSizing:"border-box",outline:"none",fontFamily:"inherit"});

function Toast({message,type,onDismiss}) {
  useEffect(()=>{ const t=setTimeout(onDismiss,4200); return ()=>clearTimeout(t); },[]);
  const s = type==="success"?{bg:T.successBg,col:T.success,bd:T.successBd}:type==="error"?{bg:T.dangerBg,col:T.danger,bd:T.dangerBd}:{bg:T.warnBg,col:T.warn,bd:T.warnBd};
  return <div style={{position:"fixed",bottom:24,right:24,background:s.bg,border:`1px solid ${s.bd}`,borderLeft:`4px solid ${s.col}`,borderRadius:8,padding:"12px 18px",color:s.col,fontSize:13,fontWeight:600,boxShadow:"0 4px 16px rgba(0,0,0,0.12)",zIndex:99999,maxWidth:380}}>{message}</div>;
}

// --- Hours saved highlight ----------------------------------------------------
// Manual baseline: 1:30 to manually read a shipment's barcode/label and file
// the POD into the right folder by hand. Time saved per automated shipment =
// 90s, summed across every successfully-sorted shipment (HC + TP) in the
// selected period, converted to hours. Failed/ERROR-routed files aren't
// counted - those still need a human to look at them, so no time was saved.
function HoursSavedCard({hoursSaved,shipmentsAutomated,label}) {
  const wholeHours = Math.floor(hoursSaved);
  const minutes = Math.round((hoursSaved - wholeHours) * 60);
  return (
    <div style={{
      gridColumn:"span 2",
      background:`linear-gradient(135deg, ${T.navy} 0%, #EA1D48 100%)`,
      borderRadius:8,
      padding:"16px 20px",
      display:"flex",
      alignItems:"center",
      justifyContent:"space-between",
      color:T.white,
    }}>
      <div>
        <span style={{fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.65)",textTransform:"uppercase",letterSpacing:"0.08em"}}>⏱ Hours Saved{label?` (${label})`:""}</span>
        <div style={{fontSize:30,fontWeight:700,lineHeight:1.15,marginTop:2}}>
          {wholeHours}<span style={{fontSize:16,fontWeight:500,opacity:0.75}}>h</span> {minutes}<span style={{fontSize:16,fontWeight:500,opacity:0.75}}>m</span>
        </div>
      </div>
      <div style={{textAlign:"right",fontSize:11,color:"rgba(255,255,255,0.6)",lineHeight:1.5}}>
        <div>{shipmentsAutomated} shipments automated</div>
        <div style={{opacity:0.7}}>vs. 1:30/shipment manual entry</div>
      </div>
    </div>
  );
}

// --- Nav mark ---------------------------------------------------------------
// The Neptune mascot. Every Neptune page uses this same icon + "Neptune"
// wordmark in the top left - matches the Mercury/IC nav pattern, just with
// Neptune's own icon and brand colour instead of the plain black mark.
function LogoMark() {
  return (
    <img
      src="/neptune-logo.png"
      alt="Neptune"
      style={{width:50,height:50,borderRadius:7,flexShrink:0,display:"block",border:"1px solid rgba(255,255,255,0.18)",objectFit:"contain"}} //,background:"#fff"
    />
  );
}

// --- Table cell baseline -----------------------------------------------------
const TD = {padding:"10px 14px",color:"#374151",verticalAlign:"middle"};
const TH = {textAlign:"left",padding:"10px 14px",fontSize:11,fontWeight:600,color:"#6B7280",textTransform:"uppercase",letterSpacing:"0.07em",borderBottom:`1px solid #DDE1E9`,whiteSpace:"nowrap"};

// --- Edit Modal (Control Mappings) ------------------------------------------
// One row = one folder path the script reads at startup (INPUT_DIR, HC_DIR,
// TP_DIR, ERROR_DIR, LOG_DIR). Only the value is editable - the key is fixed
// because ar_barcode_sorter.py looks rows up by MappingKey.
function EditMappingModal({row,onSave,onCancel,currentUser}) {
  const [value,setValue] = useState(row.MappingValue ?? "");
  const [error,setError] = useState(null);
  const [confirming,setConfirming] = useState(false);

  const handleSave = () => {
    if (!value.trim()) { setError("Required - the script needs a path here"); return; }
    setConfirming(true);
  };

  return (
    <>
      {confirming && (
        <ConfirmDialog
          title="Confirm path change"
          body={
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <p style={{margin:0}}>Change <strong>{row.MappingKey}</strong> to:</p>
              <code style={{background:T.pageBg,border:`1px solid ${T.border}`,borderRadius:6,padding:"8px 10px",fontSize:12,wordBreak:"break-all"}}>{value}</code>
              <p style={{margin:0,fontSize:12,color:T.textMuted}}>
                Takes effect on the next scheduled run of ar_barcode_sorter.py. If this
                folder doesn't exist or isn't reachable, the next run will fail to
                process files for this path.
              </p>
              <div style={{display:"flex",gap:8,alignItems:"baseline",marginTop:6}}>
                <span style={{fontSize:12,color:T.textMuted,width:90,flexShrink:0}}>Changed by</span>
                <span style={{fontSize:13,color:T.textPrimary}}>{currentUser}</span>
              </div>
            </div>
          }
          onConfirm={()=>{ setConfirming(false); onSave(row.Id, value); }}
          onCancel={()=>setConfirming(false)}
        />
      )}
      <Overlay zIndex={998}>
        <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:10,width:"100%",maxWidth:520,boxShadow:"0 20px 48px rgba(0,0,0,0.14)"}}>
          <div style={{padding:"18px 24px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <h2 style={{margin:0,fontSize:16,fontWeight:700,color:T.textPrimary}}>Edit Mapping - {row.MappingKey}</h2>
              <p style={{margin:"2px 0 0",fontSize:12,color:T.textMuted}}>{row.Description}</p>
            </div>
            <button onClick={onCancel} style={{background:"none",border:"none",fontSize:20,color:T.textMuted,cursor:"pointer",padding:4,lineHeight:1}}>×</button>
          </div>
          <div style={{padding:24}}>
            <FieldRow label="Path" error={error} wide>
              <input
                value={value}
                onChange={ev=>{setValue(ev.target.value); setError(null);}}
                style={inpStyle(!!error)}
                placeholder={`e.g. Z:\\AR\\${row.MappingKey.replace("_DIR","")}`}
              />
            </FieldRow>
            <div style={{marginTop:14,padding:"10px 14px",background:T.pageBg,border:`1px solid ${T.border}`,borderRadius:6,fontSize:12,color:T.textSecondary,lineHeight:1.5}}>
              <strong style={{color:T.textPrimary}}>Last modified</strong>{row.ModifiedAt ? ` ${fmt24(row.ModifiedAt)} by ${row.ModifiedBy || "unknown"}` : " — never"}
            </div>
          </div>
          <div style={{padding:"14px 24px",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"flex-end",gap:10,background:T.pageBg,borderRadius:"0 0 10px 10px"}}>
            <button onClick={onCancel} style={mkBtn(T.cardBg,T.textSecondary,{bd:`1px solid ${T.border}`})}>Cancel</button>
            <button onClick={handleSave} style={mkBtn(T.accent,T.white)}>Save Changes</button>
          </div>
        </div>
      </Overlay>
    </>
  );
}

// --- Root App ----------------------------------------------------------------
export default function App() {
  const [page,setPage]           = useState("dashboard");
  const [summary,setSummary]     = useState(null);
  const [runs,setRuns]           = useState([]);
  const [mappings,setMappings]   = useState([]);
  const [loading,setLoading]     = useState(true);
  const [editRow,setEditRow]     = useState(null);
  const [toast,setToast]         = useState(null);

  const [currentUser,setCurrentUser] = useState("loading...");
  const [loadError,setLoadError]     = useState(null);
  const [period,setPeriod]           = useState("today");

  // The Windows account IIS authenticated for THIS PAGE LOAD. Exposed by
  // web.config's outbound rule as a response header, read here once by
  // re-fetching the document.
  const [authenticatedUser,setAuthenticatedUser] = useState(null);
  const canEditMappings = true; // TEMP: force-visible for local testing - revert to
  // CONTROL_MAPPINGS_EDITORS.includes(normaliseAdUser(authenticatedUser)) before deploying

  const showToast = (msg,type="success") => setToast({message:msg,type});

  const reloadAll = useCallback(async () => {
    const [summaryData, runsData, mappingsData] = await Promise.all([
      apiFetch(`/dashboard/summary?period=${encodeURIComponent(period)}`),
      apiFetch("/runs"),
      apiFetch("/control-mappings"),
    ]);
    setSummary(summaryData);
    setRuns(runsData);
    setMappings(mappingsData);
  },[period]);

  const isFirstPeriodRender = useRef(true);
  useEffect(()=>{
    if (isFirstPeriodRender.current) { isFirstPeriodRender.current = false; return; }
    apiFetch(`/dashboard/summary?period=${encodeURIComponent(period)}`)
      .then(setSummary)
      .catch(err=>showToast(err.message,"error"));
  },[period]);

  useEffect(()=>{
    async function loadAll() {
      try {
        const meData = await apiFetch("/me");
        setCurrentUser(meData.user);
        await reloadAll();
      } catch (err) {
        console.error("Failed to load Neptune data:", err.message);
        setLoadError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  },[reloadAll]);

  useEffect(()=>{
    fetch(window.location.href, {cache:"no-store"})
      .then(res=>setAuthenticatedUser(res.headers.get("X-Authenticated-User")))
      .catch(()=>setAuthenticatedUser(null));
  },[]);

  const handleSaveMapping = useCallback(async (id, mappingValue)=>{
    try {
      await apiFetch(`/control-mappings/${id}`, {
        method:"PUT",
        body: JSON.stringify({ mappingValue, modifiedBy: currentUser }),
      });
      showToast("Mapping updated");
      await reloadAll();
    } catch (err) {
      showToast(err.message, "error");
    }
    setEditRow(null);
  },[currentUser,reloadAll]);

  return (
    <div style={{minHeight:"100vh",background:T.pageBg,fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",color:T.textPrimary}}>

      <nav style={{background:T.navBg,height:56,display:"flex",alignItems:"center",padding:"0 24px",position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 4px rgba(0,0,0,0.25)"}}>
        <div style={{display:"flex",alignItems:"center",gap:11,marginRight:36,flexShrink:0}}>
          <LogoMark />
          <span style={{color:T.white,fontWeight:700,fontSize:16,letterSpacing:"-0.01em",whiteSpace:"nowrap"}}>
            Neptune
          </span>
          <span style={{color:"rgba(255,255,255,0.55)",fontSize:12,fontWeight:600,letterSpacing:"0.03em",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:20,padding:"3px 10px",whiteSpace:"nowrap"}}>
            POD Processor
          </span>
        </div>
        {[{key:"dashboard",label:"Dashboard"}, ...(canEditMappings ? [{key:"mappings",label:"Control Mappings"}] : [])].map(n=>(
          <button key={n.key} onClick={()=>setPage(n.key)} style={{background:"none",border:"none",borderBottom:`2px solid ${page===n.key?T.accent:"transparent"}`,color:page===n.key?T.white:"rgba(255,255,255,0.58)",cursor:"pointer",padding:"18px 14px 16px",fontSize:13,fontWeight:page===n.key?600:400,transition:"color 0.15s,border-color 0.15s"}}>{n.label}</button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,0.09)",borderRadius:20,padding:"4px 14px 4px 10px"}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:"#4ADE80"}} />
          <span style={{fontSize:12,color:"rgba(255,255,255,0.72)",fontFamily:"'Roboto Mono','Courier New',monospace"}}>{currentUser}</span>
        </div>
      </nav>

      <div style={{maxWidth:1300,margin:"0 auto",padding:"28px 24px"}}>
        {loading ? (
          <div style={{textAlign:"center",paddingTop:80,color:T.textMuted,fontSize:14}}>
            <div style={{fontSize:30,marginBottom:12}}>{loadError?"⚠":"⏳"}</div>
            {loadError
              ? <div><strong style={{color:T.danger}}>Failed to connect to API</strong><br/><span style={{fontSize:12,color:T.textMuted}}>{loadError}</span><br/><span style={{fontSize:12,color:T.textMuted}}>Check that the Neptune backend is running</span></div>
              : "Loading Neptune data…"
            }
          </div>
        ) : page==="dashboard" || !canEditMappings ? (
          <Dashboard summary={summary} runs={runs} period={period} onPeriodChange={setPeriod} />
        ) : (
          <ControlMappings
            mappings={mappings} currentUser={currentUser}
            onEdit={row=>setEditRow(row)}
          />
        )}
      </div>

      {editRow!==null && <EditMappingModal row={editRow} onSave={handleSaveMapping} onCancel={()=>setEditRow(null)} currentUser={currentUser} />}
      {toast && <Toast {...toast} onDismiss={()=>setToast(null)} />}
    </div>
  );
}

// --- Period filter -----------------------------------------------------------
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function monthPeriod(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
}

function buildPeriodOptions(now = new Date()) {
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);
  return [
    {key:"today", label:"Today"},
    {key:monthPeriod(lastMonth), label:`${MONTH_NAMES[lastMonth.getMonth()]} ${lastMonth.getFullYear()}`},
    {key:monthPeriod(thisMonth), label:`${MONTH_NAMES[thisMonth.getMonth()]} ${thisMonth.getFullYear()}`},
    {key:"all", label:"All Time"},
  ];
}

function periodLabel(period, options) {
  return options.find(o=>o.key===period)?.label ?? "Today";
}

function PeriodSelect({period,onChange,options}) {
  return (
    <select value={period} onChange={ev=>onChange(ev.target.value)} style={{...inpStyle(false),width:"auto",fontWeight:600,cursor:"pointer"}}>
      {options.map(o=><option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
}

// --- Dashboard -----------------------------------------------------------------
// Gives visibility of Company (HC/TP), Date, and Sum of Successful vs Failed
// reads - the exact three-way view asked for, sourced from dbo.RunLog.
function Dashboard({summary:s,runs,period,onPeriodChange}) {
  const periodOptions = buildPeriodOptions();
  const label = periodLabel(period, periodOptions);
  const pct = s.processed>0 ? Math.round((s.success/s.processed)*100) : 100;
  const hCol = pct>=90?T.success:pct>=70?T.warn:T.danger;
  const hBg  = pct>=90?T.successBg:pct>=70?T.warnBg:T.dangerBg;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:22}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <h1 style={{margin:0,fontSize:20,fontWeight:700,color:T.textPrimary}}>POD Processor Overview</h1>
          <p style={{margin:"3px 0 0",fontSize:13,color:T.textMuted}}>{fmt24(new Date().toISOString())} · AR barcode sorting (HC-SS / TP-SS)</p>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <PeriodSelect period={period} onChange={onPeriodChange} options={periodOptions} />
          <div title={`Success rate = successful reads ÷ total processed (${label}) × 100.`} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 16px",background:hBg,border:`1px solid ${hCol}44`,borderRadius:8,cursor:"help"}}>
            <span style={{fontSize:12,color:T.textSecondary}}>Success rate ({label}) <span style={{fontSize:10,opacity:0.6}}>ⓘ</span></span>
            <span style={{fontWeight:700,fontSize:22,color:hCol}}>{pct}%</span>
          </div>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
        <KpiCard label={`Processed ${label}`}    value={s.processed}                                    topColor={T.borderMid} />
        <KpiCard label="Successful Reads"        value={s.success}  sub={`of ${s.processed} processed`}  topColor={T.success}   />
        <KpiCard label="Failed Reads"            value={s.failed}                                        topColor={s.failed>0?T.danger:T.borderMid} />
        <KpiCard label="Last Run"                value={fmt24(s.lastRunAt)}                              topColor={T.borderMid} />
        <KpiCard label="HC - Successful"         value={s.hcSuccess} topColor={T.accent}  />
        <KpiCard label="HC - Failed"             value={s.hcFailed}  topColor={s.hcFailed>0?T.danger:T.borderMid} />
        <KpiCard label="TP - Successful"         value={s.tpSuccess} topColor="#1D4ED8" />
        <KpiCard label="TP - Failed"             value={s.tpFailed}  topColor={s.tpFailed>0?T.danger:T.borderMid} />
        <HoursSavedCard
          hoursSaved={((s.hcSuccess||0) + (s.tpSuccess||0)) * 90 / 3600}
          shipmentsAutomated={(s.hcSuccess||0) + (s.tpSuccess||0)}
          label={label}
        />
      </div>

      <Card title="Run History" sub="Every logged run, by company" flush>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead>
            <tr style={{background:T.pageBg}}>
              {["Date / Time","Company","Successful","Failed"].map(h=><th key={h} style={TH}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {runs.slice(0,25).map((r,i)=>(
              <tr key={r.Id} style={{background:i%2===0?T.cardBg:T.rowAlt,borderBottom:`1px solid ${T.border}`}}>
                <td style={TD}>{fmt24(r.RunTimestamp)}</td>
                <td style={TD}><CompanyBadge company={r.Company} /></td>
                <td style={{...TD,color:T.success,fontWeight:600}}>{r.SuccessCount}</td>
                <td style={{...TD,color:r.FailedCount>0?T.danger:T.textDim,fontWeight:r.FailedCount>0?600:400}}>{r.FailedCount}</td>
              </tr>
            ))}
            {runs.length===0 && (
              <tr><td colSpan={4} style={{...TD,textAlign:"center",color:T.textDim,padding:"24px 14px"}}>No runs logged yet</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// --- Control Mappings ------------------------------------------------------------
// The five folder paths ar_barcode_sorter.py reads at startup. Editable here
// instead of in the script, so a path change doesn't require redeploying code.
function ControlMappings({mappings,currentUser,onEdit}) {
  const order = ["INPUT_DIR","HC_DIR","TP_DIR","ERROR_DIR","LOG_DIR"];
  const sorted = [...mappings].sort((a,b)=> order.indexOf(a.MappingKey) - order.indexOf(b.MappingKey));
  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div>
        <h1 style={{margin:0,fontSize:20,fontWeight:700,color:T.textPrimary}}>Control Mappings</h1>
        <p style={{margin:"3px 0 0",fontSize:13,color:T.textMuted}}>Folder paths used by ar_barcode_sorter.py — changes take effect on the next scheduled run</p>
      </div>

      <Card flush>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{background:T.pageBg}}>{["Key","Path","Description","Last Modified","Actions"].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {sorted.map((row,i)=>(
                <tr key={row.Id} style={{background:i%2===0?T.cardBg:T.rowAlt,borderBottom:`1px solid ${T.border}`}}>
                  <td style={{...TD,fontWeight:600,fontFamily:"'Roboto Mono','Courier New',monospace",fontSize:12}}>{row.MappingKey}</td>
                  <td style={{...TD,fontFamily:"'Roboto Mono','Courier New',monospace",fontSize:12,wordBreak:"break-all"}}>{row.MappingValue}</td>
                  <td style={{...TD,fontSize:12,color:T.textMuted}}>{row.Description}</td>
                  <td style={{...TD,fontSize:12,whiteSpace:"nowrap",color:T.textMuted}}>{row.ModifiedAt ? `${fmt24(row.ModifiedAt)}${row.ModifiedBy ? " · "+row.ModifiedBy : ""}` : "—"}</td>
                  <td style={{...TD,whiteSpace:"nowrap"}}>
                    <button onClick={()=>onEdit(row)} style={mkBtn(T.accentLo,T.accent,{sm:true})}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p style={{margin:0,fontSize:11,color:T.textDim}}>
        Signed in as <strong style={{color:T.textMuted}}>{currentUser}</strong>
      </p>
    </div>
  );
}
