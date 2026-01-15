
// ==UserScript==
// @name         Work List - Better GUI v1.9.19
// @namespace    brad-worklist-gui
// @version      1.9.19
// @description  Enhanced GUI with full Default toggle; uniform background via scoped overlay; robust & decoding; grouping, sorting, per-line status, filters, Word export.
// @match        https://pwr.nsmcloud.com.au/m/default.aspx
// @run-at       document-load
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://b-rad57-pixel.github.io/tampermonkey-scripts/my-script.user.js
// @downloadURL  https://b-rad57-pixel.github.io/tampermonkey-scripts/my-script.user.js
// ==/UserScript==


(() => {
  'use strict';

  const CONFIG = {
    jobItemSelector: '.cellItemJob',
    rowHeaderSelector: '.rowHeader',
    listContainerSelector: '#pageContent',
    completedColors: ['#33ff00', 'rgb(51,255,0)'],
    inProgressColors: ['#ffff00', 'rgb(255,255,0)'],
    periodicRescanMs: 1500
  };

  // ===== Styles (scoped to Enhanced mode only) =====
  GM_addStyle(`
    /* Uniform overlay behind content (no banding).
       We avoid negative z-index to keep it visible on all stacks. */
    body.tm-enhanced { position: relative; }
    body.tm-enhanced::before {
      content: '';
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      background:
        radial-gradient(1200px 600px at 50% -100px, rgba(255,255,255,0.06), rgba(255,255,255,0) 55%),
        linear-gradient(180deg, #2a2d30 0%, #1f2124 45%, #1a1c1f 100%);
      background-attachment: fixed;
    }

    /* Neutralize patterned backgrounds in the main worklist containers.
       Also bring them above the overlay. Do NOT touch topbar/header. */
    body.tm-enhanced #pageContent,
    body.tm-enhanced .gridContainer,
    body.tm-enhanced .rowCenter,
    body.tm-enhanced .main-content,
    body.tm-enhanced .content,
    body.tm-enhanced .page,
    body.tm-enhanced .container,
    body.tm-enhanced .wrapper {
      position: relative;
      z-index: 1;
      background: transparent !important;
      background-image: none !important;
    }

    /* --- Filter bar --- */
    #tm-filterbar{
      position:fixed;top:150px;left:50px;width:280px;max-height:calc(100vh - 100px);overflow:auto;z-index:999998;
      background:rgba(20,20,20,0.92);color:#fff;padding:12px;border-radius:12px;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
      box-shadow:0 8px 30px rgba(0,0,0,0.35);display:flex;flex-direction:column;gap:10px;
    }
    body.tm-enhanced.tm-has-filterbar{padding-left:260px!important;}
    #tm-filterbar .tm-pillbar{display:flex;gap:8px;flex-wrap:wrap;}
    #tm-filterbar .tm-pill{cursor:pointer;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.08);font-size:12px;font-weight:700;user-select:none;}
    #tm-filterbar .tm-pill.active{background:#2a8cff;border-color:#2a8cff;color:#fff;}
    #tm-filterbar .tm-checkgrp{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
    #tm-filterbar .tm-checkgrp .lbl{font-weight:800;font-size:12px;opacity:0.9;margin-right:4px;}
    #tm-filterbar .tm-checkgrp label{display:inline-flex;align-items:center;gap:6px;font-size:12px;background:rgba(255,255,255,0.08);padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,0.25);}
    #tm-filterbar select{
      font-size:12px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);
      background:rgba(255,255,255,0.08);color:#fff;outline:none;
      appearance:none;-webkit-appearance:none;-moz-appearance:none;
      background-color:#000!important;color:#fff!important;
      background-image:url("data:image/svg+xml;charset=UTF-8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24'><path d='M7 10l5 5 5-5' fill='none' stroke='white' stroke-width='2'/></svg>");
      background-repeat:no-repeat;background-position:right 10px center;background-size:14px 14px;padding-right:28px;
    }
    #tm-filterbar select::-ms-expand{display:none;}
    #tm-filterbar select option{background-color:#000!important;color:#fff!important;}

    /* --- Our cards only --- */
    .tm-card{display:block;padding:8px 10px;text-decoration:none;color:inherit;}
    .tm-jobwrap{display:flex;flex-direction:column;gap:6px;}
    .tm-code{font-size:15px;font-weight:800;line-height:1.2;}
    .tm-building{font-size:13px;opacity:0.88;font-weight:650;line-height:1.2;}
    .tm-types{font-size:13px;opacity:0.88;line-height:1.25;word-break:break-word;}
    .tm-types a.tm-servlink{color:inherit;text-decoration:none;}
    .tm-types a.tm-servlink:hover{text-decoration:underline;}
    .tm-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}
    .tm-badge{font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid rgba(0,0,0,0.10);background:rgba(255,255,255,0.12);font-weight:700;color:#fff;}
    .tm-badge-status{font-weight:900;background:#444;}
    .tm-completed .tm-badge-status{background:#15803d;}
    .tm-inprogress .tm-badge-status{background:#b45309;}
    .tm-statusicon{display:inline-block;min-width:1em;text-align:center;font-weight:900;margin-right:6px;}

    body.tm-enhanced .tm-card { background: rgba(0,0,0,0.10); border-radius: 12px; backdrop-filter:saturate(120%); }
    body.tm-enhanced #tm-filterbar { backdrop-filter: blur(4px); }
  `);

  // ===== State =====
  const state = {
    statusMode:'all',
    search:(typeof GM_getValue==='function')?GM_Get('tm-search',''):'',
    intervalChecks:new Set(),
    svcTypeDropdown:(typeof GM_getValue==='function')?GM_Get('tm-svctype','all'):'all',
    lastApplyTs:0,
    enhanced:true,
    observer:null,
    periodicTimer:null,
    origParents:new Set(),
    topSearch:null
  };

  // Small safe wrapper for GM_getValue (works when undefined)
  function GM_Get(key, def){ try { return GM_getValue ? GM_getValue(key, def) : def; } catch(_) { return def; } }
  function GM_Set(key, val){ try { if (GM_setValue) GM_setValue(key, val); } catch(_) {} }

  // ===== Utilities =====
  function parseRGB(s){
    const mHex=s && s.match(/^#([0-9a-f]{6})$/i);
    if(mHex){
      const h=mHex[1];
      return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
    }
    const mRgb=s && s.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if(mRgb) return[Number(mRgb[1]),Number(mRgb[2]),Number(mRgb[3])];
    return null;
  }
  function colorClose(a,b,tol=8){
    const pa=parseRGB(a),pb=parseRGB(b); if(!pa||!pb) return false;
    return Math.abs(pa[0]-pb[0])<=tol && Math.abs(pa[1]-pb[1])<=tol && Math.abs(pa[2]-pb[2])<=tol;
  }
  function isCompleted(jobEl){
    const cs=getComputedStyle(jobEl);
    const got=cs.borderLeftColor||'';
    return CONFIG.completedColors.some(ac=>colorClose(got, ac));
  }
  function isInProgress(jobEl){
    const cs=getComputedStyle(jobEl);
    const got=cs.borderLeftColor||'';
    return CONFIG.inProgressColors.some(ac=>colorClose(got, ac));
  }

  function normalize(s){
    return (s||'').replace(/\u00A0/g,' ')
      .replace(/[\u2012\u2013\u2014\u2212]/g,'-')
      .replace(/^\s*"+|"+\s*$/g,'')
      .replace(/\s{2,}/g,' ')
      .trim();
  }
  function getHtmlLines(jobEl){
    const a=jobEl.querySelector('a'); if(!a) return [];
    return (a.innerHTML||'').split(/<br\s*\/?>/i).map(s=>normalize(s.replace(/<[^>]*>/g,''))).filter(Boolean);
  }
  function extractLocationLine(lines){
    const line=lines.find(l=>/\([A-Z]{2,5}\d{1,6}\)\s*,/i.test(l))||lines.find(l=>/\([A-Z]{2,5}\d{1,6}\)/i.test(l));
    return line || (lines[2] || 'Unknown');
  }
  function extractSiteCodes(locationLine){
    const s=(locationLine||''); const tokens=[];
    const parenRe=/\(([^)]+)\)/g; let m;
    while((m=parenRe.exec(s))!==null){
      const inside=m[1]; const codeRe=/[A-Z]{2,5}\d{1,6}/g; let cm;
      while((cm=codeRe.exec(inside))!==null){tokens.push(cm[0].toUpperCase());}
    }
    if(tokens.length===0){
      const codeRe=/[A-Z]{2,5}\d{1,6}/g; let cm;
      while((cm=codeRe.exec(s))!==null){tokens.push(cm[0].toUpperCase());}
    }
    const out=[]; const seen=new Set();
    for(const c of tokens){ if(!seen.has(c)){ seen.add(c); out.push(c);} }
    return out.length?out:['NO-CODE'];
  }
  function stripCodeFromLocation(locationLine){
    return normalize((locationLine||'').replace(/\(\s*(?:[A-Z]{2,5}\d{1,6}\s*)+\)/g,'').replace(/\s{2,}/g,' '));
  }

  // Multi-pass HTML entity decode (&amp;amp;amp; → &amp;amp; → &amp;)
  function decodeHtmlEntitiesMultiple(str){
    let prev=null, loops=0, s=String(str||'');
    while (loops<5 && /&[a-zA-Z#0-9]+;/.test(s)) {
      const div=document.createElement('div');
      div.innerHTML = s;
      const dec = div.textContent;
      if (!dec || dec === s || dec === prev) break;
      prev = s;
      s = dec;
      loops++;
    }
    return s;
  }

  // Building name sanitizer
  function sanitizeBuildingName(name) {
    let s = decodeHtmlEntitiesMultiple(String(name||''));

    // --- NEW: remove any building ID tokens anywhere in the name ---
    // Examples: BD0102, BD0402, GDI1234, SR9701, etc.
    // 1) Remove leading code with optional separators like "-", ":".
    s = s.replace(/^\s*(?:[A-Z]{2,5}\d{1,6})\s*(?:[-:–—]\s*)?/, '');
    // 2) Remove standalone code tokens anywhere else in the string.
    s = s.replace(/\b[A-Z]{2,5}\d{1,6}\b/g, '');

    // Existing token removal (GDI/GAS/FIP) retained
    const tokens = ['GDI','GAS','FIP'];
    const re = new RegExp(`(^|[\\s,;/\\-|])(?:${tokens.join('|')})(?=([\\s,;/\\-|]|$))`,'gi');
    s = s.replace(re,(m,p1)=>(p1||' '));

    // Normalize separators/spacing
    s = s.replace(/[ ,;/|-]{2,}/g,' ');
    s = s.replace(/^[\s,;|/-]+/, '').replace(/[\s,;|/-]+$/,'');
    s = s.replace(/\s*-\s*/g,' - ').replace(/\s{2,}/g,' ').trim();
    return s;
  }

  // Zones / phrases
  const ZONES = [
    { label: '415v Substation', match: ['415v','415 v','415-volt'] },
    { label: 'Comms Room', match: ['comms',"comm's",'communications','comm room'] }
  ];
  const FIRE=['fire detection','fire detection & alarm systems','fire detection & alarm','fire detection and alarm','fire alarm','fdas','fip','fip panel','indicator panel','fire panel','fire system'];
  const SHS=['special hazard','special hazards','special hazard systems','special hazards systems','shs','gas system','gas suppression','inergen','novec','co2 system','deluge','pre-action','foam system','gaseous suppression'];
  const PUMP=['pumpset system','pumpset','pump','diesel engine pump','electric pump','jockey pump','flow test'];
  const SPR=['sprinkler system','sprink'];
  const TANK=['water storage tank','water tank','tank'];
  function detectZones(text){
    const t=(text||'').toLowerCase(); const zones=[];
    for(const z of ZONES){ if(z.match.some(m=>t.includes(m))) zones.push(z.label); }
    return Array.from(new Set(zones));
  }
  function collectServicePhrases(lines){
    const phrases=[]; for(const ln of lines){ if(/monthly\s*service/i.test(ln)){ const parts=ln.split(',').map(normalize).filter(Boolean); phrases.push(...parts);} }
    return phrases;
  }
  function detectTypeFromPhrase(p){
    const low=p.toLowerCase();
    if(FIRE.some(k=>low.includes(k))) return 'fire';
    if(SHS.some(k=>low.includes(k))) return 'shs';
    if(PUMP.some(k=>low.includes(k))) return 'pump';
    if(SPR.some(k=>low.includes(k))) return 'sprinkler';
    if(TANK.some(k=>low.includes(k))) return 'tank';
    return null;
  }
  function detectIntervalFromPhrase(p){const m=p.match(/\b(12|6|1)\s*monthly\s*service\b/i); return m?Number(m[1]):null;}
  function typeZoneFromDisplay(display){
    const t=display||'';
    if(/Fire Detection/i.test(t)) return {type:'fire', zone:''};
    if(/Special Hazards/i.test(t)){
      const parts=t.split(' - ');
      const zone=(parts.length>=3)?parts.slice(2).join(' - '):'';
      return {type:'shs', zone};
    }
    if(/Pumpset System/i.test(t)) return {type:'pump', zone:''};
    if(/Sprinkler System/i.test(t)) return {type:'sprinkler', zone:''};
    if(/Water Storage Tank/i.test(t)) return {type:'tank', zone:''};
    return {type:'other', zone:''};
  }
  function parseLineSignature(text){
    const im=/^(\d{1,2})m\b/i.exec(String(text||'')); const interval=im?Number(im[1]):null;
    const {type, zone}=typeZoneFromDisplay(text);
    return {type, zone, interval};
  }
  function sig(type, zone, interval){return `${String(type)}||${String(zone||'')}||${Number(interval)||0}`;}
  function orderForType(type){const order={fire:0,shs:1,pump:2,sprinkler:3,tank:4,other:5}; return (type in order)?order[type]:99;}

  // Solar Farm override
  function applySolarFarmRules(ctx){
    let { siteCodes, siteCodePrimary, buildingName, serviceLines, phraseMeta } = ctx;
    const isSolarFarm = /solar\s*farm/i.test(buildingName || '');
    if (!isSolarFarm) return ctx;

    if (siteCodePrimary === 'NO-CODE') {
      siteCodePrimary = 'SR9701';
      const codes = new Set(siteCodes || []);
      codes.delete('NO-CODE'); codes.add('SR9701');
      siteCodes = Array.from(codes);
    }

    const bld = String(buildingName || '');
    let zoneLabel = '';
    if (/\bsub\s*97\b/i.test(bld) || /\bsub97\b/i.test(bld) || /\bsubstation\b/i.test(bld)) zoneLabel = 'Substation';
    else if (/air\s*lock/i.test(bld) || /\bairlock\b/i.test(bld)) zoneLabel = 'Airlock';

    if (zoneLabel) {
      phraseMeta = (phraseMeta || []).map(m => (m.type === 'shs' ? { ...m, zone: zoneLabel } : m));
      serviceLines = (serviceLines || []).map(l => {
        const { type, interval } = parseLineSignature(l);
        if (type === 'shs') return `${(interval||1)}m - Special Hazards - ${zoneLabel}`;
        return l;
      });
    }
    return { siteCodes, siteCodePrimary, buildingName, serviceLines, phraseMeta };
  }

  // Phrase meta / lines
  function buildPhraseMeta(lines, buildingName, href){
    const phrases=collectServicePhrases(lines); const zones=detectZones(buildingName||''); const out=[];
    for(const p of phrases){
      const interval=detectIntervalFromPhrase(p); if(!interval) continue;
      const type=detectTypeFromPhrase(p)||'other';
      if(type==='shs' && zones.length){ for(const z of zones) out.push({interval,type,zone:z,href,text:p}); }
      else out.push({interval,type,zone:'',href,text:p});
    }
    return out;
  }
  function buildServiceLinesFromHtml(lines, buildingName){
    const phrases=collectServicePhrases(lines);
    const best={fire:null,shs:null,pump:null,sprinkler:null,tank:null,generic:null};
    const rank={12:3,6:2,1:1};
    for(const p of phrases){
      const n=detectIntervalFromPhrase(p); if(!n) continue;
      const type=detectTypeFromPhrase(p);
      if(type==='fire'){ if(!best.fire||rank[n]>rank[best.fire]) best.fire=n; }
      else if(type==='shs'){ if(!best.shs||rank[n]>rank[best.shs]) best.shs=n; }
      else if(type==='pump'){ if(!best.pump||rank[n]>rank[best.pump]) best.pump=n; }
      else if(type==='sprinkler'){ if(!best.sprinkler||rank[n]>rank[best.sprinkler]) best.sprinkler=n; }
      else if(type==='tank'){ if(!best.tank||rank[n]>rank[best.tank]) best.tank=n; }
      else { if(!best.generic||rank[n]>rank[best.generic]) best.generic=n; }
    }
    const out=[];
    if(best.fire) out.push(`${best.fire}m - Fire Detection`);
    if(best.shs){
      const zones=detectZones(buildingName||'');
      if(zones.length>=2) for(const z of zones) out.push(`${best.shs}m - Special Hazards - ${z}`);
      else out.push(`${best.shs}m - Special Hazards`);
    }
    if(best.pump) out.push(`${best.pump}m - Pumpset System`);
    if(best.sprinkler) out.push(`${best.sprinkler}m - Sprinkler System`);
    if(best.tank) out.push(`${best.tank}m - Water Storage Tank`);
    if(!out.length) out.push('— No services detected —');
    return out;
  }

  // Render card
  function renderCard(jobEl, siteCodes, buildingName, serviceLines, completed, lineLinkMap, lineStatusMap){
    // CHANGED: accurate overall status (partial complete => inProgress)
    let overallStatus = completed ? 'completed' : 'incomplete';
    if (lineStatusMap && Object.keys(lineStatusMap).length){
      const vals = Object.values(lineStatusMap);
      const allCompleted  = vals.length > 0 && vals.every(v => v === 'completed');
      const someCompleted = vals.some(v => v === 'completed');
      const anyInProgress = vals.some(v => v === 'inProgress');
      overallStatus = allCompleted ? 'completed'
                                   : ((anyInProgress || someCompleted) ? 'inProgress' : 'incomplete');
    }

    const intervals=new Set(); const svcTypes=new Set();
    const existingAnchor = jobEl.querySelector('a'); if (existingAnchor) existingAnchor.remove();

    const card = document.createElement('div'); card.className = 'tm-card';
    const wrap=document.createElement('div'); wrap.className='tm-jobwrap';
    if(overallStatus === 'completed') wrap.classList.add('tm-completed');
    if(overallStatus === 'inProgress') wrap.classList.add('tm-inprogress');

    const codeEl=document.createElement('div'); codeEl.className='tm-code'; codeEl.textContent=(siteCodes||[]).join(', ');
    const bldEl=document.createElement('div'); bldEl.className='tm-building'; bldEl.textContent=buildingName;

    const typesEl=document.createElement('div'); typesEl.className='tm-types'; typesEl.textContent='';
    (serviceLines || []).forEach(s=>{
      const lineDiv=document.createElement('div');
      const {type,zone,interval}=parseLineSignature(s);
      const key = sig(type, zone, interval);
      let href=''; let lineStatus='incomplete';

      if(lineLinkMap && lineLinkMap[key]) href = lineLinkMap[key];
      else {
        try {
          const meta = jobEl.dataset.tmPhraseMeta ? JSON.parse(jobEl.dataset.tmPhraseMeta) : [];
          const match = meta.find(m => m.type === type && (m.zone||'') === (zone||'') && m.interval === interval);
          href = match ? match.href : '';
          if (match) lineStatus = match.completed ? 'completed' : (match.inProgress ? 'inProgress' : 'incomplete');
        } catch(_) {}
      }
      if (lineStatusMap && lineStatusMap[key]) lineStatus = lineStatusMap[key];

      const icon=document.createElement('span'); icon.className='tm-statusicon'; icon.setAttribute('aria-hidden','true');
      if (lineStatus === 'completed') { icon.textContent='✓'; icon.style.color='#22c55e'; }
      else if (lineStatus === 'inProgress') { icon.textContent='↺'; icon.style.color='#f59e0b'; }
      else { icon.textContent=''; }

      const link=document.createElement('a'); link.className='tm-servlink'; link.textContent=`• ${s}`;
      if(href){
        link.href=href;
        link.addEventListener('click',(ev)=>{ if(ev.metaKey||ev.ctrlKey){ window.open(href,'_blank'); return; } ev.preventDefault(); window.location.href=href; });
      } else link.removeAttribute('href');

      if (interval) intervals.add(`${interval}m`);
      if (type) svcTypes.add(type);

      lineDiv.appendChild(icon);
      lineDiv.appendChild(link);
      typesEl.appendChild(lineDiv);
    });

    jobEl.dataset.tmIntervals=Array.from(intervals).join(',');
    jobEl.dataset.tmSvcTypes=Array.from(svcTypes).join(',');
    jobEl.dataset.tmServices=(serviceLines || []).join(' | ');
    jobEl.dataset.tmBuilding=buildingName;
    jobEl.dataset.tmCompleted=(overallStatus==='completed')?'1':'0';
    jobEl.dataset.tmStatus = overallStatus;
    jobEl.dataset.tmParsed='1';

    // NEW: force left border color to match aggregate status
    try {
      jobEl.style.borderLeftWidth = '5px';
      jobEl.style.borderLeftStyle = 'solid';
      if (overallStatus === 'completed') {
        jobEl.style.borderLeftColor = 'rgb(51,255,0)';   // green
      } else if (overallStatus === 'inProgress') {
        jobEl.style.borderLeftColor = 'rgb(255,255,0)';  // yellow
      } else {
        jobEl.style.borderLeftColor = 'rgba(255,255,255,0.25)'; // neutral
      }
    } catch(_) {}

    const badges = document.createElement('div'); badges.className='tm-badges';
    const statusBadge = document.createElement('div'); statusBadge.className='tm-badge tm-badge-status';
    statusBadge.textContent = (overallStatus==='completed') ? 'Completed' : ((overallStatus==='inProgress')?'In Progress':'Incomplete');
    badges.appendChild(statusBadge);

    wrap.appendChild(codeEl);
    wrap.appendChild(bldEl);
    wrap.appendChild(typesEl);
    wrap.appendChild(badges);
    card.appendChild(wrap);
    jobEl.innerHTML = ''; jobEl.appendChild(card);
  }

  // Parse each job
  function ensureParsed(jobEl){
    const completedNow=isCompleted(jobEl);
    const inProgressNow=isInProgress(jobEl);

    // CHANGED: also save original style so we can restore on Default toggle
    if (!jobEl.dataset.tmOriginalHTML) {
      jobEl.dataset.tmOriginalHTML = jobEl.innerHTML || '';
      jobEl.dataset.tmOriginalStyle = jobEl.getAttribute('style') || '';
    }

    if(jobEl.dataset.tmParsed==='1'){
      jobEl.dataset.tmCompleted=completedNow?'1':'0';
      try {
        const meta = jobEl.dataset.tmPhraseMeta ? JSON.parse(jobEl.dataset.tmPhraseMeta) : [];
        const updated = meta.map(m => ({...m, completed: completedNow, inProgress: inProgressNow}));
        jobEl.dataset.tmPhraseMeta = JSON.stringify(updated);
      } catch(_) {}
      return;
    }

    const lines=getHtmlLines(jobEl);
    const locationLineRaw=extractLocationLine(lines);
    let siteCodes=extractSiteCodes(locationLineRaw);
    let siteCodePrimary=siteCodes[0];

    let buildingNameRaw = stripCodeFromLocation(locationLineRaw).split(',')[0].trim() || 'Unknown';
    let buildingName = sanitizeBuildingName(buildingNameRaw);

    const a=jobEl.querySelector('a'); const href=a? (a.getAttribute('href')||'') : '';

    let phraseMeta=buildPhraseMeta(lines, buildingName, href).map(m => ({
      ...m, completed: completedNow, inProgress: inProgressNow
    }));

    let serviceLines=buildServiceLinesFromHtml(lines, buildingName);

    ({ siteCodes, siteCodePrimary, buildingName, serviceLines, phraseMeta } =
      applySolarFarmRules({ siteCodes, siteCodePrimary, buildingName, serviceLines, phraseMeta }));

    buildingName = sanitizeBuildingName(buildingName);

    jobEl.dataset.tmPhraseMeta=JSON.stringify(phraseMeta);
    jobEl.dataset.tmSiteCodes=(siteCodes || []).join(',');
    jobEl.dataset.tmSiteCode=siteCodePrimary;
    jobEl.dataset.tmLocation=locationLineRaw;

    const perLine = {};
    (serviceLines || []).forEach(s => {
      const {type,zone,interval} = parseLineSignature(s);
      perLine[sig(type,zone,interval)] = completedNow ? 'completed' : (inProgressNow ? 'inProgress' : 'incomplete');
    });

    renderCard(jobEl, siteCodes, buildingName, serviceLines, completedNow, null, perLine);
  }

  // Aggregate + grouping
  function aggregateServiceLinesAcrossJobs(jobEls){
    const best=new Map();
    const stats=new Map();
    for(const job of jobEls){
      const raw=job.dataset.tmPhraseMeta? JSON.parse(job.dataset.tmPhraseMeta) : [];
      for(const meta of raw){
        const {interval,type,zone,href,completed,inProgress}=meta; if(!interval||!type) continue;
        const key=`${type}||${zone||''}`;
        const prev=best.get(key);
        if(!prev||interval>prev.interval) best.set(key,{interval,type,zone:zone||'',href});
        const s = stats.get(key) || { total:0, completed:0, inProgress:0 };
        s.total += 1; if (completed) s.completed += 1; else if (inProgress) s.inProgress += 1;
        stats.set(key, s);
      }
    }

    const shsKeys = Array.from(best.keys()).filter(k => k.startsWith('shs||'));
    const shsZones = new Set(shsKeys.map(k => k.split('||')[1] || ''));
    const singleShsZoneOnly = shsZones.size === 1;

    const lines=[]; const lineLinks={}; const lineStatuses={};
    const sorted=Array.from(best.values()).sort((a,b)=>orderForType(a.type)-orderForType(b.type) || (b.interval-a.interval) || a.zone.localeCompare(b.zone));

    // CHANGED: partial complete => inProgress
    const deriveStatus = (type, zone) => {
      const s = stats.get(`${type}||${zone||''}`) || { total:0, completed:0, inProgress:0 };
      if (s.total > 0 && s.completed === s.total) return 'completed';
      if (s.inProgress > 0 || (s.completed > 0 && s.completed < s.total)) return 'inProgress';
      return 'incomplete';
    };

    if (singleShsZoneOnly) {
      for (const o of sorted) {
        if (o.type === 'shs') continue;
        let text;
        if(o.type==='fire') text=`${o.interval}m - Fire Detection`;
        else if(o.type==='pump') text=`${o.interval}m - Pumpset System`;
        else if(o.type==='sprinkler') text=`${o.interval}m - Sprinkler System`;
        else if(o.type==='tank') text=`${o.interval}m - Water Storage Tank`;
        else text=`${o.interval}m - Monthly Service`;
        lines.push(text);
        lineLinks[sig(o.type,o.zone,o.interval)] = o.href || '';
        lineStatuses[sig(o.type,o.zone,o.interval)] = deriveStatus(o.type, o.zone);
      }
      const soleZone = shsZones.values().next().value || '';
      const shsObj = best.get(`shs||${soleZone}`);
      if (shsObj) {
        const collapsedText = `${shsObj.interval}m - Special Hazards`;
        lines.push(collapsedText);
        const collapsedKey = sig('shs','',shsObj.interval);
        lineLinks[collapsedKey]    = shsObj.href || '';
        lineStatuses[collapsedKey] = deriveStatus('shs', soleZone);
      }
    } else {
      for(const o of sorted){
        let text;
        if(o.type==='fire') text=`${o.interval}m - Fire Detection`;
        else if(o.type==='shs') text=`${o.interval}m - Special Hazards${o.zone?` - ${o.zone}`:''}`;
        else if(o.type==='pump') text=`${o.interval}m - Pumpset System`;
        else if(o.type==='sprinkler') text=`${o.interval}m - Sprinkler System`;
        else if(o.type==='tank') text=`${o.interval}m - Water Storage Tank`;
        else text=`${o.interval}m - Monthly Service`;
        lines.push(text);
        lineLinks[sig(o.type,o.zone,o.interval)] = o.href || '';
        lineStatuses[sig(o.type,o.zone,o.interval)] = deriveStatus(o.type, o.zone);
      }
    }
    if(!lines.length) lines.push('— No services detected —');
    return {lines, lineLinks, lineStatuses};
  }

  function groupDuplicateCodes(){
    const raw=Array.from(document.querySelectorAll(CONFIG.jobItemSelector)).filter(el=>el.dataset.tmSuppressed!=='1');
    const map=new Map();
    for(const job of raw){
      ensureParsed(job);
      const code=job.dataset.tmSiteCode||'NO-CODE';
      if(!map.has(code)) map.set(code,[]);
      map.get(code).push(job);
    }
    for(const [code,list] of map.entries()){
      if(list.length<=1) continue;
      const primary=list[0]; const others=list.slice(1);
      const buildingName=primary.dataset.tmBuilding||'Unknown';
      const siteCodes=(primary.dataset.tmSiteCodes||primary.dataset.tmSiteCode||'NO-CODE').split(',').map(s=>s.trim()).filter(Boolean);
      const {lines:combinedLines, lineLinks, lineStatuses}=aggregateServiceLinesAcrossJobs(list);
      renderCard(primary, siteCodes, buildingName, combinedLines, false, lineLinks, lineStatuses);
      for(const j of others){ j.dataset.tmSuppressed='1'; j.style.display='none'; }
      primary.dataset.tmGrouped='1';
    }
  }

  // Header cleanup
  function syncHeadersWithJobs() {
    const headers = Array.from(document.querySelectorAll(CONFIG.rowHeaderSelector));
    for (const hdr of headers) {
      if (!hdr.dataset.tmHeaderOriginalHTML) {
        hdr.dataset.tmHeaderOriginalHTML = hdr.innerHTML || '';
        hdr.dataset.tmHeaderOriginalStyle = hdr.getAttribute('style') || '';
      }
      let job = hdr.nextElementSibling;
      while (job && !job.matches(CONFIG.jobItemSelector)) job = job.nextElementSibling;
      if (!job) continue;
      const isHidden = (job.style.display === 'none') || (job.dataset.tmSuppressed === '1');
      if (isHidden) hdr.style.display = 'none';
      else {
        hdr.style.display = '';
        hdr.innerHTML = '';
        hdr.style.height = '0px';
        hdr.style.margin = '8px 0';
        hdr.style.background = 'transparent';
        hdr.style.borderBottom = '5px solid rgba(255,255,255,0.25)';
        hdr.style.pointerEvents = 'none';
      }
    }
  }

  // Sorting
  function sortJobsByBuildingId(){
    const jobs = Array.from(document.querySelectorAll(CONFIG.jobItemSelector)).filter(j => j.dataset.tmSuppressed !== '1');
    const triples = jobs.map(job => {
      let prev = job.previousElementSibling;
      while (prev && !prev.matches(CONFIG.rowHeaderSelector)) prev = prev.previousElementSibling;
      const header = (prev && prev.matches(CONFIG.rowHeaderSelector)) ? prev : null;
      const parent = (header?.parentElement) || job.parentElement;
      return { job, header, parent };
    });
    triples.sort((a, b) => {
      const aCode = (a.job.dataset.tmSiteCode || '').trim();
      const bCode = (b.job.dataset.tmSiteCode || '').trim();
      const codeCmp = aCode.localeCompare(bCode, undefined, { numeric:true, sensitivity:'base' });
      if (codeCmp !== 0) return codeCmp;
      const aBld = (a.job.dataset.tmBuilding || '').trim();
      const bBld = (b.job.dataset.tmBuilding || '').trim();
      return aBld.localeCompare(bBld, undefined, { sensitivity:'base' });
    });
    for (const { header, job, parent } of triples) {
      if (header && header.parentElement === parent) parent.appendChild(header);
      if (job.parentElement === parent) parent.appendChild(job);
    }
  }

  // Filters / facets
  function getJobItems(){ return Array.from(document.querySelectorAll(CONFIG.jobItemSelector)).filter(el=>el.dataset.tmSuppressed!=='1'); }
  function rebuildFacets(){
    const raw=Array.from(document.querySelectorAll(CONFIG.jobItemSelector));
    for(const job of raw) ensureParsed(job);
    groupDuplicateCodes();
    sortJobsByBuildingId();
    syncHeadersWithJobs();
  }
  function matchesSearch(jobEl){
    if(!state.search) return true;
    const hay=((jobEl.dataset.tmSiteCodes||jobEl.dataset.tmSiteCode||'')+' '+(jobEl.dataset.tmBuilding||'')+' '+(jobEl.dataset.tmLocation||'')+' '+(jobEl.dataset.tmServices||'')).toLowerCase();
    return hay.includes(state.search.toLowerCase());
  }
  function matchesInterval(jobEl){
    if(state.intervalChecks.size===0) return true;
    const ints=new Set((jobEl.dataset.tmIntervals||'').split(',').map(s=>s.trim()).filter(Boolean));
    for(const want of state.intervalChecks) if(ints.has(want)) return true;
    return false;
  }
  function matchesSvcTypeDropdown(jobEl){
    if(state.svcTypeDropdown==='all') return true;
    const types=new Set((jobEl.dataset.tmSvcTypes||'').split(',').map(s=>s.trim()).filter(Boolean));
    return types.has(state.svcTypeDropdown);
  }

  // Export
  function exportVisibleJobsToWord(){
    const jobs = getJobItems().filter(j => j.style.display !== 'none');
    const rows = [];
    for (const job of jobs) {
      const code = job.dataset.tmSiteCode || (job.dataset.tmSiteCodes || '').split(',')[0] || 'NO-CODE';
      const services = (job.dataset.tmServices || '').split('|').map(s => s.trim()).filter(s => s && s !== '— No services detected —');
      const highest = services[0] || '';
      if (!highest) continue;
      rows.push({ code, highest });
    }
    if (!rows.length) { alert('No visible jobs to export.'); return; }

    const today = new Date();
    const dateStr = today.toLocaleDateString(undefined, { year:'numeric', month:'2-digit', day:'2-digit' }).replace(/\//g,'-');
    const title = `Jobs Export (${dateStr})`;
    const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const half = Math.ceil(rows.length / 2);
    const left = rows.slice(0, half);
    const right = rows.slice(half);
    const colHtml = arr => arr.map(r =>
      '<div class="item"><span class="code">'+esc(r.code)+'</span> — <span class="svc">'+esc(r.highest)+'</span></div>'
    ).join('');

    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+esc(title)+'</title>'
      + '<style>@page{size:A4;margin:20mm;}body{font-family:"Segoe UI",Arial,sans-serif;color:#000;}'
      + 'h1{font-size:16pt;margin:0 0 10pt 0;}table{width:100%;table-layout:fixed;border-collapse:collapse;}'
      + 'td{vertical-align:top;width:50%;padding-right:9pt;}.item{margin:0 0 6pt 0;}.code{font-weight:700;}.svc{color:#333;}</style>'
      + '</head><body><h1>'+esc(title)+'</h1><table><tr><td>'+colHtml(left)+'</td><td>'+colHtml(right)+'</td></tr></table>'
      + '</body></html>';

    const blob = new Blob([html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `Jobs_${dateStr}.doc`; document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  // Top search hook + unhook
  function hookTopSearch(){
    let tries = 0;
    const timer = setInterval(()=>{
      tries++;
      const topInput = document.getElementById('txtPropertySearch');
      const topLink  = document.getElementById('lnkSearch');
      if (topInput) {
        clearInterval(timer);

        const originals = {
          placeholder: topInput.getAttribute('placeholder'),
          style: topInput.getAttribute('style') || ''
        };
        let linkOriginals = null;
        if (topLink) linkOriginals = { href: topLink.getAttribute('href') };

        topInput.value = state.search || '';
        try {
          topInput.placeholder = 'Search code / building / type…';
          topInput.style.width = '75%';
          topInput.style.background = 'rgba(255,255,255,0.08)';
          topInput.style.color = '#fff';
          topInput.style.border = '1px solid rgba(255,255,255,0.25)';
          topInput.style.borderRadius = '8px';
          topInput.style.padding = '6px 8px';
          topInput.style.outline = 'none';
        } catch(_) {}

        let debId = null;
        const onChange = () => {
          const val = (topInput.value || '').trim();
          state.search = val;
          GM_Set('tm-search', state.search);
          clearTimeout(debId);
          debId = setTimeout(() => { applyFilters(); }, 120);
        };
        const onKeyDown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); onChange(); } };

        topInput.addEventListener('input', onChange);
        topInput.addEventListener('keydown', onKeyDown);

        let linkOnClick = null;
        if (topLink) {
          linkOnClick = (ev) => { ev.preventDefault(); ev.stopPropagation(); onChange(); };
          topLink.addEventListener('click', linkOnClick);
          try { topLink.setAttribute('href', 'javascript:void(0)'); } catch(_) {}
        }

        const form = topInput.closest('form');
        let formOnSubmit = null;
        if (form) {
          formOnSubmit = (ev) => { ev.preventDefault(); ev.stopPropagation(); onChange(); };
          form.addEventListener('submit', formOnSubmit);
        }

        state.topSearch = {
          input: topInput, link: topLink || null, form: form || null,
          handlers: { onChange, onKeyDown, linkOnClick, formOnSubmit },
          originals: { input: originals, link: linkOriginals }
        };

        applyFilters();
      }
      if (tries > 40) clearInterval(timer);
    }, 150);
  }
  function unhookTopSearch(){
    const ts = state.topSearch; if (!ts) return;
    try {
      if (ts.input && ts.handlers.onChange) ts.input.removeEventListener('input', ts.handlers.onChange);
      if (ts.input && ts.handlers.onKeyDown) ts.input.removeEventListener('keydown', ts.handlers.onKeyDown);
      if (ts.link && ts.handlers.linkOnClick) ts.link.removeEventListener('click', ts.handlers.linkOnClick);
      if (ts.form && ts.handlers.formOnSubmit) ts.form.removeEventListener('submit', ts.handlers.formOnSubmit);
    } catch(_) {}
    try {
      if (ts.input) {
        const o = ts.originals.input || {};
        if (o.placeholder !== undefined) ts.input.setAttribute('placeholder', o.placeholder ?? '');
        if (o.style !== undefined) ts.input.setAttribute('style', o.style ?? '');
      }
      if (ts.link && ts.originals.link) {
        const o = ts.originals.link;
        if (o.href !== undefined && o.href !== null) ts.link.setAttribute('href', o.href);
        else ts.link.removeAttribute('href');
      }
    } catch(_) {}
    state.topSearch = null;
  }

  // Live updates
  function setupLiveUpdates(){
    let debounceId=null;
    const container=document.querySelector(CONFIG.listContainerSelector)||document.body;
    const observer=new MutationObserver(()=>{ clearTimeout(debounceId); debounceId=setTimeout(()=>{ rebuildFacets(); applyFilters(); },150); });
    observer.observe(container,{childList:true,subtree:true});
    state.observer = observer;

    if(CONFIG.periodicRescanMs&&CONFIG.periodicRescanMs>0){
      const id = setInterval(()=>{
        if (Date.now() - (state.lastApplyTs || 0) > 10000) { rebuildFacets(); applyFilters(); }
      }, CONFIG.periodicRescanMs);
      state.periodicTimer = id;
    }
  }

  // Enhanced ↔ Default
  function captureOriginalOrdering(){
    const all = Array.from(document.querySelectorAll(`${CONFIG.rowHeaderSelector}, ${CONFIG.jobItemSelector}`));
    const parents = new Set(all.map(el => el.parentElement).filter(Boolean));
    state.origParents = parents;
    parents.forEach(parent => {
      let idx = 0;
      Array.from(parent.children).forEach(child => {
        if (child.matches(CONFIG.rowHeaderSelector) || child.matches(CONFIG.jobItemSelector)) {
          if (!child.dataset.tmOrigOrder) child.dataset.tmOrigOrder = String(idx);
          idx++;
        }
      });
    });
  }
  function restoreOriginalOrder(){
    state.origParents.forEach(parent => {
      const items = Array.from(parent.children).filter(ch => ch.matches(CONFIG.rowHeaderSelector) || ch.matches(CONFIG.jobItemSelector));
      const sortable = items.filter(ch => ch.dataset.tmOrigOrder !== undefined);
      sortable.sort((a,b) => Number(a.dataset.tmOrigOrder||0) - Number(b.dataset.tmOrigOrder||0));
      for (const el of sortable) parent.appendChild(el);
    });
  }

  function disableEnhancedUI(){
    state.enhanced = false;

    // Remove enhanced class
    document.body.classList.remove('tm-enhanced');

    // Remove filter bar
    const fb = document.getElementById('tm-filterbar'); if (fb) fb.remove();
    document.body.classList.remove('tm-has-filterbar');

    // Stop observers/timers
    if (state.observer) { try { state.observer.disconnect(); } catch(_) {} state.observer = null; }
    if (state.periodicTimer) { clearInterval(state.periodicTimer); state.periodicTimer = null; }

    // Unhook search
    unhookTopSearch();

    // Restore jobs
    const jobs = Array.from(document.querySelectorAll(CONFIG.jobItemSelector));
    for (const job of jobs) {
      job.style.display = '';
      job.dataset.tmSuppressed = '';
      job.dataset.tmGrouped = '';
      job.dataset.tmParsed = '';
      if (job.dataset.tmOriginalHTML) job.innerHTML = job.dataset.tmOriginalHTML;
      if (job.dataset.tmOriginalStyle !== undefined) job.setAttribute('style', job.dataset.tmOriginalStyle || ''); // NEW: restore style
      delete job.dataset.tmPhraseMeta;
      delete job.dataset.tmSiteCodes;
      delete job.dataset.tmSiteCode;
      delete job.dataset.tmLocation;
      delete job.dataset.tmIntervals;
      delete job.dataset.tmSvcTypes;
      delete job.dataset.tmServices;
      delete job.dataset.tmBuilding;
      delete job.dataset.tmCompleted;
      delete job.dataset.tmStatus;
    }

    // Restore headers
    const headers = Array.from(document.querySelectorAll(CONFIG.rowHeaderSelector));
    for (const hdr of headers) {
      hdr.style.display = '';
      try {
        if (hdr.dataset.tmHeaderOriginalHTML !== undefined) hdr.innerHTML = hdr.dataset.tmHeaderOriginalHTML;
        if (hdr.dataset.tmHeaderOriginalStyle !== undefined) hdr.setAttribute('style', hdr.dataset.tmHeaderOriginalStyle || '');
      } catch(_) {}
      hdr.style.height = '';
      hdr.style.margin = '';
      hdr.style.background = '';
      hdr.style.borderBottom = '';
      hdr.style.pointerEvents = '';
    }

    // Restore order
    restoreOriginalOrder();
  }

  function enableEnhancedUI(){
    state.enhanced = true;
    document.body.classList.add('tm-enhanced');
    ensureUI();
    rebuildFacets();
    applyFilters();
    setupLiveUpdates();
    hookTopSearch();
  }

  // Filter bar UI
  function makePill(label, mode){
    const el=document.createElement('div'); el.className='tm-pill'; el.textContent=label; el.dataset.mode=mode;
    el.addEventListener('click',()=>{ state.statusMode=mode; document.querySelectorAll('#tm-filterbar .tm-pill').forEach(p=>p.classList.toggle('active',p.dataset.mode===mode)); applyFilters(); });
    return el;
  }
  function ensureUI(){
    if(document.getElementById('tm-filterbar')) return;
    document.body.classList.add('tm-has-filterbar');

    const bar=document.createElement('div'); bar.id='tm-filterbar';

    const pillbar=document.createElement('div'); pillbar.className='tm-pillbar';
    const pAll=makePill('All','all'), pComp=makePill('Completed','completed'), pIncomp=makePill('Incomplete','incomplete');
    pillbar.appendChild(pAll); pillbar.appendChild(pComp); pillbar.appendChild(pIncomp); pAll.classList.add('active');

    const svcTypeSel=document.createElement('select');
    svcTypeSel.id='tm-svctype';
    svcTypeSel.innerHTML = `
      <option value="all">All service types</option>
      <option value="fire">Fire</option>
      <option value="shs">SHS</option>
      <option value="pump">Pump</option>
      <option value="sprinkler">Sprinkler</option>
      <option value="tank">Tank</option>
    `;
    svcTypeSel.value = state.svcTypeDropdown || 'all';
    svcTypeSel.addEventListener('change',()=>{
      state.svcTypeDropdown = svcTypeSel.value;
      GM_Set('tm-svctype', state.svcTypeDropdown);
      applyFilters();
    });

    const intervalGrp=document.createElement('div'); intervalGrp.className='tm-checkgrp';
    intervalGrp.innerHTML=`<span class="lbl">Interval</span>
      <label><input type="checkbox" data-int="1m">1m</label>
      <label><input type="checkbox" data-int="6m">6m</label>
      <label><input type="checkbox" data-int="12m">12m</label>`;
    intervalGrp.addEventListener('change',()=>{
      state.intervalChecks.clear();
      intervalGrp.querySelectorAll('input[type="checkbox"]:checked').forEach(cb=>state.intervalChecks.add(cb.getAttribute('data-int')));
      applyFilters();
    });

    bar.appendChild(pillbar);
    bar.appendChild(svcTypeSel);
    bar.appendChild(intervalGrp);

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export to Word (visible)';
    exportBtn.addEventListener('click', exportVisibleJobsToWord);
    bar.appendChild(exportBtn);

    const count=document.createElement('div'); count.id='tm-count'; count.textContent='Showing 0 / 0';
    bar.appendChild(count);

    document.body.appendChild(bar);
  }

  // Filtering
  function applyFilters(){
    const jobs=getJobItems(); let shown=0;
    for(const job of jobs){
      const completed=job.dataset.tmCompleted==='1';
      let ok=true;
      if(state.statusMode==='completed'&& !completed) ok=false;
      if(state.statusMode==='incomplete'&& completed) ok=false;
      if(!matchesInterval(job)) ok=false;
      if(!matchesSvcTypeDropdown(job)) ok=false;
      if(!matchesSearch(job)) ok=false;
      job.style.display=ok?'':'none';
      if(ok) shown++;
    }
    const countEl=document.getElementById('tm-count'); if(countEl) countEl.textContent=`Showing ${shown} / ${jobs.length}`;
    state.lastApplyTs=Date.now();
    syncHeadersWithJobs();
  }

  // Toggle button
  function ensureToggleButton(){
    if (document.getElementById('tm-default-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'tm-default-toggle';
    btn.setAttribute('aria-label','Toggle default/enhanced view');
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '16px',
      right: '16px',
      zIndex: '999999',
      padding: '8px 12px',
      borderRadius: '999px',
      border: '1px solid rgba(255,255,255,0.25)',
      background: 'rgba(0,0,0,0.50)',
      color: '#fff',
      fontSize: '12px',
      fontWeight: '800',
      cursor: 'pointer',
      boxShadow: '0 6px 18px rgba(0,0,0,0.30)',
      backdropFilter: 'blur(4px)',
    });
    const label = () => { btn.textContent = state.enhanced ? 'Default' : 'Enhanced'; btn.title = state.enhanced ? 'Return to default view' : 'Enable enhanced GUI'; };
    label();
    btn.addEventListener('click', () => { if (state.enhanced) disableEnhancedUI(); else enableEnhancedUI(); label(); });
    document.body.appendChild(btn);
  }

  // Boot
  function boot(){
    captureOriginalOrdering();
    document.body.classList.add('tm-enhanced');  // enable overlay + scoped styles
    ensureUI();
    ensureToggleButton();
    rebuildFacets();
    hookTopSearch();
    applyFilters();
    setupLiveUpdates();
  }
  function waitForJobsThenBoot(){
    let tries=0;
    const t=setInterval(()=>{
      tries++;
      if(document.querySelector(CONFIG.jobItemSelector)){ clearInterval(t); try { boot(); } catch(e){ console.error('[WorkList GUI] boot failed:', e); } }
      if(tries>120) clearInterval(t);
    },500);
  }
  waitForJobsThenBoot();

})();
