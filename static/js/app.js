
let ROWS = [];
let HILITE_NAME = null;    // global soft-glow target
let FND_MAP = {};          // exact-match mapping for p-bosh-* ids

document.addEventListener('DOMContentLoaded', init);

function init(){
  wireDnD();
  wireTabs();
  wireButtons();
  wireFoundations();
  wireSettings();
  applyCardHeight(loadCardHeight());
}

// ---- Upload ----
function wireDnD(){
  const dz = document.getElementById('dropZone');
  const fi = document.getElementById('fileInput');
  dz.addEventListener('click', ()=> fi.click());
  dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.classList.add('hover'); });
  dz.addEventListener('dragleave', e=> dz.classList.remove('hover'));
  dz.addEventListener('drop', async (e)=>{
    e.preventDefault(); dz.classList.remove('hover');
    await uploadFiles(e.dataTransfer.files);
  });
  fi.addEventListener('change', async (e)=>{
    await uploadFiles(e.target.files);
    fi.value = "";
  });
}

async function uploadFiles(fileList){
  const status = document.getElementById('status');
  const fd = new FormData();
  let count = 0;
  for (const f of fileList){
    if (!/(\.json)$/i.test(f.name)) continue;
    fd.append('files', f);
    count++;
  }
  if (count===0){ status.textContent = 'No JSON files selected.'; return; }
  status.textContent = 'Uploading...';
  const res = await fetch('/api/upload', { method:'POST', body:fd });
  const j = await res.json().catch(()=> ({}));
  if (!res.ok || !j.ok){ status.textContent = 'Upload failed: '+(j.error||res.statusText); return; }
  status.textContent = `Loaded ${j.count} rows.`;
  await refreshData();
}

async function refreshData(){
  const res = await fetch('/api/data');
  const j = await res.json();
  ROWS = j.rows || [];
  render();
}

// ---- Tabs & Controls ----
function wireTabs(){
  document.querySelectorAll('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-'+btn.dataset.tab).classList.add('active');
      render();
    });
  });
}

function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(null,a), ms); }; }
function wireButtons(){
  const btnCSV = document.getElementById('btnCSV');
  if (btnCSV) btnCSV.addEventListener('click', ()=> window.open('/api/export/csv', '_blank'));
  const btnJSON = document.getElementById('btnJSON');
  if (btnJSON) btnJSON.addEventListener('click', ()=> window.open('/api/export/json', '_blank'));
  const sla = document.getElementById('slaFilter');
  if (sla) sla.addEventListener('change', ()=> render());
  const heatSel = document.getElementById('heatView');
  if (heatSel) heatSel.addEventListener('change', ()=> render());

  const depQ = document.getElementById('depQuery');
  const depEx = document.getElementById('depExact');
  if (depQ) depQ.addEventListener('input', debounce(()=> render(), 150));
  if (depEx) depEx.addEventListener('change', ()=> render());

}

// ---- Filters ----
function activeSLA(){ const v=document.getElementById('slaFilter')?.value||'all'; return v; }
function passesSLA(r){ const f=activeSLA(); if(f==='all') return true; return r.sla===f; }
function filteredRows(){ return (ROWS||[]).filter(passesSLA); }

// ---- Foundation utilities ----
function loadMap(){
  try{ FND_MAP = JSON.parse(localStorage.getItem('foundationMap')||'{}') || {}; }catch{ FND_MAP = {}; }
  return FND_MAP;
}
function saveMap(){ localStorage.setItem('foundationMap', JSON.stringify(FND_MAP)); }
function firstPBosh(deployments){
  for (const d of (deployments||[])){ if (typeof d === 'string' && d.startsWith('p-bosh-')) return d; }
  return null;
}
function suggestName(raw){
  if (!raw) return '';
  const tail = raw.split('-').pop();
  const last6 = tail.slice(-6);
  return 'bosh-' + last6;
}
function resolveFoundationDisplay(row){
  const raw = firstPBosh(row.deployments);
  if (raw && FND_MAP[raw]) return FND_MAP[raw];   // exact-match mapping
  if (raw) return raw;                             // raw fallback
  return 'unknown';
}

// ---- Render Router ----
function render(){
  const active = document.querySelector('.tab.active')?.dataset.tab || 'table';
  if (active==='table') renderTable();
  else if (active==='timeline') renderTimeline();
  else if (active==='chains') renderChains();
  else if (active==='insights') renderInsights();
  else if (active==='deploy') renderDeploy();
  else if (active==='found') renderFoundations();
}

