
/* minimal placeholder; this path expects prior build */
document.addEventListener('DOMContentLoaded', ()=>{});



// === Deployments tab additions ===
function collectDeployments(){
  const set=new Set();
  (RAW_ROWS||[]).forEach(r=>{
    const list = (r.deployments_list && Array.isArray(r.deployments_list)) ? r.deployments_list : String(r.deployments||'').split(/[,;]\s*/);
    list.forEach(x=>{ const v=(x||'').trim(); if(v) set.add(v); });
  });
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}
function populateDeploymentDatalist(){
  const dl=document.getElementById('depList'); if(!dl) return;
  const names=collectDeployments();
  dl.innerHTML = names.map(n=>`<option value="${n}">`).join('');
}
// augment refreshRows to also fill deployment list (if not already wrapped elsewhere)
if (typeof refreshRows === 'function') {
  const _oldRR = refreshRows;
  refreshRows = function(){
    fetch('/api/rows').then(r=>r.json()).then(rows=>{
      RAW_ROWS=rows; 
      if (typeof populateFoundationSelect === 'function') populateFoundationSelect();
      populateDeploymentDatalist();
      renderAll();
    }).catch(e=>showError(e.message));
  }
}

function renderDeployments(){
  const cont=document.getElementById('deployChains'); if(!cont) return;
  const help=document.getElementById('deployHelp');
  cont.innerHTML=''; if(help) help.style.display='none';

  const q=(document.getElementById('depQuery')?.value || '').trim();
  const exact=document.getElementById('depExact')?.checked===true;

  if(!q){
    // helper table of most common deployment_names
    const freq=new Map();
    (RAW_ROWS||[]).forEach(r=>{
      const list=(r.deployments_list && Array.isArray(r.deployments_list))? r.deployments_list : String(r.deployments||'').split(/[,;]\s*/);
      list.forEach(x=>{ const v=(x||'').trim(); if(v){ freq.set(v,(freq.get(v)||0)+1); } });
    });
    const top=Array.from(freq.entries()).sort((a,b)=>b[1]-a[1]).slice(0,30);
    const htmlRows = top.map(([name,count])=>`<tr><td>${name}</td><td style="text-align:right;">${count}</td></tr>`).join('');
    if(help){ help.style.display='block'; help.innerHTML = `<strong>Type a deployment_name to see correlated chains.</strong>
      <div class="muted" style="margin:6px 0 10px 0;">We parsed deployment_names from your uploaded Maestro files.</div>
      <table style="width:100%; border-collapse:collapse;">
        <thead><tr><th>Top deployment_name</th><th style="text-align:right;">Refs</th></tr></thead>
        <tbody>${htmlRows || '<tr><td colspan="2" class="muted">No deployments detected.</td></tr>'}</tbody>
      </table>`; }
    return;
  }

  const qlc=q.toLowerCase();
  const matched = (RAW_ROWS||[]).filter(r=>{
    const list=(r.deployments_list && Array.isArray(r.deployments_list))? r.deployments_list : String(r.deployments||'').split(/[,;]\s*/);
    return list.some(x=>{
      const v=(x||'').trim();
      if(!v) return false;
      return exact ? v===q : v.toLowerCase().includes(qlc);
    });
  });

  if(matched.length===0){
    const card=document.createElement('div'); card.className='card'; card.innerHTML=`<div class="muted">No matches for <code>${q}</code>.</div>`; cont.appendChild(card); return;
  }

  // Use existing chain renderer if present; otherwise, show a simple table fallback
  if (typeof renderChainsInto === 'function') {
    window.CARD_DATA_DEP = {};
    renderChainsInto(matched, 'deployChains', window.CARD_DATA_DEP);
  } else {
    const tbl=document.createElement('table');
    tbl.innerHTML='<thead><tr><th>Foundation</th><th>Cert</th><th>Version</th><th>Deployments</th><th>Days</th></tr></thead><tbody></tbody>';
    matched.forEach(r=>{
      const tr=document.createElement('tr');
      tr.innerHTML = `<td>${r.foundation}</td><td>${r.cert_name}</td><td>${r.version_id_short}</td><td>${r.deployments||''}</td><td>${r.days_remaining??''}</td>`;
      tbl.querySelector('tbody').appendChild(tr);
    });
    cont.appendChild(tbl);
  }
}

// Wire deploy tab controls into renderAll
(function(){
  const ids = ['depQuery','depExact','depGroupByFoundation','depZoom','depMaxH'];
  ids.forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    const evt = (el.tagName==='INPUT' && el.type==='range') ? 'input' : 'change';
    el.addEventListener(evt, ()=>{ if (typeof renderDeployments==='function') renderDeployments(); });
  });
})();
