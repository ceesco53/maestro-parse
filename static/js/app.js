document.addEventListener('DOMContentLoaded', init);

let SELECTED = { anchorVid: null, chain: new Set() };

function clearHighlight() {
  SELECTED.anchorVid = null;
  SELECTED.chain = new Set();
  renderAll();
}

function computeChainFromVid(vid){
  // Build from RAW_ROWS within same foundation scope(s). Collect versions up and down by issuer graph.
  const byVid = new Map();
  RAW_ROWS.forEach(r => byVid.set(r.version_id, r));
  const chain = new Set();
  const q = [];
  const start = byVid.get(vid);
  if (!start) return chain;
  q.push(start);
  chain.add(start.version_id);
  // Walk up issuers
  let cur = start;
  let hops = 0;
  while (cur && cur.issuer_version && hops < 4000){
    const p = byVid.get(cur.issuer_version);
    if (!p || chain.has(p.version_id)) break;
    chain.add(p.version_id);
    cur = p; hops++;
  }
  // Walk down to leaves (BFS)
  const children = new Map();
  RAW_ROWS.forEach(r => {
    if (r.issuer_version){
      if (!children.has(r.issuer_version)) children.set(r.issuer_version, []);
      children.get(r.issuer_version).push(r);
    }
  });
  const dq = [start];
  let steps = 0;
  while (dq.length && steps < 8000){
    const n = dq.shift();
    const kids = children.get(n.version_id) || [];
    for (const k of kids){
      if (!chain.has(k.version_id)){
        chain.add(k.version_id);
        dq.push(k);
      }
    }
    steps++;
  }
  return chain;
}

function selectByVid(vid){
  SELECTED.anchorVid = vid || null;
  SELECTED.chain = vid ? computeChainFromVid(vid) : new Set();
  renderAll();
  // visual affordance: flash header button
  const btn = document.getElementById('btnClearHL'); if(btn){ btn.classList.add('highlight'); setTimeout(()=>btn.classList.remove('highlight'), 450); }
}


const COLORS = {"<=30":"#e11d48","<=60":"#f97316","<=90":"#ca8a04",">90":"#16a34a","no-date":"#6b7280"};
let RAW_ROWS = [];
let CARD_DATA_MAIN = {};
let CARD_DATA_DEP = {};

function init(){
  wireDnD();
  wireTabs();
  wireButtons();
  applyDynamicCols();
  window.addEventListener('resize', applyDynamicCols);
}

let __colsReq = null;
function applyDynamicCols(){
  if (__colsReq) return; // batch until next frame
  __colsReq = requestAnimationFrame(()=>{
    __colsReq = null;
    document.querySelectorAll('[data-dynamic-cols]').forEach(setGridCols);
  });
  function setGridCols(el){
    const width = el.clientWidth || el.parentElement?.clientWidth || window.innerWidth;
    let cols = Math.max(1, Math.min(4, Math.floor(width / 420)));
    el.style.setProperty('--cols', cols);
  }
}

// v4: helper to return CSS classes for selection
function selClass(r){
  if (!SELECTED.anchorVid) return '';
  return SELECTED.chain.has(r.version_id) ? 'highlight' : 'dimmed';
}

function showError(msg){ const b=document.getElementById('errorBanner'); if(!b) return; b.textContent=msg; b.style.display='block'; }
function setStatus(msg){ const s=document.getElementById('status'); if(s) s.textContent=msg||''; }
function toBucket(n){ if(n===null||n===undefined||n==='') return 'no-date'; n=Number(n); if(n<=30) return '<=30'; if(n<=60) return '<=60'; if(n<=90) return '<=90'; return '>90'; }