// ---- Helpers ----
function fmtDate(s){ if (!s) return ''; try { const d = new Date(s); return d.toISOString().slice(0,10); } catch { return s; } }
function clsForSLA(sla){ if (sla === '<=30') return 'bad'; if (sla === '<=60') return 'warn'; if (sla === '<=90') return 'ok'; return ''; }

// ---- TABLE ----
function renderTable(){
  const tb = document.querySelector('#tbl tbody');
  tb.innerHTML = '';
  const rows = filteredRows().slice().sort((a,b)=>{
    const ad = a.valid_until ? new Date(a.valid_until).getTime() : Infinity;
    const bd = b.valid_until ? new Date(b.valid_until).getTime() : Infinity;
    return ad - bd;
  });
  for (const r of rows){
    const tr = document.createElement('tr');
    if (HILITE_NAME && r.name === HILITE_NAME) tr.classList.add('highlight-row');
    tr.innerHTML = `
      <td>${r.name||''}</td>
      <td>${r.is_ca? 'CA':''}</td>
      <td>${r.issuer||''}</td>
      <td>${resolveFoundationDisplay(r)}</td>
      <td>${r.product_guid||''}</td>
      <td>${fmtDate(r.valid_until)}</td>
      <td>${r.days_until ?? ''}</td>
      <td class="${clsForSLA(r.sla)}">${r.sla||''}</td>
      <td>${r.depth ?? ''}</td>
      <td>${r.root_name||''}</td>
    `;
    tb.appendChild(tr);
    tr.addEventListener('click', ()=> setHighlightByRow(r));
  }
}

