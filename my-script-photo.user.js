
// ==UserScript==
// @name         NSM - Unified: Auto Answer + Signature (Robust) + Take Photo
// @namespace    rtio.nsm.unified
// @version      3.0.0
// @description  Auto-answers rules, fills tech name, Next; ticks signature checkbox + robust auto-save; mobile Take Photo modal that injects into file input and clicks native Upload.
// @match        https://pwr.nsmcloud.com.au/*/ServiceReportQuestion.aspx*AnswersReportID=*
// @match        https://pwr.nsmcloud.com.au/*/servicereportquestion.aspx*AnswersReportID=*
// @match        https://pwr.nsmcloud.com.au/m/servicereportquestion.aspx*
// @match        https://pwr.nsmcloud.com.au/*/signature.aspx*visitId=*
// @match        https://pwr.nsmcloud.com.au/*/signature.aspx*visitid=*
// @run-at       document-idle
// @grant        GM_addStyle
// @updateURL    https://b-rad57-pixel.github.io/tampermonkey-scripts/my-script-photo.user.js
// @downloadURL  https://b-rad57-pixel.github.io/tampermonkey-scripts/my-script-photo.user.js
// ==/UserScript==

(() => {
  'use strict';

  /**************************************************************************
   * GLOBAL CONFIG
   **************************************************************************/
  const DEBUG = false;
  const log = (...a) => { if (DEBUG) console.debug('[NSM-UNIFIED]', ...a); };

  /**************************************************************************
   * COMMON: WebForms submit helpers
   **************************************************************************/
  function callValidated(eventTargetName) {
    const fire = () => {
      try {
        if (typeof window.WebForm_PostBackOptions === 'function' &&
            typeof window.WebForm_DoPostBackWithOptions === 'function') {
          const opts = new window.WebForm_PostBackOptions(
            eventTargetName, '', true, '', '', false, false
          );
          window.WebForm_DoPostBackWithOptions(opts);
          log(`WebForm_DoPostBackWithOptions(${eventTargetName})`);
        } else if (typeof window.__doPostBack === 'function') {
          window.__doPostBack(eventTargetName, '');
          log(`__doPostBack(${eventTargetName})`);
        } else {
          log('No WebForms submit API found.');
        }
      } catch (e) {
        log('Submit error:', e);
      }
    };
    setTimeout(fire, 80);
  }

  /**************************************************************************
   * PAGE DETECTION
   **************************************************************************/
  const href = location.href;
  const HREF = href.toLowerCase();
  const IS_SIGNATURE = HREF.includes('/signature.aspx');
  const IS_QUESTION  = HREF.includes('/servicereportquestion.aspx');
  const IS_MOBILE_Q  = HREF.includes('://pwr.nsmcloud.com.au/m/servicereportquestion.aspx');

  /**************************************************************************
   * PART 1: ServiceReportQuestion pages (rules)
   **************************************************************************/
  const NEXT_NAME = 'cmdNext';
  const DEFAULT_TECH_NAME = 'Brad R';
  const FILL_WHEN_EMPTY_ONLY = false;

  // Rules preserved from your previous script
  const RULES = [
    // Text-fill: Sign off / Technician Name
    { mustInclude: ['sign off', 'technician name'], fillValue: DEFAULT_TECH_NAME },

    // Parts & Rectifications => Pass
    {
      mustInclude: [
        'parts and rectifications',
        'defects unable to be rectified on the spot',
        'service request',
        'technical team to quote'
      ],
      answer: 'Pass'
    },

    {
      mustInclude: [
        'monthly',
        'as1851-2012',
        'fire detection and alarm systems'
      ],
      answer: 'Pass'
    },

    // AS1851 Monthly => Pass
    {
      mustInclude: [
        'monthly',
        'as1851-2012',
        'special hazard systems'
      ],
      answer: 'Pass'
    },

    // Acknowledgement SWI => Yes
    {
      mustInclude: [
        'i acknowledge that i have read, understand',
        'pwr safe work instruction'
      ],
      answer: 'Yes'
    },

    // Asset details correct as per Property Alert => Yes
    {
      mustInclude: [
        'are the asset details correct',
        'property alert'
      ],
      answer: 'Yes'
    },
  ];

  function normalize(s) {
    return String(s || '').replace(/\u2022/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function cleanLabel(s) {
    return normalize(s).replace(/[:.]/g, '').replace(/\s*\(.*?\)\s*/g, '').trim();
  }
  function pageQuestionText() {
    const parts = [];
    const sels = [
      '.divRowCenter', '.rowCenter',
      '#divPageContent', '.divPageContent',
      '#pnlTickBox', '#pnlTickbox',
      'form#frmMain', 'body'
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el) parts.push(el.innerText || el.textContent || '');
    }
    return normalize(parts.join('\n') || document.body.innerText || '');
  }
  function getAllInputs() {
    return Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
  }
  function getLabelTextForInput(input) {
    if (input.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (lbl) return lbl.textContent?.trim() || '';
    }
    if (input.nextElementSibling && input.nextElementSibling.tagName === 'LABEL') {
      return input.nextElementSibling.textContent?.trim() || '';
    }
    const p = input.parentElement;
    if (p) {
      const t = p.textContent?.trim();
      if (t && t.length <= 60) return t;
    }
    if (input.previousElementSibling && input.previousElementSibling.tagName === 'LABEL') {
      return input.previousElementSibling.textContent?.trim() || '';
    }
    return '';
  }
  function selectByLabel(targetLabel) {
    const targetClean = cleanLabel(targetLabel);
    for (const input of getAllInputs()) {
      if (input.disabled || input.hidden) continue;
      const labelClean = cleanLabel(getLabelTextForInput(input));
      if (!labelClean) continue;
      if (labelClean === targetClean) {
        if (input.type === 'radio' && input.name) {
          document.querySelectorAll(`input[type="radio"][name="${CSS.escape(input.name)}"]`)
            .forEach(r => r.checked = false);
        }
        if (!input.checked) {
          input.checked = true;
          try {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } catch {}
        }
        return true;
      }
    }
    return false;
  }
  function findTechTextControl() {
    // label[for] that contains "Technician Name"
    for (const lbl of document.querySelectorAll('label')) {
      const txt = normalize(lbl.textContent || '');
      if (txt.includes('technician name')) {
        const forId = lbl.getAttribute('for');
        if (forId) {
          const el = document.getElementById(forId);
          if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) && !el.disabled) {
            return el;
          }
        }
      }
    }
    // fallback
    return document.querySelector('textarea, input[type="text"]');
  }
  function fillText(el, value, onlyIfEmpty) {
    if (!el) return false;
    if (onlyIfEmpty && el.value && el.value.trim().length) return false;
    try { el.focus(); } catch {}
    el.value = value;
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      try { el.blur(); } catch {}
    } catch {}
    return true;
  }
  function runQuestionPage() {
    const text = pageQuestionText();
    let rule = null;
    for (const r of RULES) {
      if (r.mustInclude.every(substr => text.includes(normalize(substr)))) { rule = r; break; }
    }
    if (!rule) return;

    if (rule.answer) {
      const ok = selectByLabel(rule.answer)
        || (rule.answer.toLowerCase() === 'na' && selectByLabel('N/A'))
        || (rule.answer.toLowerCase() === 'n/a' && selectByLabel('NA'));
      if (!ok) return;
      return callValidated(NEXT_NAME);
    }

    if (rule.fillValue != null) {
      const el = findTechTextControl();
      if (!el) return;
      const filled = fillText(el, rule.fillValue, FILL_WHEN_EMPTY_ONLY);
      if (!filled) return;
      return callValidated(NEXT_NAME);
    }
  }

  /**************************************************************************
   * PART 2: Signature page (tick + robust auto-save)
   **************************************************************************/
  const CHECKBOX_ID     = 'chkCustomerNotAvailable';
  const NAME_INPUT_ID   = 'txtName';
  const AUTO_SAVE       = true;                 // toggle auto-save here
  const FILL_NAME       = false;                // set true to auto-fill name
  const DEFAULT_NAME    = 'Customer Unavailable';
  const MAX_WAIT_MS     = 10000;                // wait up to 10s for wiring
  const RETRY_INTERVAL  = 200;                  // retry every 200ms

  // Guards to avoid clashes / duplicate saves
  function alreadyHandled() {
    if (window.__rtioSignatureHandled) return true;
    window.__rtioSignatureHandled = true;
    return false;
  }
  function savingInFlight() {
    if (window.__rtioSigSaving) return true;
    window.__rtioSigSaving = true;
    return false;
  }

  function fire(el) {
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {}
  }

  function tickCheckbox() {
    const cb = document.getElementById(CHECKBOX_ID);
    if (!cb) { log('Sig: checkbox not found'); return false; }
    if (!cb.checked && !cb.disabled) {
      cb.checked = true;
      fire(cb);
      log('Sig: checkbox ticked');
    }
    return true;
  }

  function fillNameIfWanted() {
    if (!FILL_NAME) return;
    const tb = document.getElementById(NAME_INPUT_ID) || document.querySelector('input#txtName[type="text"]');
    if (!tb || tb.disabled) return;
    if (!tb.value || !tb.value.trim()) {
      tb.value = DEFAULT_NAME;
      fire(tb);
      log('Sig: filled customer name');
    }
  }

  function callValidatedSaveDirect() {
    try {
      if (typeof window.getCanvas === 'function') {
        window.getCanvas();
        log('Sig: getCanvas() called');
      } else {
        log('Sig: getCanvas not found, continuing');
      }

      if (typeof window.WebForm_PostBackOptions === 'function' &&
          typeof window.WebForm_DoPostBackWithOptions === 'function') {
        const opts = new window.WebForm_PostBackOptions('cmdSave', '', true, '', '', false, false);
        window.WebForm_DoPostBackWithOptions(opts);
        log('Sig: WebForm_DoPostBackWithOptions(cmdSave)');
        return true;
      }
      if (typeof window.__doPostBack === 'function') {
        window.__doPostBack('cmdSave', '');
        log('Sig: __doPostBack(cmdSave)');
        return true;
      }
    } catch (e) {
      log('Sig: direct save error', e);
    }
    return false;
  }

  function invokeButtonOnclick(saveBtn) {
    try {
      const handler = saveBtn.onclick;
      if (typeof handler === 'function') {
        handler.call(saveBtn, new MouseEvent('click', { bubbles: true, cancelable: true }));
        log('Sig: invoked saveBtn.onclick()');
        return true;
      }
    } catch (e) {
      log('Sig: onclick invoke error', e);
    }
    return false;
  }

  function dispatchImageClick(saveBtn) {
    try {
      const rect = saveBtn.getBoundingClientRect();
      const x = Math.max(1, Math.floor(rect.width / 2));
      const y = Math.max(1, Math.floor(rect.height / 2));
      const events = ['pointerdown', 'mousedown', 'mouseup', 'click'];
      for (const type of events) {
        const ev = new MouseEvent(type, {
          bubbles: true, cancelable: true, view: window,
          clientX: rect.left + x, clientY: rect.top + y, button: 0
        });
        saveBtn.dispatchEvent(ev);
      }
      log('Sig: dispatched image click with coords');
      return true;
    } catch (e) {
      log('Sig: image click error', e);
    }
    return false;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function ensureAndSave() {
    if (savingInFlight()) return; // prevent duplicate save attempts

    const start = Date.now();
    while (Date.now() - start < MAX_WAIT_MS) {
      const haveCb = tickCheckbox();
      fillNameIfWanted();

      const saveBtn = document.getElementById('cmdSave') || document.querySelector('input[name="cmdSave"]');
      const webformsReady =
        (typeof window.WebForm_PostBackOptions === 'function' &&
         typeof window.WebForm_DoPostBackWithOptions === 'function');

      if (haveCb && saveBtn) {
        if (webformsReady && callValidatedSaveDirect()) return;
        if (invokeButtonOnclick(saveBtn)) return;
        if (dispatchImageClick(saveBtn)) return;
      }

      await sleep(RETRY_INTERVAL);
    }

    // Final fallback
    tickCheckbox();
    fillNameIfWanted();
    callValidatedSaveDirect(); // best-effort
  }

  function runSignaturePage() {
    if (alreadyHandled()) return; // only one script section handles signature

    tickCheckbox();
    fillNameIfWanted();

    // Keep checkbox ticked if DOM re-renders (canvas init / postbacks)
    try {
      const obs = new MutationObserver(() => tickCheckbox());
      obs.observe(document.body, { childList: true, subtree: true });
    } catch {}

    if (AUTO_SAVE) ensureAndSave();
  }

  /**************************************************************************
   * PART 3: Mobile "Take Photo" Button (modal capture => file input => Upload)
   **************************************************************************/
  function _GM_addStyle(css) {
    try { if (typeof GM_addStyle === 'function') return GM_addStyle(css); } catch {}
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }

  function waitFor(sel, root = document, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const el = root.querySelector(sel);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const found = root.querySelector(sel);
        if (found) { obs.disconnect(); resolve(found); }
      });
      obs.observe(root, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error(`Timeout: ${sel}`)); }, timeoutMs);
    });
  }

  function getFileInput() {
    const cands = ['#fileupload', '#fileUpload', 'input[type="file"]'];
    for (const sel of cands) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findVisibleButtonByText(textRe) {
    const nodes = Array.from(document.querySelectorAll('input[type="submit"], input[type="button"], button'));
    return nodes.find(b => {
      const txt = (b.value || b.textContent || '').trim();
      const vis = b.offsetParent !== null;
      return vis && textRe.test(txt);
    }) || null;
  }

  function ensureModal() {
    if (document.getElementById('tm-cam-modal')) return;

    _GM_addStyle(`
      #tm-cam-modal { position: fixed; inset: 0; z-index: 999999; background: rgba(0,0,0,0.65);
        display: none; align-items: center; justify-content: center; }
      #tm-cam-dialog { width: min(92vw, 720px); background: #0f172a; color: #fff;
        border-radius: 12px; box-shadow: 0 18px 60px rgba(0,0,0,0.45);
        display: flex; flex-direction: column; overflow: hidden; }
      #tm-cam-header { padding: 10px 14px; font-weight: 900; border-bottom: 1px solid rgba(255,255,255,0.15); }
      #tm-cam-body { padding: 10px; display: grid; gap: 10px; }
      #tm-cam-video { width: 100%; max-height: 60vh; background: #000; border-radius: 8px; }
      #tm-cam-footer { display: flex; gap: 10px; justify-content: flex-end; padding: 10px;
        border-top: 1px solid rgba(255,255,255,0.15); }
      .tm-btn { cursor: pointer; font-weight: 800; font-size: 14px; padding: 10px 16px;
        border-radius: 10px; border: 1px solid rgba(255,255,255,0.25); }
      .tm-primary { background: #1f6feb; color: #fff; }
      .tm-secondary { background: rgba(255,255,255,0.08); color:#fff; }
      #tm-takepic-wrap { display:flex; justify-content:center; margin:12px 0; }
      #tm-takepic-btn { cursor:pointer; font-weight:800; font-size:14px; padding:8px 14px; border-radius:8px;
        border:1px solid rgba(255,255,255,0.25); color:#fff; background:#1f6feb; box-shadow:0 4px 12px rgba(0,0,0,0.25); }
    `);

    const modal = document.createElement('div'); modal.id = 'tm-cam-modal';
    const dlg   = document.createElement('div'); dlg.id   = 'tm-cam-dialog';
    const hdr   = document.createElement('div'); hdr.id   = 'tm-cam-header'; hdr.textContent = 'Take Photo';
    const body  = document.createElement('div'); body.id  = 'tm-cam-body';
    const video = document.createElement('video');
    video.id = 'tm-cam-video'; video.autoplay = true; video.playsInline = true; video.muted = true;
    const ftr   = document.createElement('div'); ftr.id   = 'tm-cam-footer';

    const btnCancel = document.createElement('button'); btnCancel.className = 'tm-btn tm-secondary'; btnCancel.textContent = 'Cancel';
    const btnFlip   = document.createElement('button'); btnFlip.className   = 'tm-btn tm-secondary'; btnFlip.textContent   = 'Flip';
    const btnSnap   = document.createElement('button'); btnSnap.className   = 'tm-btn tm-primary';   btnSnap.textContent   = 'Capture';

    body.appendChild(video);
    ftr.appendChild(btnCancel); ftr.appendChild(btnFlip); ftr.appendChild(btnSnap);
    dlg.appendChild(hdr); dlg.appendChild(body); dlg.appendChild(ftr);
    modal.appendChild(dlg);
    document.body.appendChild(modal);

    let stream = null;
    let useEnv = true;

    async function startCamera() {
      stopCamera();
      const constraints = {
        video: {
          facingMode: useEnv ? { ideal: 'environment' } : { ideal: 'user' },
          width:  { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        await video.play();
      } catch (e) {
        console.error('[TakePhoto] getUserMedia failed:', e);
        alert('Camera access failed. Check permissions or try a different browser/device.');
        hide();
      }
    }

    function stopCamera() {
      if (stream) {
        stream.getTracks().forEach(t => { try { t.stop(); } catch(_){} });
        stream = null;
      }
      video.srcObject = null;
    }

    function show() { modal.style.display = 'flex'; startCamera(); }
    function hide() { modal.style.display = 'none'; stopCamera(); }

    modal.captureToFile = async () => {
      const ensureReady = async () => {
        if ((video.videoWidth || 0) > 0 && (video.videoHeight || 0) > 0) return;
        await new Promise((res) => {
          const onReady = () => {
            if ((video.videoWidth || 0) > 0 && (video.videoHeight || 0) > 0) {
              video.removeEventListener('loadedmetadata', onReady);
              res();
            }
          };
          video.addEventListener('loadedmetadata', onReady, { once: true });
          setTimeout(res, 300);
        });
      };
      await ensureReady();

      const srcW = video.videoWidth || 1280;
      const srcH = video.videoHeight || 720;

      const MAX_DIM = 1600; // adjust for image size
      const scale   = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
      const w       = Math.round(srcW * scale);
      const h       = Math.round(srcH * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.drawImage(video, 0, 0, w, h);

      let blob = await new Promise((resolve) => {
        try { canvas.toBlob(b => resolve(b || null), 'image/jpeg', 0.85); }
        catch (_) { resolve(null); }
      });
      if (!blob) {
        const dataURL = canvas.toDataURL('image/jpeg', 0.85);
        const base64  = dataURL.split(',')[1];
        const bin     = atob(base64);
        const arr     = new Uint8Array(bin.length);
        for (let i=0; i<bin.length; i++) arr[i] = bin.charCodeAt(i);
        blob = new Blob([arr], { type: 'image/jpeg' });
      }

      const jobId   = new URL(location.href).searchParams.get('AnswersReportID') || 'unknown';
      const ts      = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `job-${jobId}_${ts}.jpg`;

      let file;
      try {
        file = new File([blob], fileName, { type: 'image/jpeg', lastModified: Date.now() });
      } catch (_) {
        blob.name = fileName; // fallback for old browsers
        file = blob;
      }
      return file;
    };

    // Wire buttons
    btnCancel.addEventListener('click', hide);
    btnFlip.addEventListener('click', () => { useEnv = !useEnv; startCamera(); });
    btnSnap.addEventListener('click', async () => {
      try {
        const file = await modal.captureToFile();
        hide();

        const input = getFileInput();
        if (!input) { alert('Upload input not found'); return; }

        // Inject via DataTransfer
        let dt;
        try { dt = new DataTransfer(); }
        catch (_) { dt = null; }
        if (!dt) throw new Error('DataTransfer not available');

        if (input.multiple && input.files && input.files.length) {
          for (let i=0; i<input.files.length; i++) dt.items.add(input.files[i]);
        }
        dt.items.add(file);
        input.files = dt.files;

        // Trigger site's onchange (ASP.NET may wire fileSelected() here)
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // Wait for native "Upload" and click it
        const uploadTextRE = /upload/i;
        let tries = 0;
        const maxTries = 20; // ~2s
        const timer = setInterval(() => {
          tries++;
          const btn = findVisibleButtonByText(uploadTextRE);
          if (btn) {
            clearInterval(timer);
            btn.click();
          } else if (tries >= maxTries) {
            clearInterval(timer);
            // leave file selected for manual upload
          }
        }, 100);

      } catch (e) {
        console.error('[TakePhoto] Capture pipeline failed', e);
        alert('Capture failed. Please try again.');
      }
    });

    modal.showCam = show;
    modal.hideCam = hide;
    window.__tmCamModal = modal;
  }

  function ensureTakePhotoButton() {
    if (document.getElementById('tm-takepic-btn')) return;

    const input = getFileInput();
    if (!input) { log('TakePhoto: file input not found (yet)'); return; }

    // Keep native accept/capture as fallback
    try { input.setAttribute('accept', 'image/*'); input.setAttribute('capture', 'environment'); } catch {}

    const anchor = input.closest('#divPnlPhoto')
                || input.closest('.rowCenter')
                || input.parentElement
                || document.body;

    const wrap = document.createElement('div');
    wrap.id = 'tm-takepic-wrap';

    const btn = document.createElement('button');
    btn.id = 'tm-takepic-btn';
    btn.type = 'button';
    btn.textContent = '📷 Take Photo';

    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!window.__tmCamModal) ensureModal();
      window.__tmCamModal.showCam();
    });

    anchor.parentElement.insertBefore(wrap, anchor);
    wrap.appendChild(btn);
  }

  async function bootTakePhoto() {
    ensureModal();
    try { await waitFor('input[type="file"]'); } catch {}
    ensureTakePhotoButton();

    // Re-inject if DOM rebuilds (ASP.NET postbacks)
    try {
      const mo = new MutationObserver(() => { ensureTakePhotoButton(); });
      mo.observe(document.body, { childList:true, subtree:true });
    } catch {}
  }

  /**************************************************************************
   * BOOTSTRAP
   **************************************************************************/
  if (IS_SIGNATURE) {
    runSignaturePage();
  } else if (IS_QUESTION) {
    runQuestionPage();
    if (IS_MOBILE_Q) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootTakePhoto, { once: true });
      } else {
        bootTakePhoto();
      }
    }
  }
})();