/* Uploader */
function wireDnD(){
  const dz=document.getElementById('dropZone'), fi=document.getElementById('fileInput');
  dz.addEventListener('click', ()=> fi.click());
  fi.addEventListener('change', e=> upload(e.target.files));
  ['dragenter','dragover'].forEach(evt => dz.addEventListener(evt, e=>{e.preventDefault(); e.stopPropagation(); dz.classList.add('drag');}));
  ['dragleave','drop'].forEach(evt => dz.addEventListener(evt, e=>{e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag');}));
  dz.addEventListener('drop', e=>{ const files=e.dataTransfer.files; if(files && files.length) upload(files); });

  function upload(files){
    const fd=new FormData(); Array.from(files).forEach(f=>fd.append('files',f,f.name));
    setStatus('Uploading...');
    fetch('/api/upload',{method:'POST',body:fd})
      .then(r=>{if(!r.ok) throw new Error('HTTP '+r.status); return r.json();})
      .then(j=>{ if(!j.ok) throw new Error(j.error||'Upload failed'); setStatus('Loaded '+j.rows+' rows'); refreshRows(); })
      .catch(e=>showError(e.message));
  }
}

/* Tabs + filters */
function wireTabs(){
  document.querySelectorAll('.tab').forEach(el=>el.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('panel-'+el.dataset.tab).classList.add('active');
    renderAll();
  }));
  const fnd=document.getElementById('fnd'); if(fnd) fnd.innerHTML='<option value="all">All</option>';
  ['fnd','sla','onlyActive','onlyCA','onlyTrans','groupByFoundation','chainsZoom','chainsMaxH','groupHeatByFoundation','insightsView',
   'depQuery','depExact','depGroupByFoundation','depZoom','depMaxH']
    .forEach(id=>{
      const el=document.getElementById(id); if(!el) return;
      const evt=(el.tagName==='INPUT' && el.type==='range')?'input':'change';
      el.addEventListener(evt, renderAll);
    });
}

function wireButtons(){
  const clr = document.getElementById('btnClearHL');
  if (clr) clr.addEventListener('click', clearHighlight);
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') clearHighlight(); });

  const btnClear = document.getElementById('btnClear');
  if (btnClear) btnClear.addEventListener('click', ()=>{ RAW_ROWS=[]; renderAll(); setStatus('Cleared'); });

  const btnCSV = document.getElementById('btnCSV');
  if (btnCSV) btnCSV.addEventListener('click', ()=> window.open('/api/export/csv','_blank'));

  const btnJSON = document.getElementById('btnJSON');
  if (btnJSON) btnJSON.addEventListener('click', ()=> window.open('/api/export/json','_blank'));

  const btnRunbook = document.getElementById('btnRunbook');
  if (btnRunbook) btnRunbook.addEventListener('click', ()=> window.open('/api/runbook','_blank'));
}

function refreshRows(){ fetch('/api/rows').then(r=>r.json()).then(rows=>{ RAW_ROWS=rows; populateFoundationSelect(); populateDeploymentDatalist(); renderAll(); }).catch(e=>showError(e.message)); }
function populateFoundationSelect(){
  const fnd=document.getElementById('fnd'); if(!fnd) return;
  const cur=fnd.value; const vals=Array.from(new Set(RAW_ROWS.map(r=>r.foundation))).sort();
  fnd.innerHTML='<option value="all">All</option>'+vals.map(v=>`<option value="${v}">${v}</option>`).join('');
  if(vals.includes(cur)) fnd.value=cur;
}
function collectDeployments(){
  const set=new Set();
  RAW_ROWS.forEach(r=>{
    const list=(r.deployments_list&&Array.isArray(r.deployments_list))?r.deployments_list:String(r.deployments||'').split(/[,;]\s*/);
    list.forEach(x=>{const v=(x||'').trim(); if(v) set.add(v);});
  });
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}
function populateDeploymentDatalist(){
  const dl=document.getElementById('depList'); if(!dl) return;
  dl.innerHTML = collectDeployments().map(n=>`<option value="${n}">`).join('');
}

function filteredRows(){
  const fnd=document.getElementById('fnd').value||'all';
  const sla=document.getElementById('sla').value||'all';
  const onlyActive=document.getElementById('onlyActive').checked;
  const onlyCA=document.getElementById('onlyCA').checked;
  const onlyTrans=document.getElementById('onlyTrans').checked;
  let data=RAW_ROWS.slice();
  if(fnd!=='all') data=data.filter(r=>r.foundation===fnd);
  if(onlyActive) data=data.filter(r=>r.active);
  if(onlyCA) data=data.filter(r=>r.certificate_authority);
  if(onlyTrans) data=data.filter(r=>r.transitional);
  if(sla!=='all') data=data.filter(r=>toBucket(r.days_remaining)===sla);
  data.sort((a,b)=>(a.days_remaining??9e9)-(b.days_remaining??9e9)||a.foundation.localeCompare(b.foundation)||a.cert_name.localeCompare(b.cert_name));
  return data;
}

let __rendering = false;
function renderAll(){
  if (__rendering) return; __rendering = true;
  try{
    const data=filteredRows();
    renderTimeline(data);
    renderTable(data);
    renderChainsMain(data);
    renderInsights(data);
    renderDeployments();
    applyDynamicCols();
  } finally { __rendering = false; }
}

/* Timeline — List cards */
function renderTimeline(rows){
  const empty=document.getElementById('timelineEmpty');
  const list=document.getElementById('timelineList');
  if(!rows.length){ empty.style.display='block'; list.innerHTML=''; return; }
  empty.style.display='none';
  list.innerHTML = rows.map(r=>{
    const bucket=toBucket(r.days_remaining), color=COLORS[bucket];
    const tags=[r.certificate_authority?'CA':null, r.transitional?'T':null, r.active?'ACTIVE':null].filter(Boolean).join(' • ');
    return `<div class="chip ${selClass(r)}" data-vid="${r.version_id}" style="border-color:${color}" onclick="selectByVid('${r.version_id}')">
      <div class="line1"><strong>${r.foundation} / ${r.cert_name}</strong><span class="sla" style="background:${color}"></span></div>
      <div class="line2"><code>${r.version_id_short}</code> ${tags?('• '+tags):''}</div>
      <div class="line2"><span>${r.days_remaining??'NA'}d</span><span>${r.valid_until||r.valid_until_raw||''}</span></div>
    </div>`;
  }).join('');
}

/* Table */
function renderTable(rows){
  const tbody=document.querySelector('#tbl tbody'); if(!tbody) return; tbody.innerHTML='';
  rows.forEach(r=>{
    const b=toBucket(r.days_remaining);
    const tr=document.createElement('tr'); tr.className = selClass(r); tr.innerHTML=`
      <td>${r.foundation}</td><td>${r.cert_name}</td><td><code style="cursor:pointer;" onclick="selectByVid('${r.version_id}')" title="Highlight chain">${r.version_id_short}</code></td>
      <td>${r.issuer||''}</td>
      <td>${r.active?'<span class="badge">ACTIVE</span>':''}</td>
      <td>${r.certificate_authority?'<span class="badge">CA</span>':''}</td>
      <td>${r.transitional?'<span class="badge">T</span>':''}</td>
      <td>${r.deployments||''}</td>
      <td>${r.valid_until||r.valid_until_raw||''}</td>
      <td style="text-align:right;">${r.days_remaining??''}</td>
      <td><span class="badge" style="background:${COLORS[b]}">${b}</span></td>`;
    tbody.appendChild(tr);
  });
}

/* Chains (shared renderer used by main + deployments) */
function renderChainsMain(rows){ CARD_DATA_MAIN={}; renderChainsInto(rows,'chains',CARD_DATA_MAIN); }
function renderChainsInto(rows, containerId, mapStore){
  const el=document.getElementById(containerId); if(!el) return; el.innerHTML='';
  const byF=(containerId==='chains') ? (document.getElementById('groupByFoundation')?.checked===true) : (document.getElementById('depGroupByFoundation')?.checked===true);
  const maxH=(containerId==='chains') ? (document.getElementById('chainsMaxH')?.value||420) : (document.getElementById('depMaxH')?.value||420);
  const zoom=(containerId==='chains') ? (parseInt(document.getElementById('chainsZoom')?.value||'100',10))/100 : (parseInt(document.getElementById('depZoom')?.value||'100',10))/100;

  const groups={};
  rows.forEach(r=>{ const key=byF?r.foundation:(r.foundation+'::'+r.cert_name); (groups[key]=groups[key]||[]).push(r); });
  const keys=Object.keys(groups).sort();
  if(keys.length===0){ const card=document.createElement('div'); card.className='card'; card.innerHTML='<strong>No chains to display</strong>'; el.appendChild(card); return; }

  let idx=0;
  keys.forEach(key=>{
    const [foundation,...rest]=key.split('::'); const cert=byF?'(all certificates)':rest.join('::');
    const gr=groups[key].slice(); const byVid={}; gr.forEach(x=>byVid[x.version_id]=x);

    const MAX_HOPS = 2000;
    function computeDepthIter(node){
      let depth = (node.certificate_authority && !node.issuer_version) ? 1 : 0;
      let cur = node;
      let hops = 0;
      const visited = new Set();
      while (cur && cur.issuer_version){
        if (visited.has(cur.version_id)) return 98; // cycle
        visited.add(cur.version_id);
        const parent = byVid[cur.issuer_version];
        if (!parent) return node.certificate_authority ? 2 : 97; // dangling
        const parentIsRoot = parent.certificate_authority && !parent.issuer_version;
        depth += 1;
        if (parentIsRoot) return Math.max(depth, 2);
        cur = parent;
        hops += 1;
        if (hops > MAX_HOPS) return 96; // extremely long
      }
      if (node.certificate_authority) return Math.max(depth, 1);
      return 99; // leaves
    }
    function computeTraceIter(node){
      const stack = [];
      const visited = new Set();
      let cur = node;
      let hops = 0;
      let cycle = false;
      while (cur){
        if (visited.has(cur.version_id)) { cycle = true; break; }
        visited.add(cur.version_id);
        stack.push(`${cur.cert_name}(${cur.version_id_short})`);
        if (!cur.issuer_version) break;
        const parent = byVid[cur.issuer_version];
        if (!parent) { stack.push(`?(${(cur.issuer_version || '').slice(0,8)}...)`); break; }
        cur = parent;
        hops += 1;
        if (hops > MAX_HOPS) { stack.push('...<truncated>'); break; }
      }
      return { chain: stack.reverse().join(' -> '), cycle };
    }

    gr.forEach(n=>{
      n.__parent = n.issuer_version ? byVid[n.issuer_version] : null;
      const d = computeDepthIter(n);
      const t = computeTraceIter(n);
      n.__depth = d;
      n.__trace = t.chain;
      n.__cycle = t.cycle || (d === 98);
    });

    const roots=gr.filter(n=>n.certificate_authority && !n.issuer_version);
    const transCAs=gr.filter(n=>n.certificate_authority && n.transitional && n.issuer_version);
    const interCAs=gr.filter(n=>n.certificate_authority && !n.transitional && n.issuer_version);
    const leaves=gr.filter(n=>!n.certificate_authority);
    const interLevels={}; interCAs.forEach(n=>{ const d=n.__depth; (interLevels[d]=interLevels[d]||[]).push(n); });
    const interDepths=Object.keys(interLevels).map(k=>parseInt(k,10)); const maxInterDepth=interDepths.length?Math.max(...interDepths):0;
    mapStore[idx]={roots,transCAs,interLevels,maxInterDepth,leaves};

    const card=document.createElement('div'); card.className='card';
    card.innerHTML=`
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:6px; flex-wrap:wrap;">
        <div><strong>${foundation} / ${cert}</strong><br><span class="muted">ROOT → TRANSITIONAL → INTERMEDIATE d1..dn → LEAF</span></div>
        <span style="margin-left:auto;" class="muted">Sort: 
          <select onchange="${containerId==='chains' ? 'resortCard' : 'resortDepCard'}(${idx}, this.value)">
            <option value="urgency">Urgency</option>
            <option value="name">Name</option>
            <option value="depth">Issuer depth</option>
          </select>
        </span>
      </div>
      <div class="chain-viewport" style="max-height:${maxH}px;">
        <div class="chain-canvas" style="transform: scale(${zoom}); transform-origin: top left;"></div>
      </div>`;
    el.appendChild(card);
    (containerId==='chains' ? resortCard : resortDepCard)(idx,'urgency',mapStore,containerId);
    idx++;
  });
}

function chipHTML(n){
  const bucket=toBucket(n.days_remaining), color=COLORS[bucket];
  const badges=[
    n.certificate_authority?'CA':'',
    n.transitional?'T':'',
    n.active?'ACTIVE':'',
    n.__cycle?'CYCLE':''
  ].filter(Boolean).map(b=>`<span class="badge">${b}</span>`).join('');
  const viol=n.__parent && (n.days_remaining??1e9) < (n.__parent.days_remaining??1e9);
  const tLines = [
    `${n.cert_name} / ${n.version_id}`,
    `valid_until: ${n.valid_until || n.valid_until_raw || ''}`,
    `days_remaining: ${n.days_remaining ?? 'NA'}`,
    `issuer_chain: ${n.__trace}`
  ];
  if (n.__cycle) tLines.push('NOTE: cycle detected in issuer chain');
  const t = tLines.join('\n');
  return `<div class="chip ${selClass(n)}${viol?' violation':''}" data-vid="${n.version_id}" title="${t.replace(/"/g,'&quot;')}" onclick="selectByVid('${n.version_id}')">
    <div class="line1"><strong>${n.version_id_short}</strong><span class="sla" style="background:${color}"></span></div>
    <div class="line2"><span>${n.days_remaining??'NA'}d</span><span>${n.valid_until || n.valid_until_raw || ''}</span></div>
    <div class="line2"><span>${n.issuer_version_short?('issuer '+n.issuer_version_short):''} ${n.__depth?('d'+n.__depth):''}</span><div class="badges">${badges}</div></div>
  </div>`;
}
function sortFns(mode){
  const byUrg=(a,b)=>(a.days_remaining??9e9)-(b.days_remaining??9e9) || (a.version_id_short||'').localeCompare(b.version_id_short||'');
  const byName=(a,b)=>(a.version_id_short||'').localeCompare(b.version_id_short||'');
  const byDepth=(a,b)=>(a.__depth||99)-(b.__depth||99) || byUrg(a,b);
  return mode==='name'?byName:(mode==='depth'?byDepth:byUrg);
}
function resortCard(idx, mode, MAP=CARD_DATA_MAIN, containerId='chains'){
  const data=MAP[idx]; if(!data) return;
  const {roots,transCAs,interLevels,maxInterDepth,leaves}=data;
  const sortFn=sortFns(mode);
  const cardEls=document.querySelectorAll(`#${containerId} .card`); const cardEl=cardEls[idx];
  const canvas=cardEl.querySelector('.chain-canvas'); canvas.innerHTML='';
  function tier(title, arr){
    const div=document.createElement('div'); div.className='tier'; div.innerHTML=`<h5>${title}</h5><div class="chips"></div>`;
    const grid=div.querySelector('.chips'); arr.slice().sort(sortFn).forEach(n=>grid.insertAdjacentHTML('beforeend', chipHTML(n))); canvas.appendChild(div);
  }
  tier('ROOT CAs',roots); tier('TRANSITIONAL CAs',transCAs);
  for(let d=1; d<=maxInterDepth; d++) tier('INTERMEDIATE d'+d, (interLevels[d]||[]));
  tier('LEAVES',leaves);
}
window.resortCard=(i,m)=>resortCard(i,m,CARD_DATA_MAIN,'chains');
function resortDepCard(idx, mode, MAP=CARD_DATA_DEP, containerId='deployChains'){ return resortCard(idx,mode,MAP,containerId); }
window.resortDepCard=(i,m)=>resortDepCard(i,m,CARD_DATA_DEP,'deployChains');

/* Insights — compact monthly panels */
function renderInsights(rows){
  const root=document.getElementById('insights'); if(!root) return; root.innerHTML='';
  const group=document.getElementById('groupHeatByFoundation')?.checked===true;
  const events=rows.map(r=>({d:(r.valid_until||r.valid_until_raw||'').slice(0,10), f:r.foundation, c:r.cert_name, v:r.version_id_short, vFull:r.version_id})).filter(e=>e.d);
  if(!events.length){ const c=document.createElement('div'); c.className='card'; c.innerHTML='<div class="muted">No valid expiration dates in scope.</div>'; root.appendChild(c); return; }
  const byF={}; events.forEach(e=> (byF[e.f]=byF[e.f]||[]).push(e));
  const sets = group ? Object.entries(byF) : [['All Foundations', events]];
  sets.forEach(([title,evs])=>{
    // v4: dim month cards if they don’t include any selected versions (when selection active)
    let hasSelected = true;
    if (SELECTED.anchorVid){
      const vids = new Set(evs.map(e=>e.vFull || e.v || ''));
      hasSelected = [...SELECTED.chain].some(v=>vids.has(v));
    }

    const m=new Map(); evs.forEach(e=>{const wk=startOfWeek(e.d); m.set(wk,(m.get(wk)||0)+1);});
    const min=[...m.keys()].sort()[0]; const months=buildMonthList(min);
    const wrap=document.createElement('div'); wrap.className='card'; wrap.innerHTML=`<h4 style="margin:0 0 6px 0;">Rotation Splash — ${title}</h4><div class="grid"></div>`;
    const grid=wrap.querySelector('.grid');
    months.forEach(mon=>{
      const weeks=listWeeks(mon); const counts=weeks.map(w=>m.get(w)||0); const max=Math.max(1,...counts);
      const cell=12,gap=2,padL=26,padT=18; const cols=weeks.length, vbW=padL+cols*(cell+gap)+8, vbH=padT+7*(cell+gap)+12;
      let svg=`<svg viewBox="0 0 ${vbW} ${vbH}" width="100%" height="${vbH}" xmlns="http://www.w3.org/2000/svg">`;
      const dnames=['M','T','W','T','F','S','S'];
      for(let r=0;r<7;r++) svg+=`<text x="6" y="${padT + r*(cell+gap) + cell - 2}" font-size="9" fill="#94a3b8">${dnames[r]}</text>`;
      weeks.forEach((wk,c)=>{ for(let r=0;r<7;r++){ const k=fmt(addDays(parseDate(wk),r)); const val=m.get(startOfWeek(k))||0; const t=val/max; const a=0.25+0.75*t; const x=padL+c*(cell+gap), y=padT+r*(cell+gap); svg+=`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="rgba(22,163,74,${a})"><title>${k}\n${val} expiration(s)</title></rect>`; } });
      svg+='</svg>';
      const mini=document.createElement('div'); mini.className='chip'; mini.innerHTML=`<strong>${mon}</strong>${svg}`; if(!hasSelected){ mini.classList.add('dimmed'); } grid.appendChild(mini);
    });
    root.appendChild(wrap);
  });

  function parseDate(s){ return new Date(s+'T00:00:00'); }
function fmt(d){ return d.toISOString().slice(0,10); }
function addDays(d,n){ const x=new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }
function startOfWeekStr(s){ const d=parseDate(s); const day=d.getDay(); const diff=(day+6)%7; d.setDate(d.getDate()-diff); return fmt(d); }
function startOfWeekDate(d){ const x=new Date(d.getTime()); const day=x.getDay(); const diff=(day+6)%7; x.setDate(x.getDate()-diff); return x; }
function buildMonthList(start){
  const arr=[]; if(!start) return arr; const d=parseDate(start);
  if(Number.isNaN(d.getTime())) return arr; const now=new Date(); now.setMonth(now.getMonth()+12);
  for(let x=new Date(d.getFullYear(), d.getMonth(), 1); x<=now; x=new Date(x.getFullYear(), x.getMonth()+1, 1)){
    arr.push(x.toLocaleString(undefined,{month:'long',year:'numeric'}));
  }
  return arr;
}
function listWeeks(monLabel){
  const parts = monLabel.split(' ');
  if (parts.length<2) return [];
  const m = parts[0], y = parseInt(parts[1],10);
  if(!y || Number.isNaN(y)) return [];
  const firstOfMonth = new Date(`${m} 1, ${y}`);
  if(Number.isNaN(firstOfMonth.getTime())) return [];
  const lastOfMonth = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth()+1, 0);
  // find Monday on or before firstOfMonth
  let cur = startOfWeekDate(firstOfMonth);
  const out = [];
  // iterate Mondays until we pass lastOfMonth + 6 days (to cover final week)
  const end = addDays(lastOfMonth, 6);
  let guard = 0;
  while (cur <= end && guard < 12){
    out.push(fmt(cur));
    cur = addDays(cur, 7);
    guard++;
  }
  return out;
}
}

