/* global Chart */
document.addEventListener('DOMContentLoaded', init);

const COLORS = {"<=30":"#e11d48","<=60":"#f97316","<=90":"#ca8a04",">90":"#16a34a","no-date":"#6b7280"};
let RAW_ROWS = [];
let chartRef=null;

function init(){
  wireDnD();
  wireTabs();
  wireButtons();
}

function wireDnD(){
  const dz = document.getElementById('dropZone');
  const fi = document.getElementById('fileInput');
  if(!dz || !fi) return;

  function upload(files){
    const fd = new FormData();
    Array.from(files).forEach(f => fd.append('files', f, f.name));
    setStatus('Uploading...');
    fetch('/api/upload', {method:'POST', body:fd})
      .then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(j=>{
        if(!j.ok){ throw new Error(j.error||'Upload failed'); }
        setStatus('Loaded '+j.rows+' rows');
        refreshRows();
      })
      .catch(e=> showError(e.message));
  }

  dz.addEventListener('click', ()=> fi.click());
  fi.addEventListener('change', e=> upload(e.target.files));

  ['dragenter','dragover'].forEach(evt => dz.addEventListener(evt, (e)=>{
    e.preventDefault(); e.stopPropagation(); dz.classList.add('drag');
  }));
  ['dragleave','drop'].forEach evt => dz.addEventListener(evt, (e)=>{
    e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag');
  });
  dz.addEventListener('drop', (e)=>{
    const files = e.dataTransfer.files;
    if(files && files.length) upload(files);
  });
}

function wireTabs(){
  document.querySelectorAll('.tab').forEach(el => el.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('panel-'+el.dataset.tab).classList.add('active');
    renderAll();
  }));

  const fndSel=document.getElementById('fnd'); if(fndSel) fndSel.innerHTML='<option value="all">All</option>';
  ['fnd','sla','onlyActive','onlyCA','onlyTrans','groupByFoundation','chainsZoom','chainsMaxH','groupHeatByFoundation','insightsView']
    .forEach(id=>{
      const el=document.getElementById(id);
      if(!el) return;
      el.addEventListener(el.tagName==='INPUT' && el.type==='range' ? 'input' : 'change', renderAll);
    });
}

function wireButtons(){
  const $=id=>document.getElementById(id);
  $('btnClear').addEventListener('click', ()=>{ RAW_ROWS=[]; renderAll(); setStatus('Cleared'); });
  $('btnCSV').addEventListener('click', ()=> window.open('/api/export/csv','_blank'));
  $('btnJSON').addEventListener('click', ()=> window.open('/api/export/json','_blank'));
  $('btnRunbook').addEventListener('click', ()=> window.open('/api/runbook','_blank'));
}

function showError(msg){ const b=document.getElementById('errorBanner'); if(!b) return; b.textContent=msg; b.style.display='block'; }
function setStatus(msg){ const s=document.getElementById('status'); if(s) s.textContent = msg||''; }
function toBucket(n){ if(n===null||n===undefined||n==="") return 'no-date'; n=Number(n); if(n<=30) return '<=30'; if(n<=60) return '<=60'; if(n<=90) return '<=90'; return '>90'; }

function refreshRows(){
  fetch('/api/rows').then(r=>r.json()).then(rows=>{ RAW_ROWS=rows; populateFoundationSelect(); renderAll(); }).catch(e=>showError(e.message));
}

function populateFoundationSelect(){
  const fndSel=document.getElementById('fnd'); if(!fndSel) return;
  const prev=fndSel.value;
  const fnds=Array.from(new Set(RAW_ROWS.map(r=>r.foundation))).sort();
  fndSel.innerHTML='<option value="all">All</option>'+fnds.map(f=>`<option value="${f}">${f}</option>`).join('');
  if(fnds.includes(prev)) fndSel.value=prev;
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

function renderAll(){
  const data=filteredRows();
  renderChart(data);
  renderTable(data);
  renderChains(data);
  renderInsights(data);
}

/* Timeline */
function ensureChart(){
  const ctx=document.getElementById('chart');
  if(!chartRef){
    chartRef=new Chart(ctx,{type:'bar',data:{labels:[],datasets:[{label:'Days Remaining',data:[],backgroundColor:[]}]},
      options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}},scales:{x:{title:{display:true,text:'Days Remaining'}}}}});
  }
  return chartRef;
}
function renderChart(rows){
  const c=ensureChart();
  c.data.labels=rows.map(r=>`${r.foundation} / ${r.cert_name} / ${r.version_id_short}${r.active?' • ACTIVE':''}`);
  c.data.datasets[0].data=rows.map(r=>(r.days_remaining??0));
  c.data.datasets[0].backgroundColor=rows.map(r=>COLORS[toBucket(r.days_remaining)]);
  c.update();
}