// ---- TIMELINE ----
function renderTimeline(){
  const el = document.getElementById('timeline');
  el.innerHTML = '';
  const rows = filteredRows().slice().sort((a,b)=>{
    const ad = a.valid_until ? new Date(a.valid_until).getTime() : Infinity;
    const bd = b.valid_until ? new Date(b.valid_until).getTime() : Infinity;
    return ad - bd;
  });
  if (!rows.length){ el.innerHTML = '<div class="muted">Upload JSON to see timeline.</div>'; return; }
  for (const r of rows){
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<span class="${clsForSLA(r.sla)}">[${r.sla||''}]</span> <strong class="tl-name" data-name="${r.name||''}">${r.name||''}</strong> → valid_until ${fmtDate(r.valid_until)} <span class="muted">(root: ${r.root_name||''}, depth ${r.depth ?? ''})</span>`;
    el.appendChild(div);
    div.addEventListener('click',(e)=>{ const nm=e.target.closest('.tl-name')?.getAttribute('data-name'); if(nm){ const row=filteredRows().find(x=>x.name===nm); if(row) setHighlightByRow(row);} });
  }
}

// ---- CHAINS ----
function groupBy(arr, keyfn){ const m = new Map(); for (const x of arr){ const k = keyfn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x);} return m; }

function renderChains(){
  const el = document.getElementById('chains');
  el.innerHTML = '';
  const g = groupBy(filteredRows(), r => r.root_name || '(unknown root)');
  for (const [root, items] of g.entries()){
    const card = document.createElement('div'); card.className='chain';
    const roots = items.filter(x=> x.is_ca && (x.depth===0));
    const inter = items.filter(x=> x.is_ca && (x.depth>0));
    const leaves = items.filter(x=> !x.is_ca);
    const mkChip = (r)=> `<span class="chip ${clsForSLA(r.sla)} ${HILITE_NAME && r.name===HILITE_NAME ? 'highlight-chip':''}" data-name="${r.name}" title="${r.name} | until ${fmtDate(r.valid_until)} | depth ${r.depth}">${r.name}</span>`;
    card.innerHTML = `
      <h4>${root}</h4>
      <div class="legend">
        <span class="item"><span class="sw sla30"></span> ≤30d</span>
        <span class="item"><span class="sw sla60"></span> ≤60d</span>
        <span class="item"><span class="sw sla90"></span> ≤90d</span>
        <span class="item"><span class="sw slaAll"></span> >90d / no-date</span>
      </div>
      <div class="tier"><h5>Root</h5><div class="chips">${roots.map(mkChip).join('')}</div></div>
      <div class="tier"><h5>Intermediates</h5><div class="chips">${inter.map(mkChip).join('')}</div></div>
      <div class="tier"><h5>Leaves</h5><div class="chips">${leaves.map(mkChip).join('')}</div></div>
    `;
    el.appendChild(card);
    card.addEventListener('click',(e)=>{ const t=e.target; if(t.classList.contains('chip')){ const nm=t.getAttribute('data-name'); const row=filteredRows().find(x=>x.name===nm); if(row) setHighlightByRow(row);} });
  }
}

// ---- INSIGHTS ----
function renderInsights(){
  const grid = document.getElementById('insights'); if(!grid) return;
  grid.innerHTML = '';
  const rows = filteredRows();
  if (!rows.length){ grid.innerHTML = '<div class="muted">No data in current filter.</div>'; return; }
  loadMap();
  const sel = document.getElementById('heatView');
  const mode = sel ? sel.value : 'monthly';
  if (mode === 'calendar') renderInsightsCalendarStrip(grid, rows);
  else renderInsightsMonthly(grid, rows);
}

// Monthly cards
function renderInsightsMonthly(grid, rows){
  const byMonth = new Map();
  for (const r of rows){
    if (!r.valid_until) continue;
    const d = new Date(r.valid_until); if (isNaN(d)) continue;
    const k = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    byMonth.set(k, (byMonth.get(k)||0) + 1);
  }
  const months = [...byMonth.keys()].sort();
  if (!months.length){ grid.innerHTML = '<div class="muted">No expiring certificates with valid dates.</div>'; return; }
  for (const m of months){
    const card = document.createElement('div'); card.className='cal-month';
    card.innerHTML = `<h4>${m}</h4><div class="muted">expiring: <strong>${byMonth.get(m)}</strong></div>`;
    grid.appendChild(card);
  }
}

// Calendar strip (Month + Foundation), hide empty foundations
function renderInsightsCalendarStrip(grid, rows){
  const monthKey = (d) => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  const slaClass = (sla) => (sla === '<=30') ? 'bad' : (sla === '<=60') ? 'warn' : (sla === '<=90') ? 'ok' : 'dim';

  // idx[month][foundation] = array of cert rows
  const idx = new Map();
  for (const r of rows){
    const vu = r.valid_until ? new Date(r.valid_until) : null;
    const m = (vu && !isNaN(vu)) ? monthKey(vu) : 'no-date';
    const f = resolveFoundationDisplay(r);
    if (!idx.has(m)) idx.set(m, new Map());
    const fm = idx.get(m);
    if (!fm.has(f)) fm.set(f, []);
    fm.get(f).push(r);
  }

  const months = [...idx.keys()].sort();
  if (!months.length){ grid.innerHTML = '<div class="muted">No expiring certificates with valid dates.</div>'; return; }

  for (const mon of months){
    const card = document.createElement('div'); card.className='cal-month';
    let inner = `<h4>${mon}</h4>`;
    const fm = idx.get(mon);
    const foundations = [...fm.keys()].sort();

    for (const fnd of foundations){
      const list = fm.get(fnd);
      if (!list.length) continue; // B: hide empty foundations
      const sq = list.map(r => {
        const title = `${r.name} — until ${r.valid_until ? (new Date(r.valid_until)).toISOString().slice(0,10) : 'n/a'} — ${r.sla || 'no-date'}`;
        const hi = (HILITE_NAME && r.name === HILITE_NAME) ? ' highlight-square' : '';
        return `<div class="sq ${slaClass(r.sla)}${hi}" data-name="${r.name}" title="${title}"></div>`;
      }).join('');

      inner += `
        <div class="cal-found">
          <div class="label" title="${fnd}">${fnd}</div>
          <div class="cal-grid">${sq}</div>
        </div>`;
    }

    card.innerHTML = inner;
    card.addEventListener('click', (e) => {
      const t = e.target;
      if (!t.classList.contains('sq')) return;
      const name = t.getAttribute('data-name');
      const row = rows.find(x => x.name === name);
      if (row) setHighlightByRow(row);
    });
    grid.appendChild(card);
  }
}

// ---- DEPLOYMENTS ----
function renderDeploy(){
  const cont = document.getElementById('deployChains'); if(!cont) return;
  const help = document.getElementById('deployHelp'); cont.innerHTML=''; if(help) help.style.display='none';
  const q = (document.getElementById('depQuery')?.value || '').trim();
  const exact = document.getElementById('depExact')?.checked === true;
  const base = filteredRows();
  // populate datalist suggestions
  const dl = document.getElementById('depList');
  if (dl && !dl.childElementCount) {
    const set = new Set();
    base.forEach(r => (r.deployments||[]).forEach(d => { if(d) set.add(d); }));
    const opts = [...set].slice(0,300).sort().map(d => `<option value="${d}"></option>`).join('');
    dl.innerHTML = opts;
  }
  if(!q){
    const freq = new Map();
    base.forEach(r=>{ (r.deployments||[]).forEach(d=>{ const v=(d||'').trim(); if(v) freq.set(v,(freq.get(v)||0)+1); }); });
    const top = [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,30);
    const rows = top.map(([n,c])=>`<tr><td>${n}</td><td style="text-align:right;">${c}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No deployments detected in current filter.</td></tr>';
    if(help){ help.style.display='block'; help.innerHTML = `<strong>Type a deployment_name to see correlated chains.</strong>
      <div class="muted" style="margin:6px 0 10px 0;">Scope respects SLA filter.</div>
      <table style="width:100%; border-collapse:collapse;">
        <thead><tr><th>Top deployment_name</th><th style="text-align:right;">Refs</th></tr></thead><tbody>${rows}</tbody></table>`; }
    return;
  }
  const qlc = q.toLowerCase();
  const matched = base.filter(r=> (r.deployments||[]).some(x=>{
    const v=(x||'').trim();
    return v && (exact ? v===q : v.toLowerCase().includes(qlc));
  }));
  if(!matched.length){ const card=document.createElement('div'); card.className='card'; card.innerHTML=`<div class="muted">No matches for <code>${q}</code> in current filter.</div>`; cont.appendChild(card); return; }
  const byRoot = groupBy(matched, r => r.root_name || '(unknown root)');
  for (const [root, items] of byRoot.entries()){
    const card = document.createElement('div'); card.className = 'chain';
    const roots = items.filter(x=> x.is_ca && (x.depth===0));
    const inter = items.filter(x=> x.is_ca && (x.depth>0));
    const leaves = items.filter(x=> !x.is_ca);
    const mkChip = (r)=> `<span class="chip ${clsForSLA(r.sla)} ${HILITE_NAME && r.name===HILITE_NAME ? 'highlight-chip':''}" data-name="${r.name}" title="${r.name} | until ${fmtDate(r.valid_until)} | depth ${r.depth}">${r.name}</span>`;
    card.innerHTML = `
      <h4>${root}</h4>
      <div class="legend">
        <span class="item"><span class="sw sla30"></span> ≤30d</span>
        <span class="item"><span class="sw sla60"></span> ≤60d</span>
        <span class="item"><span class="sw sla90"></span> ≤90d</span>
        <span class="item"><span class="sw slaAll"></span> >90d / no-date</span>
      </div>
      <div class="tier"><h5>Root</h5><div class="chips">${roots.map(mkChip).join('')}</div></div>
      <div class="tier"><h5>Intermediates</h5><div class="chips">${inter.map(mkChip).join('')}</div></div>
      <div class="tier"><h5>Leaves</h5><div class="chips">${leaves.map(mkChip).join('')}</div></div>
    `;
    cont.appendChild(card);
    card.addEventListener('click',(e)=>{ const t=e.target; if(t.classList.contains('chip')){ const nm=t.getAttribute('data-name'); const row=filteredRows().find(x=>x.name===nm); if(row) setHighlightByRow(row);} });
  }
}