/* Deployments */
function renderDeployments(){
  const cont=document.getElementById('deployChains'); if(!cont) return;
  const help=document.getElementById('deployHelp'); cont.innerHTML=''; if(help) help.style.display='none';
  const q=(document.getElementById('depQuery')?.value || '').trim(); const exact=document.getElementById('depExact')?.checked===true;
  // Use globally filtered set as the base
  const base = filteredRows();
  if(!q){
    const freq=new Map();
    base.forEach(r=>{ const list=(r.deployments_list&&Array.isArray(r.deployments_list))?r.deployments_list:String(r.deployments||'').split(/[,;]\s*/); list.forEach(x=>{const v=(x||'').trim(); if(v) freq.set(v,(freq.get(v)||0)+1);}); });
    const top=[...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,30);
    const rows = top.map(([n,c])=>`<tr><td>${n}</td><td style="text-align:right;">${c}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No deployments detected in current filter.</td></tr>';
    if(help){ help.style.display='block'; help.innerHTML = `<strong>Type a deployment_name to see correlated chains.</strong>
      <div class="muted" style="margin:6px 0 10px 0;">Scope respects global filters (foundation/SLA/CA/Transitional/Active).</div>
      <table style="width:100%; border-collapse:collapse;">
        <thead><tr><th>Top deployment_name</th><th style="text-align:right;">Refs</th></tr></thead><tbody>${rows}</tbody></table>`; }
    return;
  }
  const qlc=q.toLowerCase();
  const matched = base.filter(r=>{
    const list=(r.deployments_list&&Array.isArray(r.deployments_list))?r.deployments_list:String(r.deployments||'').split(/[,;]\s*/);
    return list.some(x=>{ const v=(x||'').trim(); if(!v) return false; return exact? v===q : v.toLowerCase().includes(qlc); });
  });
  if(!matched.length){ const card=document.createElement('div'); card.className='card'; card.innerHTML=`<div class="muted">No matches for <code>${q}</code> in current filter.</div>`; cont.appendChild(card); return; }
  CARD_DATA_DEP={}; renderChainsInto(matched,'deployChains',CARD_DATA_DEP);
}