/* Table */
function renderTable(rows){
  const tbody=document.querySelector('#tbl tbody'); if(!tbody) return; tbody.innerHTML='';
  rows.forEach(r=>{
    const vu=r.valid_until||r.valid_until_raw; const b=toBucket(r.days_remaining);
    const tr=document.createElement('tr'); tr.innerHTML=`
      <td>${r.foundation}</td><td>${r.cert_name}</td><td><code>${r.version_id_short}</code></td>
      <td>${r.issuer||''}</td>
      <td>${r.active?'<span class="badge">ACTIVE</span>':''}</td>
      <td>${r.certificate_authority?'<span class="badge">CA</span>':''}</td>
      <td>${r.transitional?'<span class="badge">T</span>':''}</td>
      <td>${r.deployments||''}</td>
      <td>${vu||''}</td>
      <td style="text-align:right;">${r.days_remaining??''}</td>
      <td><span class="pill" style="background:${COLORS[b]}">${b}</span></td>`;
    tbody.appendChild(tr);
  });
}

/* Chains */
let CARD_DATA={};
function renderChains(rows){
  const el=document.getElementById('chains'); if(!el) return; el.innerHTML=''; CARD_DATA={};
  const byF=document.getElementById('groupByFoundation')?.checked===true;
  const groups={}; rows.forEach(r=>{ const key=byF?r.foundation:(r.foundation+'::'+r.cert_name); (groups[key]=groups[key]||[]).push(r); });
  const keys=Object.keys(groups).sort();
  if(keys.length===0){ const card=document.createElement('div'); card.className='card'; card.innerHTML='<strong>No chains to display</strong>'; el.appendChild(card); return; }
  let idx=0;
  keys.forEach(key=>{
    const [foundation,...rest]=key.split('::'); const cert=byF?'(all certificates)':rest.join('::');
    const gr=groups[key].slice(); const byVid={}; gr.forEach(x=>byVid[x.version_id]=x);
    function computeDepth(n,guard=0){ if(!n) return 0; if(!n.issuer_version) return n.certificate_authority?1:99; if(guard>64) return 99; const p=byVid[n.issuer_version]; if(!p) return n.certificate_authority?2:99; const root=(p.certificate_authority && !p.issuer_version); const base=root?1:computeDepth(p,guard+1); return base+1; }
    function chainTrace(n){ const out=[]; let cur=n,guard=0; while(cur && guard<64){ out.push(`${cur.cert_name}(${cur.version_id_short})`); if(!cur.issuer_version) break; cur=byVid[cur.issuer_version]; guard++; } return out.reverse(); }
    gr.forEach(n=>{ n.__depth=computeDepth(n); n.__parent=n.issuer_version?byVid[n.issuer_version]:null; n.__trace=chainTrace(n).join(' -> '); });
    const roots=gr.filter(n=>n.certificate_authority && !n.issuer_version);
    const transCAs=gr.filter(n=>n.certificate_authority && n.transitional && n.issuer_version);
    const interCAsAll=gr.filter(n=>n.certificate_authority && !n.transitional && n.issuer_version);
    const leaves=gr.filter(n=>!n.certificate_authority);
    const interLevels={}; interCAsAll.forEach(n=>{ const d=n.__depth; (interLevels[d]=interLevels[d]||[]).push(n); });
    const interDepths=Object.keys(interLevels).map(k=>parseInt(k,10)); const maxInterDepth=interDepths.length?Math.max(...interDepths):0;
    CARD_DATA[idx]={roots,transCAs,interLevels,maxInterDepth,leaves};
    const card=document.createElement('div'); card.className='card';
    const heightPx=(document.getElementById('chainsMaxH')?.value||420);
    const zoom=(parseInt(document.getElementById('chainsZoom')?.value||'100',10))/100;
    card.innerHTML=`
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:6px; flex-wrap:wrap;">
        <div><strong>${foundation} / ${cert}</strong><br/><span class="crumbs">ROOT -&gt; TRANSITIONAL -&gt; INTERMEDIATE d1..dn -&gt; LEAF</span></div>
        <span style="margin-left:auto;" class="legend">
          <span class="pill" style="background:#e11d48">&le;30</span><span class="pill" style="background:#f97316">&le;60</span>
          <span class="pill" style="background:#ca8a04">&le;90</span><span class="pill" style="background:#16a34a">&gt;90</span>
          <span class="pill" style="background:#6b7280">no-date</span>
        </span>
        <label>Sort mode:
          <select onchange="resortCard(${idx}, this.value)">
            <option value="urgency">Urgency (days)</option>
            <option value="name">Name</option>
            <option value="depth">Issuer depth</option>
          </select>
        </label>
      </div>
      <div class="chain-viewport" style="max-height:${heightPx}px;">
        <div class="chain-canvas" style="transform: scale(${zoom}); transform-origin: top left;"></div>
      </div>`;
    el.appendChild(card); resortCard(idx,'urgency'); idx++;
  });
}
function resortCard(idx, mode){
  const data=CARD_DATA[idx]; if(!data) return;
  const {roots,transCAs,interLevels,maxInterDepth,leaves}=data;
  function byUrg(a,b){ return (a.days_remaining??9e9)-(b.days_remaining??9e9) || (a.version_id_short||'').localeCompare(b.version_id_short||''); }
  function byName(a,b){ return (a.version_id_short||'').localeCompare(b.version_id_short||''); }
  function byDepth(a,b){ return (a.__depth||99)-(b.__depth||99) || byUrg(a,b); }
  const sortFn=(mode==='name')?byName:(mode==='depth'?byDepth:byUrg);
  const cardEls=document.querySelectorAll('#chains .card'); const cardEl=cardEls[idx];
  const canvas=cardEl.querySelector('.chain-canvas'); canvas.innerHTML='';
  function chipHTML(n){
    const bucket=toBucket(n.days_remaining); const color=COLORS[bucket];
    const badges=[n.certificate_authority?'CA':'', n.transitional?'T':'', n.active?'ACTIVE':''].filter(Boolean).map(b=>`<span class="badge">${b}</span>`).join('');
    const p=n.__parent; const viol=p && (p.days_remaining!=null) && (n.days_remaining!=null) && (n.days_remaining < p.days_remaining);
    const cls='chip'+(viol?' violation':'');
    const ttip=`${n.cert_name} / ${n.version_id}\nvalid_until: ${n.valid_until || n.valid_until_raw || ''}\ndays_remaining: ${n.days_remaining ?? 'NA'}\nissuer_chain: ${n.__trace}`;
    return `<div class="${cls}" title="${ttip.replace(/"/g,'&quot;')}">
      <div class="line1"><strong class="mono">${n.version_id_short}</strong><span class="sla" style="background:${color}"></span></div>
      <div class="line2"><span>${n.days_remaining??'NA'}d</span><span>${n.valid_until || n.valid_until_raw || ''}</span></div>
      <div class="line2"><span>${n.issuer_version_short?('issuer '+n.issuer_version_short):''} ${n.__depth?('d'+n.__depth):''}</span><div class="badges">${badges}</div></div>
    </div>`;
  }
  function buildTier(title, arr){
    const div=document.createElement('div'); div.className='tier'; div.innerHTML=`<h5>${title}</h5><div class="chips"></div>`;
    const grid=div.querySelector('.chips'); arr.slice().sort(sortFn).forEach(n=>grid.insertAdjacentHTML('beforeend', chipHTML(n)));
    canvas.appendChild(div);
  }
  buildTier('ROOT CAs',roots); buildTier('TRANSITIONAL CAs',transCAs);
  for(let d=1; d<=maxInterDepth; d++) buildTier('INTERMEDIATE d'+d, (interLevels[d]||[]));
  buildTier('LEAVES',leaves);
}
window.resortCard = resortCard;