// ---- Foundations Tab ----
function uniquePBoshIds(rows){ const s = new Set(); for (const r of rows){ const raw = firstPBosh(r.deployments); if (raw) s.add(raw);} return [...s]; }

function renderFoundations(){
  const tb = document.querySelector('#mapTbl tbody'); if(!tb) return;
  loadMap();
  tb.innerHTML = '';
  const ids = uniquePBoshIds(filteredRows());
  const allRows = new Set([...ids, ...Object.keys(FND_MAP||{})]);
  for (const raw of allRows){
    const tr = document.createElement('tr');
    const val = FND_MAP[raw] || '';
    tr.innerHTML = `<td><code title="${raw}">${raw||''}</code></td>
      <td><input type="text" class="map-friendly" data-raw="${raw}" value="${val}" placeholder="${raw?suggestName(raw):''}"></td>
      <td style="text-align:right;"><button class="btn btn-del" data-raw="${raw}">Del</button></td>`;
    tb.appendChild(tr);
  }
  tb.addEventListener('input', (e)=>{ const inp = e.target.closest('.map-friendly'); if(!inp) return;
    const raw = inp.getAttribute('data-raw'); FND_MAP[raw] = inp.value.trim(); saveMap(); });
  tb.addEventListener('click', (e)=>{ const del = e.target.closest('.btn-del'); if(!del) return;
    const raw = del.getAttribute('data-raw'); delete FND_MAP[raw]; saveMap(); renderFoundations(); });
  const stats = document.getElementById('mapStats');
  if (stats){
    const counts = {}; for (const r of filteredRows()){ const raw = firstPBosh(r.deployments)||'unknown'; counts[raw]=(counts[raw]||0)+1; }
    const lines = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${FND_MAP[k]||k}: ${v}`).join(' • ');
    stats.textContent = 'Affected certs: ' + lines;
  }
}

function wireFoundations(){
  const btnS = document.getElementById('mapSuggest');
  const btnA = document.getElementById('mapAdd');
  const btnAp= document.getElementById('mapApply');
  const btnE = document.getElementById('mapExport');
  const btnI = document.getElementById('mapImport');
  const fi   = document.getElementById('mapImportFile');
  if (btnS) btnS.addEventListener('click', ()=>{
    const ids = uniquePBoshIds(filteredRows());
    for (const raw of ids){ if (!FND_MAP[raw]) FND_MAP[raw] = suggestName(raw); }
    saveMap(); renderFoundations(); render();
  });
  if (btnA) btnA.addEventListener('click', ()=>{ FND_MAP['p-bosh-'] = FND_MAP['p-bosh-'] || ''; saveMap(); renderFoundations(); });
  if (btnAp) btnAp.addEventListener('click', ()=>{ saveMap(); render(); });
  if (btnE) btnE.addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(FND_MAP,null,2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mapping.json'; a.click();
  });
  if (btnI) btnI.addEventListener('click', ()=> fi && fi.click());
  if (fi) fi.addEventListener('change', async (e)=>{
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    try{ FND_MAP = JSON.parse(text)||{}; saveMap(); renderFoundations(); render(); }catch{ alert('Invalid JSON'); }
    fi.value='';
  });
}

// ---- Cross-tab highlight ----
function setHighlightByRow(r){
  if (!r) return;
  HILITE_NAME = r.name||null;
  render();
  // Table
  const rows = document.querySelectorAll('#tbl tbody tr');
  for (const tr of rows){
    if (tr.textContent.includes(r.name||'')){ tr.scrollIntoView({behavior:'smooth', block:'center'}); break; }
  }
  // Chains chip
  const chips = document.querySelectorAll('.chip');
  for (const c of chips){
    if ((c.getAttribute('title')||'').startsWith(r.name||'')){ c.classList.add('highlight-chip'); c.scrollIntoView({behavior:'smooth', block:'center'}); break; }
  }
  // Insights square
  const squares = document.querySelectorAll('.sq[title]');
  for (const s of squares){
    if ((s.getAttribute('title')||'').startsWith(r.name||'')){ s.classList.add('highlight-square'); s.scrollIntoView({behavior:'smooth', block:'center'}); break; }
  }
}
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ HILITE_NAME=null; render(); }});


// ---- Settings (Card Height) ----
function loadCardHeight(){
  try{ const v = localStorage.getItem('cardMaxH'); return v ? parseInt(v,10) : 800; }catch{ return 800; }
}
function applyCardHeight(px){
  const v = Math.max(200, Math.min(2000, parseInt(px,10)||800));
  document.documentElement.style.setProperty('--card-max-h', v + 'px');
  const input = document.getElementById('cardHeightPx'); if (input) input.value = v;
  try{ localStorage.setItem('cardMaxH', String(v)); }catch{}
}
function wireSettings(){
  const input = document.getElementById('cardHeightPx');
  const btn = document.getElementById('cardApply');
  if (input) input.value = loadCardHeight();
  if (btn) btn.addEventListener('click', ()=> applyCardHeight(document.getElementById('cardHeightPx').value));
}