/* Insights */
function renderInsights(rows){
  const root=document.getElementById('insights'); if(!root) return; root.innerHTML='';
  const group=document.getElementById('groupHeatByFoundation')?.checked===true;
  const view=document.getElementById('insightsView')?.value || 'monthly';
  const events=rows.map(r=>({date:parseDate(r.valid_until||r.valid_until_raw),foundation:r.foundation,cert:r.cert_name,version:r.version_id_short})).filter(e=>e.date && !isNaN(e.date.getTime()));
  if(!events.length){ const c=document.createElement('div'); c.className='card'; c.innerHTML='<div class="muted">No valid expiration dates in scope.</div>'; root.appendChild(c); return; }
  if(!group){ appendPanels('Rotation Splash (All Foundations)', events, view, root); }
  else{ const byF={}; events.forEach(e => (byF[e.foundation]=byF[e.foundation]||[]).push(e)); Object.keys(byF).sort().forEach(f=>appendPanels('Rotation Splash — '+f, byF[f], view, root)); }
}
function parseDate(s){ try{ return s?new Date(s):null; }catch{ return null; } }
function startOfWeek(d){ const x=new Date(d); const day=x.getDay(); const diff=(day+6)%7; x.setDate(x.getDate()-diff); x.setHours(0,0,0,0); return x; }
function fmt(d){ return d.toISOString().slice(0,10); }
function buildWeekMap(events){ const m=new Map(); events.forEach(e=>{ const wk=startOfWeek(e.date); const k=fmt(wk); if(!m.has(k)) m.set(k,{count:0,items:[]}); const r=m.get(k); r.count++; r.items.push(e); }); return m; }
function appendPanels(title, events, view, root){ if(view==='hist') return appendWeeklyHistogram(title, events, root); if(view==='calendar') return appendCalendarStrip(title, events, root); return appendMonthlyPanels(title, events, root); }
function appendCalendarStrip(title, events, root){
  const weekMap=buildWeekMap(events); const minDt=new Date(Math.min(...events.map(e=>e.date.getTime()))); const horizon=new Date(); horizon.setMonth(horizon.getMonth()+12);
  const minWeek=startOfWeek(minDt); const weeks=[]; for(let d=new Date(minWeek); d<=horizon; d=new Date(d.getTime()+7*86400000)) weeks.push(new Date(d));
  const counts=weeks.map(w=>(weekMap.get(fmt(w))||{count:0}).count); const maxCount=Math.max(1,...counts);
  const cell=14,gap=2,padL=60,padT=18; const cols=weeks.length, vbW=padL+cols*(cell+gap)+10, vbH=padT+7*(cell+gap)+18;
  function color(n){ if(n<=0) return '#e5e7eb'; const t=n/maxCount; const a=0.25+0.75*t; return `rgba(22,163,74,${a})`; }
  let svg=`<svg viewBox="0 0 ${vbW} ${vbH}" width="100%" height="${vbH}" xmlns="http://www.w3.org/2000/svg">`; const dnames=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  for(let r=0;r<7;r++) svg+=`<text x="8" y="${padT + r*(cell+gap) + cell - 2}" font-size="10" fill="#475569">${dnames[r]}</text>`;
  function monthName(d){ return d.toLocaleString(undefined,{month:'short'}); } let last=-1;
  weeks.forEach((wk,i)=>{ const m=wk.getMonth(); if(m!==last){ svg+=`<text x="${padL + i*(cell+gap)}" y="12" font-size="11" fill="#0f172a">${monthName(wk)}</text>`; last=m; } });
  weeks.forEach((wk,c)=>{ for(let r=0;r<7;r++){ const k=fmt(startOfWeek(new Date(wk.getTime()+r*86400000))); const val=(weekMap.get(k)||{count:0}).count; const x=padL+c*(cell+gap), y=padT+r*(cell+gap); svg+=`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${color(val)}"><title>${k}\n${val} expiration(s)</title></rect>`; } });
  svg+=`</svg>`; const card=document.createElement('div'); card.className='card'; card.innerHTML=`<h4 style="margin:0 0 6px 0;">${title}</h4>${svg}`; root.appendChild(card); appendTopWeeks(title, weekMap, root);
}
function appendMonthlyPanels(title, events, root){
  const weekMap=buildWeekMap(events); const minDt=new Date(Math.min(...events.map(e=>e.date.getTime()))); const start=new Date(minDt.getFullYear(),minDt.getMonth(),1); const horizon=new Date(); horizon.setMonth(horizon.getMonth()+12); const end=new Date(horizon.getFullYear(),horizon.getMonth(),1);
  const months=[]; for(let d=new Date(start); d<=end; d=new Date(d.getFullYear(), d.getMonth()+1, 1)) months.push(new Date(d));
  const wrap=document.createElement('div'); wrap.className='card'; wrap.innerHTML=`<h4 style="margin:0 0 6px 0;">${title}</h4><div class="ins-grid"></div>`; const grid=wrap.querySelector('.ins-grid');
  months.forEach(md=>{
    const first=new Date(md.getFullYear(), md.getMonth(), 1); const last=new Date(md.getFullYear(), md.getMonth()+1, 0);
    const weeks=[]; const s=new Date(first); const sdiff=(s.getDay()+6)%7; s.setDate(s.getDate()-sdiff);
    for(let d=new Date(s); d<=last || d.getDay()!==1; d=new Date(d.getTime()+7*86400000)) weeks.push(new Date(d));
    const counts=weeks.map(w=>(weekMap.get(fmt(w))||{count:0}).count); const maxCount=Math.max(1,...counts);
    const cell=14,gap=2,padL=26,padT=18; const cols=weeks.length, vbW=padL+cols*(cell+gap)+8, vbH=padT+7*(cell+gap)+12;
    function color(n){ if(n<=0) return '#e5e7eb'; const t=n/maxCount; const a=0.25+0.75*t; return `rgba(22,163,74,${a})`; }
    let svg=`<svg viewBox="0 0 ${vbW} ${vbH}" width="100%" height="${vbH}" xmlns="http://www.w3.org/2000/svg">`; const dnames=['M','T','W','T','F','S','S'];
    for(let r=0;r<7;r++) svg+=`<text x="6" y="${padT + r*(cell+gap) + cell - 2}" font-size="9" fill="#475569">${dnames[r]}</text>`;
    weeks.forEach((wk,c)=>{ for(let r=0;r<7;r++){ const k=fmt(startOfWeek(new Date(wk.getTime()+r*86400000))); const val=(weekMap.get(k)||{count:0}).count; const x=padL+c*(cell+gap), y=padT+r*(cell+gap); svg+=`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${color(val)}"><title>${k}\n${val} expiration(s)</title></rect>`; } });
    svg+=`</svg>`; const mini=document.createElement('div'); mini.className='mini'; mini.innerHTML=`<h5>${md.toLocaleString(undefined,{month:'long', year:'numeric'})}</h5>${svg}`; grid.appendChild(mini);
  });
  root.appendChild(wrap); appendTopWeeks(title, weekMap, root);
}
function appendWeeklyHistogram(title, events, root){
  const weekMap=buildWeekMap(events); const weeks=Array.from(weekMap.keys()).sort(); const data=weeks.map(k=>weekMap.get(k).count);
  const card=document.createElement('div'); card.className='card'; const id='hist_'+Math.random().toString(36).slice(2); card.innerHTML=`<h4 style="margin:0 0 6px 0;">${title} — Weekly histogram</h4><canvas id="${id}" height="180"></canvas>`; root.appendChild(card);
  const ctx=document.getElementById(id).getContext('2d'); new Chart(ctx,{type:'bar',data:{labels:weeks,datasets:[{label:'Expirations',data,backgroundColor:'#16a34a'}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{ticks:{maxRotation:0,autoSkip:true,maxTicksLimit:12}}}}});
  appendTopWeeks(title, weekMap, root);
}
function appendTopWeeks(title, weekMap, root){
  const sorted=Array.from(weekMap.entries()).sort((a,b)=>b[1].count-a[1].count).slice(0,8);
  const top=document.createElement('div'); top.className='card'; let rowsHtml='';
  sorted.forEach(([k,rec])=>{ const list=rec.items.slice(0,5).map(e=>`${e.foundation} / ${e.cert} <code>${e.version}</code>`).join('<br/>'); rowsHtml+=`<tr><td><code>${k}</code></td><td style="text-align:right;"><strong>${rec.count}</strong></td><td>${list}${rec.items.length>5?'…':''}</td></tr>`; });
  if(!rowsHtml) rowsHtml='<tr><td colspan="3" class="muted">No upcoming expirations found.</td></tr>';
  top.innerHTML=`<h4 style="margin:0 0 6px 0;">Busiest Weeks — ${title}</h4>
    <table style="width:100%; border-collapse:collapse;">
      <thead><tr><th>Week (Mon)</th><th style="text-align:right;">Count</th><th>Examples</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
  root.appendChild(top);
}

/* helpers */
function showError(msg){ const b=document.getElementById('errorBanner'); if(!b) return; b.textContent=msg; b.style.display='block'; }
function setStatus(msg){ const s=document.getElementById('status'); if(s) s.textContent = msg||''; }

/* Exports */
function exportCSV(){ window.open('/api/export/csv','_blank'); }
function exportJSON(){ window.open('/api/export/json','_blank'); }
function downloadRunbook(){ window.open('/api/runbook','_blank'); }
