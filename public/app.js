'use strict';
/* Subtitler – front-end. Nessuna dipendenza esterna. */
const $ = s => document.querySelector(s);
const API = 'api.php';
const api = async (a, params = {}, opts = {}) => {
  const q = new URLSearchParams({ a, ...params });
  const r = await fetch(`${API}?${q}`, opts);
  const j = await r.json().catch(() => ({ error: 'Risposta non valida dal server' }));
  if (!r.ok && r.status !== 202) throw new Error(j.error || `Errore ${r.status}`);
  return j;
};
const post = (a, id, data) => api(a, { id }, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

/* ---------- utilità tempo ---------- */
const fmt = t => {
  t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
function parseTime(str) {
  str = String(str).trim().replace(',', '.');
  if (!str) return NaN;
  const p = str.split(':').map(Number);
  if (p.some(isNaN)) return NaN;
  return p.reduce((a, v) => a * 60 + v, 0);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- SCHERMATA "NUOVO PROGETTO" ---------- */
function showNew() {
  S.id = null; S.meta = null; stopTimers();
  $('#home').hidden = false; $('#editor').hidden = true;
  $('#projName').hidden = $('#saveState').hidden = $('#resInfo').hidden = true; $('#resBar').hidden = true;
  document.title = 'Easy Video Subtitler'; updateMenuState();
}

/* ---------- MENU FILE ---------- */
const fileMenu = $('#fileMenu'), mFile = $('#mFile');
const when = ts => new Date(ts * 1000).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
function updateMenuState() { ['save', 'saveas', 'replace'].forEach(k => fileMenu.querySelector(`[data-m="${k}"]`).disabled = !S.id); }
function closeMenu() { fileMenu.hidden = true; mFile.setAttribute('aria-expanded', 'false'); $('#recentWrap').classList.remove('open'); }
async function openMenu() {
  updateMenuState(); fileMenu.hidden = false; mFile.setAttribute('aria-expanded', 'true');
  const box = $('#recentMenu'); box.innerHTML = '';
  let list = []; try { list = await api('list', { limit: 10 }); } catch { /* */ }
  if (!list.length) box.innerHTML = '<button disabled>(nessun progetto)</button>';
  for (const p of list) {
    const b = document.createElement('button'); b.className = 'rec' + (p.id === S.id ? ' cur' : '');
    b.innerHTML = `<span class="nm">${esc(p.name)}</span><span class="dt">${when(p.touched)}</span>`;
    b.onclick = () => { closeMenu(); location.hash = p.id; };
    box.appendChild(b);
  }
}
mFile.onclick = e => { e.stopPropagation(); fileMenu.hidden ? openMenu() : closeMenu(); };
document.addEventListener('click', e => { if (!fileMenu.hidden && !e.target.closest('.menu')) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
fileMenu.addEventListener('click', e => e.stopPropagation());
$('#recentWrap > button').onclick = e => { e.stopPropagation(); $('#recentWrap').classList.toggle('open'); };
fileMenu.querySelectorAll('button[data-m]').forEach(b => { if (b.dataset.m !== 'recent') b.onclick = () => { closeMenu(); menuAction(b.dataset.m); }; });

async function menuAction(m) {
  try {
    if (m === 'new') { if (location.hash !== '#new') location.hash = 'new'; else await route(); }
    else if (m === 'save') await menuSave();
    else if (m === 'saveas') await menuSaveAs();
    else if (m === 'load') await menuLoad();
    else if (m === 'replace') $('#replaceFile').click();
  } catch (e) { alert(e.message); }
}
/* ---------- Sostituisci video ---------- */
const fmtDur = d => `${d.toFixed(2)} s`;
function describeDiffs(r) {
  const o = r.old, n = r.new, out = [];
  if (r.diffs.includes('duration')) out.push(`• Durata: ${fmtDur(o.duration)} → ${fmtDur(n.duration)} (i sottotitoli non vengono spostati)`);
  if (r.diffs.includes('size')) out.push(`• Risoluzione: ${o.width}×${o.height} → ${n.width}×${n.height} (il ritaglio verrà azzerato)`);
  if (r.diffs.includes('audio')) out.push(`• Audio: ${o.audio ? 'presente' : 'assente'} → ${n.audio ? 'presente' : 'assente'}`);
  return out.join('\n');
}
$('#replaceFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file || !S.id) return;
  const id = S.id, t0 = video.currentTime, ss = $('#saveState');
  try {
    video.pause(); await flushSave();
    const r = await new Promise((res, rej) => {
      const fd = new FormData(); fd.append('video', file); const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API}?a=replace_stage&id=${id}`);
      xhr.upload.onprogress = ev => { if (ev.lengthComputable) ss.textContent = `Caricamento nuovo video… ${Math.round(ev.loaded / ev.total * 100)}%`; };
      xhr.onload = () => { let j = {}; try { j = JSON.parse(xhr.responseText); } catch { /* */ } xhr.status === 200 && j.staged ? res(j) : rej(new Error(j.error || 'Upload fallito (controlla i limiti di upload di PHP)')); };
      xhr.onerror = () => rej(new Error('Errore di rete')); xhr.send(fd);
    });
    ss.textContent = 'Verifica del nuovo video…';
    if (r.diffs.length && !confirm(`Il nuovo video è diverso dall'originale:\n\n${describeDiffs(r)}\n\nSostituire comunque? Il video attuale verrà eliminato.`)) {
      await api('replace_cancel', { id }); ss.textContent = 'Sostituzione annullata'; return;
    }
    await api('replace_commit', { id });
    if (S.id !== id) return;
    await openProject(id); resizeCanvas(); fitZoom(); updateMenuState();
    const resume = () => { video.currentTime = Math.min(t0, Math.max(0, (S.dur || 0) - .05)); video.removeEventListener('loadedmetadata', resume); };
    video.addEventListener('loadedmetadata', resume);
    $('#saveState').textContent = 'Video sostituito ' + new Date().toLocaleTimeString();
  } catch (err) { try { await api('replace_cancel', { id }); } catch { /* */ } ss.textContent = ''; alert(err.message); }
};

async function menuSave() {
  if (!S.id) return;
  clearTimeout(saveTimer); await saveNow();
}
async function menuSaveAs() {
  if (!S.id) return;
  await flushSave();
  const dlg = $('#nameDlg'), inp = $('#nameInput'); inp.value = S.meta.name + ' (copia)';
  dlg.showModal(); inp.select();
  const name = await new Promise(res => {
    const done = v => { dlg.close(); $('#nameForm').onsubmit = null; $('#nameCancel').onclick = null; res(v); };
    $('#nameForm').onsubmit = e => { e.preventDefault(); done(inp.value.trim()); };
    $('#nameCancel').onclick = () => done(null); dlg.oncancel = () => res(null);
  });
  if (!name) return;
  const r = await post('saveas', S.id, { name }); location.hash = r.id;
}
async function menuLoad() {
  await flushSave();
  const list = await api('list'), box = $('#loadList'); box.innerHTML = list.length ? '' : '<p class="dim">Nessun progetto nella cartella di lavoro.</p>';
  for (const p of list) {
    const r = document.createElement('div'); r.className = 'lrow' + (p.id === S.id ? ' cur' : '');
    r.innerHTML = `<span class="nm">${esc(p.name)}</span><span class="meta">${fmt(p.duration)} · ${p.subs} sott.${p.exported ? ' · esportato' : ''} · ${when(p.touched)}</span><button data-del title="Elimina progetto">Elimina</button>`;
    r.onclick = () => { $('#loadDlg').close(); location.hash = p.id; };
    r.querySelector('[data-del]').onclick = async ev => {
      ev.stopPropagation();
      if (!confirm(`Eliminare "${p.name}" e tutti i suoi file?`)) return;
      await api('delete', { id: p.id });
      if (p.id === S.id) { $('#loadDlg').close(); location.hash = 'new'; } else menuLoad();
    };
    box.appendChild(r);
  }
  if (!$('#loadDlg').open) $('#loadDlg').showModal();
}
$('#loadClose').onclick = () => $('#loadDlg').close();
$('#optOpenLast').onchange = e => api('settings', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openLast: e.target.checked }) }).catch(() => {});
document.addEventListener('keydown', e => {            // Ctrl/Cmd+S ovunque (anche dentro i campi di testo)
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (S.id) menuSave(); }
});

$('#uploadForm').onsubmit = e => {
  e.preventDefault();
  const fd = new FormData(e.target), xhr = new XMLHttpRequest();
  $('#upErr').textContent = ''; $('#upProg').hidden = false; $('#upProg').value = 0;
  xhr.open('POST', `${API}?a=create`);
  xhr.upload.onprogress = ev => { if (ev.lengthComputable) $('#upProg').value = ev.loaded / ev.total * 100; };
  xhr.onload = () => {
    $('#upProg').hidden = true;
    let j = {}; try { j = JSON.parse(xhr.responseText); } catch { /* */ }
    if (xhr.status === 200 && j.id) { e.target.reset(); location.hash = j.id; }
    else $('#upErr').textContent = j.error || 'Upload fallito (controlla i limiti di upload di PHP)';
  };
  xhr.onerror = () => { $('#upProg').hidden = true; $('#upErr').textContent = 'Errore di rete'; };
  xhr.send(fd);
};

/* ---------- STATO EDITOR ---------- */
const S = {
  id: null, meta: null, subs: [], sel: null, dur: 0,
  zoom: 80, scroll: 0,                     // px/s, secondo all'estremo sinistro
  peaks: null, tap: null, uid: 1,
  undo: [], redo: [], dirty: true,
};
const video = $('#video'), overlay = $('#overlay');
let saveTimer = null, peakTimer = null, exportTimer = null, raf = 0, fontFace = null;
function stopTimers() { clearTimeout(saveTimer); saveTimer = null; clearTimeout(peakTimer); clearTimeout(exportTimer); cancelAnimationFrame(raf); video.pause(); }

const SUB_DEFAULTS = { pos: '', inA: 'none', inMs: 300, outA: 'none', outMs: 300, opa: '', shadow: '', glow: '', box: '' };
const newSub = (start, end, text = '', p = false, extra = {}) => ({ id: S.uid++, start, end, text, p, ...SUB_DEFAULTS, ...extra });
const ANIMS = [['none', 'Nessuna'], ['fade', 'Dissolvenza'], ['typewriter', 'Macchina da scrivere'], ['pop', 'Pop'], ['bounce', 'Rimbalzo'], ['zoom', 'Zoom'], ['zoom-out', 'Zoom da grande'],
  ['slide-up', 'Scorri ↑'], ['slide-down', 'Scorri ↓'], ['slide-left', 'Scorri ←'], ['slide-right', 'Scorri →'], ['wipe', 'Rivela →'], ['flip', 'Ribalta'], ['spread', 'Spaziatura'], ['swirl', 'Vortice'], ['blur', 'Sfocatura']];
const TRI = [['', 'Globale'], ['on', 'Sì'], ['off', 'No']];
const POSS = [['', 'Globale'], ['top', 'In alto'], ['middle', 'Al centro'], ['bottom', 'In basso']];
const SUB_FIELDS = ['pos', 'inA', 'inMs', 'outA', 'outMs', 'opa', 'shadow', 'glow', 'box'];
const pick = (o, ks) => Object.fromEntries(ks.map(k => [k, o[k]]));
const DEFAULT_STYLE = { size: 6, color: '#ffffff', outlineColor: '#000000', outline: .45, bold: true, pos: 'bottom', margin: 5, crf: 20,
  opacity: 100, spacing: 0, shadow: false, shadowColor: '#000000', shadowDist: .5, shadowOpacity: 70,
  glow: false, glowColor: '#ffe066', glowSize: 1.2, glowOpacity: 85, box: false, boxColor: '#000000', boxPad: .8, boxOpacity: 65, out: null };
/** Durate effettive entrata/uscita in secondi (stessa logica di animTimes() in lib.php). */
function animTimes(s) {
  const dur = Math.max(0, s.end - s.start);
  let i = s.inA !== 'none' ? Math.max(0, s.inMs / 1000) : 0, o = s.outA !== 'none' ? Math.max(0, s.outMs / 1000) : 0;
  if (i + o > dur && i + o > 0) { const f = dur / (i + o); i *= f; o *= f; }
  return [i < .02 ? 0 : i, o < .02 ? 0 : o];
}
const bySel = () => S.subs.find(s => s.id === S.sel);
const sortSubs = () => S.subs.sort((a, b) => a.start - b.start);

async function openProject(id) {
  stopTimers();
  const { meta, subs } = await api('project', { id });
  Object.assign(S, { id, meta, dur: meta.duration, subs: subs.map(s => newSub(s.start, s.end, s.text, false, s)), sel: null, tap: null, peaks: null, undo: [], redo: [], scroll: 0 });
  S.meta.style = Object.assign({}, DEFAULT_STYLE, meta.style);
  $('#home').hidden = true; $('#editor').hidden = false;
  $('#projName').hidden = $('#saveState').hidden = false; $('#projName').textContent = meta.name;
  S.cropKey = S.meta.style.out ? 'free' : 'orig'; document.title = meta.name + ' – Easy Video Subtitler';
  video.src = `${API}?a=video&id=${id}&v=${meta.rev || 0}`;
  video.onerror = () => makeProxy();
  $('#tdur').textContent = fmt(S.dur);
  $('#dlSrt').href = `${API}?a=download&what=srt&id=${id}`; $('#dlAss').href = `${API}?a=download&what=ass&id=${id}`; $('#dlVideo').href = `${API}?a=download&what=video&id=${id}`;
  $('#dlVideo').hidden = !meta.hasOutput;
  loadFont(); styleToForm(); fitZoom(); renderList(); layoutStage(); applyLimits(); syncCropForm(); loadPeaks();
  exportPoll(); loop();
}

async function makeProxy() {
  $('#exMsg').textContent = 'Il browser non riproduce questo formato: creo un\'anteprima leggera…';
  try { await api('proxy', { id: S.id }); } catch { return; }
  const t = setInterval(async () => {
    const st = await api('status', { id: S.id, mode: 'proxy' }).catch(() => ({}));
    if (st.hasPreview) { clearInterval(t); video.src = `${API}?a=video&proxy=1&id=${S.id}&v=${S.meta.rev || 0}&p=${Date.now()}`; video.onerror = null; $('#exMsg').textContent = ''; }
    if (st.status === 'error') { clearInterval(t); $('#exMsg').textContent = 'Anteprima non disponibile: ' + st.error; }
  }, 1500);
}

async function loadPeaks(tries = 0) {
  const id = S.id;
  const r = await api('peaks', { id }).catch(() => null);
  if (S.id !== id) return;
  if (r && r.data !== undefined) {
    const bin = atob(r.data); const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    const sorted = Array.from(a).sort((x, y) => x - y);
    S.peaks = { rate: r.rate, a, norm: Math.max(8, sorted[Math.floor(sorted.length * .98)] || 255) };
    $('#peakState').textContent = a.length ? '' : 'nessuna traccia audio'; S.dirty = true;
  } else if (tries < 120) { $('#peakState').textContent = 'analisi audio…'; peakTimer = setTimeout(() => loadPeaks(tries + 1), 2000); }
}

/* ---------- stage / overlay ---------- */
/* ritaglio (dimensioni di uscita) */
const cropRect = () => { const o = S.meta.style.out; return o ? { ...o } : { x: 0, y: 0, w: S.meta.width, h: S.meta.height }; };
const isCropped = () => !!S.meta.style.out;
function layoutStage() {
  if (!S.meta) return;
  const stg = $('#stage'), W = S.meta.width, H = S.meta.height;
  const bw = stg.clientWidth, bh = stg.clientHeight, k = Math.min(bw / W, bh / H, 1);     // mai oltre la risoluzione originale, proporzioni sempre intatte
  const w = Math.floor(W * k), h = Math.floor(H * k);
  const vw = $('#vwrap'); vw.style.width = w + 'px'; vw.style.height = h + 'px';
  const r = cropRect(), kv = w / W;                                                     // i sottotitoli vivono nel frame di uscita (ritagliato)
  for (const el of [overlay, $('#cropbox')]) Object.assign(el.style, { left: r.x * kv + 'px', top: r.y * kv + 'px', width: r.w * kv + 'px', height: r.h * kv + 'px' });
  $('#cropbox').hidden = !isCropped();
  updateVpInfo();
  renderOverlay();
}

const MOTION = { 'slide-up': [0, -1], 'slide-down': [0, 1], 'slide-left': [-1, 0], 'slide-right': [1, 0] };
const KF = { pop: [[0, 0], [.6, 1.15], [1, 1]], bounce: [[0, 0], [.45, 1.25], [.7, .9], [.85, 1.05], [1, 1]] };   // speculari a KEYFRAMES in lib.php
function kfValue(kf, p) {
  for (let i = 0; i < kf.length - 1; i++) { const [t0, v0] = kf[i], [t1, v1] = kf[i + 1]; if (p <= t1) return v0 + (v1 - v0) * ((p - t0) / ((t1 - t0) || 1)); }
  return kf[kf.length - 1][1];
}
const typeSteps = (len, d) => Math.max(1, Math.min(len, Math.floor(d / .04)));                                  // come typeSteps() in lib.php
function typeVisible(len, ty) {
  const n = typeSteps(len, ty.d);
  const j = ty.isIn ? Math.min(n - 1, Math.floor(ty.p * n)) : Math.max(0, Math.min(n - 1, Math.ceil(ty.p * n) - 1));
  return Math.ceil(len * (j + 1) / n);
}
/** Stato animato al tempo t (W,H = frame di uscita). Speculare a animTags() in lib.php: p = 0 nascosto, 1 normale. */
function animState(s, t, W, H, sizePx) {
  const [ti, to] = animTimes(s);
  const st = { x: 0, y: 0, scale: 1, scaleY: 1, rot: 0, alpha: 1, blur: 0, spacing: 0, wipe: null, type: null, origin: 'anchor' };
  const phase = (kind, p, isIn, d) => {
    const q = 1 - p, sg = isIn ? -1 : 1;
    if (kind === 'fade') st.alpha = p;
    else if (MOTION[kind]) { st.x = sg * MOTION[kind][0] * .12 * W * q; st.y = sg * MOTION[kind][1] * .10 * H * q; st.alpha = p; }
    else if (kind === 'zoom') st.scale = Math.max(.01, p);
    else if (kind === 'zoom-out') { st.scale = 1 + 1.5 * q; st.alpha = p; }
    else if (kind === 'swirl') { st.rot = isIn ? -360 * q : 360 * q; st.alpha = p; st.origin = 'center'; }
    else if (kind === 'blur') { st.blur = .012 * H * q; st.alpha = p; }
    else if (kind === 'pop' || kind === 'bounce') st.scale = Math.max(.01, kfValue(KF[kind], p));
    else if (kind === 'flip') st.scaleY = Math.max(.01, p);
    else if (kind === 'spread') { st.spacing = .6 * sizePx * q; st.alpha = p; }
    else if (kind === 'wipe') st.wipe = { isIn, p };
    else if (kind === 'typewriter') st.type = { p, isIn, d };
  };
  if (ti > 0 && t < s.start + ti) phase(s.inA, clamp((t - s.start) / ti, 0, 1), true, ti);
  else if (to > 0 && t >= s.end - to) phase(s.outA, clamp((s.end - t) / to, 0, 1), false, to);
  return st;
}
/** Effetti effettivi: valori globali con gli override del sottotitolo. Speculare a subEffects() in lib.php. */
function subFx(s, st) {
  const tri = (k, g) => s[k] === 'on' ? true : s[k] === 'off' ? false : !!g;
  const opa = (s.opa === '' || s.opa == null || isNaN(+s.opa)) ? st.opacity : +s.opa;
  return { opacity: clamp(opa, 0, 100), shadow: tri('shadow', st.shadow), glow: tri('glow', st.glow), box: tri('box', st.box) };
}
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${clamp(a, 0, 1)})`; };

function renderOverlay() {
  if (!S.meta) return;
  const st = S.meta.style, ow = overlay.clientWidth, oh = overlay.clientHeight, t = video.currentTime;
  if (!oh) return;
  const act = S.subs.filter(s => t >= s.start && t < s.end);
  const els = overlay._els || (overlay._els = new Map());
  for (const [id, el] of els) if (!act.some(s => s.id === id)) { el.remove(); els.delete(id); }
  const K = S.meta.font ? (S.meta.fontK || .85) : .85;                 // libass: Fontsize = altezza cella, non em
  const sizePx = oh * st.size / 100, fs = sizePx * K, bold = S.meta.font ? S.meta.fontBold : st.bold;
  const sp0 = sizePx * st.spacing / 100;
  for (const s of act) {
    let el = els.get(s.id); if (!el) { el = document.createElement('div'); el.className = 'ov'; overlay.appendChild(el); els.set(s.id, el); }
    const pos = s.pos || st.pos, a = animState(s, t, ow, oh, sizePx), fx = subFx(s, st);
    const chars = [...s.text]; const v = a.type ? typeVisible(chars.length, a.type) : chars.length;
    const key = s.text + '\u0001' + v;
    if (el._key !== key) { el.innerHTML = `<span class="bx">${esc(chars.slice(0, v).join(''))}</span><span class="hid">${esc(chars.slice(v).join(''))}</span>`; el._key = key; }
    const bx = el.firstChild;                                          // sfondo (solo sul testo già scritto)
    bx.style.background = fx.box ? rgba(st.boxColor, st.boxOpacity / 100) : 'transparent';
    bx.style.padding = fx.box ? `${oh * st.boxPad / 100}px` : '0';
    const sh = [];
    if (fx.glow) { const R = oh * st.glowSize / 100, c = rgba(st.glowColor, st.glowOpacity / 100); sh.push(`0 0 ${R * .35}px ${c}`, `0 0 ${R * .8}px ${c}`, `0 0 ${R * 1.4}px ${c}`); }
    if (fx.shadow) { const d = oh * st.shadowDist / 100; sh.push(`${d}px ${d}px 0 ${rgba(st.shadowColor, st.shadowOpacity / 100)}`); }
    const origin = a.origin === 'center' ? '50% 50%' : pos === 'top' ? '50% 0%' : pos === 'bottom' ? '50% 100%' : '50% 50%';
    const clip = a.wipe ? (a.wipe.isIn ? `inset(0 ${(1 - a.wipe.p) * 100}% 0 0)` : `inset(0 0 0 ${(1 - a.wipe.p) * 100}%)`) : 'none';
    Object.assign(el.style, {
      fontFamily: S.meta.fontFamily ? `"SubFont", sans-serif` : '"DejaVu Sans", Verdana, sans-serif', fontSize: fs + 'px', lineHeight: String(1 / K), color: st.color,
      fontWeight: bold ? '700' : '400', fontStyle: S.meta.font && S.meta.fontItalic ? 'italic' : 'normal',
      letterSpacing: (sp0 + a.spacing) + 'px', textShadow: sh.join(',') || 'none', clipPath: clip,
      webkitTextStroke: `${oh * st.outline / 100 * 2}px ${st.outlineColor}`, paintOrder: 'stroke fill',
      top: pos === 'top' ? oh * st.margin / 100 + 'px' : pos === 'middle' ? '50%' : 'auto',
      bottom: pos === 'bottom' ? oh * st.margin / 100 + 'px' : 'auto',
      transformOrigin: origin, opacity: a.alpha * fx.opacity / 100, filter: a.blur > .05 ? `blur(${a.blur}px)` : 'none',
      transform: `${pos === 'middle' ? 'translateY(-50%) ' : ''}translate(${a.x}px,${a.y}px) scale(${a.scale},${a.scale * a.scaleY}) rotate(${a.rot}deg)`,
    });
  }
}
async function loadFont() {
  if (fontFace) { document.fonts.delete(fontFace); fontFace = null; }
  $('#fontName').textContent = S.meta.fontFamily ? S.meta.fontFamily + (S.meta.fontBold ? ' Bold' : '') + (S.meta.fontItalic ? ' Italic' : '') : 'predefinito';
  $('#sBold').disabled = !!S.meta.font; $('#sBold').parentElement.title = S.meta.font ? 'Con un font caricato lo stile è quello del file' : '';
  if (!S.meta.font) { renderOverlay(); return; }
  try {
    fontFace = new FontFace('SubFont', `url(${API}?a=get_font&id=${S.id}&v=${Date.now()})`, { weight: S.meta.fontBold ? '700' : '400', style: S.meta.fontItalic ? 'italic' : 'normal' });
    await fontFace.load(); document.fonts.add(fontFace);
  } catch (e) { console.warn('font', e); }
  renderOverlay();
}
$('#fontFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const fd = new FormData(); fd.append('font', f);
  try {
    const r = await fetch(`${API}?a=font&id=${S.id}`, { method: 'POST', body: fd }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    Object.assign(S.meta, { font: r.font, fontFamily: r.fontFamily, fontBold: r.fontBold, fontItalic: r.fontItalic, fontK: r.fontK }); await loadFont();
  } catch (err) { alert(err.message); }
  e.target.value = '';
};
$('#fontDel').onclick = async () => { await api('font_remove', { id: S.id }); S.meta.font = S.meta.fontFamily = null; S.meta.fontK = null; loadFont(); };

/* ---------- stile ---------- */
const styleFields = { size: '#sSize', color: '#sColor', outlineColor: '#sOutlineColor', outline: '#sOutline', pos: '#sPos', margin: '#sMargin', bold: '#sBold', crf: '#sCrf',
  opacity: '#sOpacity', spacing: '#sSpacing', shadow: '#sShadow', shadowColor: '#sShadowColor', shadowDist: '#sShadowDist', shadowOpacity: '#sShadowOpacity',
  glow: '#sGlow', glowColor: '#sGlowColor', glowSize: '#sGlowSize', glowOpacity: '#sGlowOpacity', box: '#sBox', boxColor: '#sBoxColor', boxPad: '#sBoxPad', boxOpacity: '#sBoxOpacity' };
function styleToForm() { for (const [k, sel] of Object.entries(styleFields)) { const el = $(sel); if (el.type === 'checkbox') el.checked = !!S.meta.style[k]; else el.value = S.meta.style[k]; } }
for (const [k, sel] of Object.entries(styleFields)) {
  $(sel).oninput = e => {
    const el = e.target; S.meta.style[k] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? parseFloat(el.value) || 0 : el.value);
    renderOverlay(); scheduleSave(); document.querySelectorAll('.o-opa').forEach(i => i.placeholder = String(S.meta.style.opacity));
  };
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.hidden = t.id !== b.dataset.tab);
});

/* ---------- salvataggio / undo ---------- */
const snapshot = () => JSON.stringify(S.subs.map(s => ({ id: s.id, start: s.start, end: s.end, text: s.text, p: s.p, ...pick(s, SUB_FIELDS) })));
function commit() {            // da chiamare DOPO una modifica conclusa
  const snap = S._before; S._before = null;
  if (snap && snap !== snapshot()) { S.undo.push(snap); if (S.undo.length > 100) S.undo.shift(); S.redo = []; }
  S.dirty = true; scheduleSave();
}
const begin = () => { if (!S._before) S._before = snapshot(); };
function restore(json) { S.subs = JSON.parse(json); S.uid = Math.max(S.uid, ...S.subs.map(s => s.id + 1)); renderList(); S.dirty = true; scheduleSave(); }
function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); }
function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); }

function scheduleSave() {
  $('#saveState').textContent = 'modifiche non salvate…'; $('#saveState').classList.remove('err');
  clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700);
}
async function saveNow() {
  saveTimer = null;
  const payload = { subs: S.subs.map(s => ({ start: s.start, end: s.end, text: s.text, ...pick(s, SUB_FIELDS) })), style: S.meta.style };
  try { await post('save', S.id, payload); $('#saveState').textContent = 'salvato ' + new Date().toLocaleTimeString(); }
  catch (e) { $('#saveState').textContent = 'ERRORE salvataggio: ' + e.message; $('#saveState').classList.add('err'); }
}
async function flushSave() { if (S.id && saveTimer) { clearTimeout(saveTimer); await saveNow(); } }
window.addEventListener('beforeunload', e => { if (saveTimer && S.id) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- lista sottotitoli ---------- */
function renderList() {
  const list = $('#list'); list.innerHTML = ''; $('#count').textContent = S.subs.length;
  S.subs.forEach((s, i) => {
    const d = document.createElement('div'); d.className = 'sub'; d.dataset.id = s.id;
    const nudges = key => ['«:-0.5:−0,500 s', '‹:-0.1:−0,100 s', '›:0.1:+0,100 s', '»:0.5:+0,500 s'].map(x => x.split(':'));
    const grp = key => { const [l1, l2, r1, r2] = nudges(key).map(([t, dlt, tip]) => `<button class="nudge" data-n="${key}:${dlt}" title="${tip}">${t}</button>`); return [l1 + l2, r1 + r2]; };
    const [sl, sr] = grp('start'), [el, er] = grp('end');
    d.innerHTML = `<div class="n">${i + 1}</div><div class="times">
      <div class="trow"><span class="lbl">Inizio</span>${sl}<input class="ts" value="${fmt(s.start)}" title="Inizio">${sr}<button data-a="ss" title="Inizio = cursore (S)">⇤</button><span class="sp"></span><button data-a="add" title="Aggiungi dopo">＋</button><button data-a="del" title="Elimina">✕</button></div>
      <div class="trow"><span class="lbl">Fine</span>${el}<input class="te" value="${fmt(s.end)}" title="Fine">${er}<button data-a="se" title="Fine = cursore (E)">⇥</button></div></div>
      <textarea rows="1" spellcheck="false"></textarea>
      <div class="opts">
        <label>Pos <select class="o-pos">${POSS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <label>In <select class="o-ina">${ANIMS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><input class="o-inms" type="number" min="0" max="5000" step="50" title="Durata entrata (ms)"><span class="dim">ms</span></label>
        <label>Out <select class="o-outa">${ANIMS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><input class="o-outms" type="number" min="0" max="5000" step="50" title="Durata uscita (ms)"><span class="dim">ms</span></label>
        <button data-a="all" class="nudge-all" title="Copia posizione, animazioni ed effetti di questo sottotitolo su tutti">⇊ a tutti</button>
      </div>
      <div class="opts fx">
        <label>Opacità <input class="o-opa" type="number" min="0" max="100" step="5" title="Vuoto = valore globale"><span class="dim">%</span></label>
        <label>Ombra <select class="o-shadow">${TRI.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <label>Bagliore <select class="o-glow">${TRI.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <label>Sfondo <select class="o-box">${TRI.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      </div>`;
    const bindOpt = (cls, key, num) => {
      const el = d.querySelector(cls); el.value = s[key];
      el.onchange = () => { begin(); s[key] = num ? clamp(parseInt(el.value, 10) || 0, 0, 5000) : el.value; if (num) el.value = s[key]; syncOpts(); commit(); renderOverlay(); };
    };
    const syncOpts = () => { d.querySelector('.o-inms').disabled = s.inA === 'none'; d.querySelector('.o-outms').disabled = s.outA === 'none'; };
    const oa = d.querySelector('.o-opa'); oa.value = s.opa; oa.placeholder = String(S.meta.style.opacity);
    oa.onchange = () => { begin(); const v = oa.value.trim(); s.opa = v === '' ? '' : clamp(parseInt(v, 10) || 0, 0, 100); oa.value = s.opa; commit(); renderOverlay(); };
    bindOpt('.o-shadow', 'shadow'); bindOpt('.o-glow', 'glow'); bindOpt('.o-box', 'box');
    bindOpt('.o-pos', 'pos'); bindOpt('.o-ina', 'inA'); bindOpt('.o-inms', 'inMs', true); bindOpt('.o-outa', 'outA'); bindOpt('.o-outms', 'outMs', true); syncOpts();
    const ta = d.querySelector('textarea'); ta.value = s.text;
    ta.oninput = () => { begin(); s.text = ta.value; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; renderOverlay(); S.dirty = true; scheduleSave(); };
    ta.onchange = () => commit();
    ta.onfocus = () => select(s.id, false);
    const timeInput = (cls, key) => {
      const el = d.querySelector(cls);
      el.onchange = () => {
        const v = parseTime(el.value); if (isNaN(v)) { el.value = fmt(s[key]); return; }
        begin(); s[key] = clamp(v, 0, S.dur);
        if (s.end < s.start + .05) { key === 'start' ? s.end = s.start + .05 : s.start = s.end - .05; }
        s.p = false; sortSubs(); commit(); renderList();
      };
    };
    timeInput('.ts', 'start'); timeInput('.te', 'end');
    d.onclick = ev => { if (ev.target.closest('button') || ev.target.tagName === 'INPUT') { if (ev.target.tagName === 'INPUT') select(s.id, false); } else select(s.id, true); };
    d.querySelectorAll('button[data-a]').forEach(b => b.onclick = ev => { ev.stopPropagation(); rowAction(s, b.dataset.a); });
    d.querySelectorAll('button[data-n]').forEach(b => b.onclick = ev => { ev.stopPropagation(); const [k, v] = b.dataset.n.split(':'); nudge(s, k, parseFloat(v)); });
    list.appendChild(d);
    requestAnimationFrame(() => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
  });
  markRows();
}
function nudge(s, key, delta) {
  begin(); const r = v => Math.round(v * 1000) / 1000;
  if (key === 'start') s.start = r(clamp(s.start + delta, 0, s.end - .05));
  else s.end = r(clamp(s.end + delta, s.start + .05, S.dur || Infinity));
  s.p = false; S.sel = s.id; sortSubs(); commit(); renderList();
  video.currentTime = key === 'start' ? s.start : Math.max(s.start, s.end - .05); S.dirty = true;
  const row = document.querySelector(`.sub[data-id="${s.id}"]`); if (row) row.scrollIntoView({ block: 'nearest' });
}
function rowAction(s, a) {
  begin();
  const t = video.currentTime;
  if (a === 'ss') { s.start = Math.min(t, s.end - .05); s.p = false; }
  if (a === 'se') { s.end = Math.max(t, s.start + .05); s.p = false; }
  if (a === 'del') { S.subs = S.subs.filter(x => x !== s); }
  if (a === 'all') {
    if (!confirm('Copiare posizione e animazioni di questo sottotitolo su TUTTI i sottotitoli?')) return;
    S.subs.forEach(x => SUB_FIELDS.forEach(k => x[k] = s[k]));
  }
  if (a === 'add') { const st = s.end + .05; const n = newSub(st, Math.min(S.dur, st + 2), ''); S.subs.splice(S.subs.indexOf(s) + 1, 0, n); S.sel = n.id; }
  if (a === 'ss' || a === 'se') sortSubs();
  commit(); renderList(); if (a === 'add') $(`.sub[data-id="${S.sel}"] textarea`).focus();
}
function select(id, seek) {
  S.sel = id; markRows(); S.dirty = true;
  if (seek) { const s = bySel(); if (s) { video.currentTime = s.start; ensureVisible(s.start); } }
}
function markRows() {
  const t = video.currentTime; const nextId = S.tap ? S.subs[S.tap.cursor]?.id : null;
  document.querySelectorAll('.sub').forEach(r => {
    const id = +r.dataset.id, s = S.subs.find(x => x.id === id); if (!s) return;
    r.classList.toggle('sel', id === S.sel); r.classList.toggle('act', t >= s.start && t < s.end);
    r.classList.toggle('pend', !!s.p); r.classList.toggle('next', id === nextId);
  });
}
function refreshTimes() {
  document.querySelectorAll('.sub').forEach((r, i) => {
    const s = S.subs[i]; if (!s || +r.dataset.id !== s.id) return;
    const a = r.querySelector('.ts'), b = r.querySelector('.te');
    if (document.activeElement !== a) a.value = fmt(s.start); if (document.activeElement !== b) b.value = fmt(s.end);
  });
}

/* ---------- import ---------- */
function parseSrt(txt) {
  const out = []; const blocks = txt.replace(/\r/g, '').trim().split(/\n\s*\n/);
  for (const b of blocks) {
    const l = b.split('\n'); const i = l.findIndex(x => x.includes('-->')); if (i < 0) continue;
    const [a, c] = l[i].split('-->').map(x => parseTime(x.trim().split(' ')[0]));
    const text = l.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (!isNaN(a) && !isNaN(c) && text) out.push(newSub(a, c, text));
  }
  return out;
}
function importText(txt) {
  if (S.subs.length && !confirm('Sostituire i sottotitoli esistenti?')) return;
  begin();
  if (txt.includes('-->')) S.subs = parseSrt(txt);
  else {
    const lines = txt.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    S.subs = lines.map((l, i) => newSub(i * 3, i * 3 + 2.8, l, true));  // p = in attesa di sincronizzazione
  }
  S.sel = null; sortSubs(); commit(); renderList(); fitZoom();
}
$('#bImport').onclick = () => { const v = $('#importText').value.trim(); if (v) { importText(v); $('#importText').value = ''; } };
$('#importFile').onchange = async e => { const f = e.target.files[0]; if (f) importText(await f.text()); e.target.value = ''; };
$('#bAdd').onclick = () => {
  begin(); const t = video.currentTime; const n = newSub(t, Math.min(S.dur, t + 2.5), 'Nuovo testo');
  S.subs.push(n); sortSubs(); S.sel = n.id; commit(); renderList(); $(`.sub[data-id="${n.id}"] textarea`).select();
};

/* ---------- sync a battuta ---------- */
function tapToggle(on = !S.tap) {
  if (on) {
    if (!S.subs.length) { alert('Importa prima il testo.'); return; }
    let c = S.subs.findIndex(s => s.p); if (c < 0) { if (!confirm('Tutte le frasi hanno già un tempo. Risincronizzare da capo?')) return; S.subs.forEach(s => s.p = true); c = 0; }
    begin(); S.tap = { cursor: c }; video.play();
  } else { S.tap = null; sortSubs(); commit(); renderList(); }
  $('#bTap').classList.toggle('on', !!S.tap); $('#bTap').textContent = S.tap ? '■ Fine sincronizzazione' : '⏺ Sincronizza a battuta'; tapBar(); markRows();
}
function tapBar() {
  const tb = $('#tapBar'); tb.hidden = !S.tap;
  if (S.tap) tb.textContent = `Invio = inizio di: "${(S.subs[S.tap.cursor]?.text || '').slice(0, 40)}"`;
}
function tapStamp() {
  const T = S.tap, s = S.subs[T.cursor]; if (!s) return tapToggle(false);
  const t = video.currentTime; s.start = t; s.end = Math.min(S.dur, t + 3); s.p = false;
  const prev = S.subs[T.cursor - 1];
  if (prev && !prev.p) prev.end = Math.max(prev.start + .1, Math.min(prev.end, t - .05));
  T.cursor++; S.dirty = true;
  const c = $(`.sub[data-id="${s.id}"]`); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (T.cursor >= S.subs.length) return tapToggle(false);
  tapBar(); refreshTimes(); markRows(); scheduleSave();
}
function tapBack() { const T = S.tap; if (!T || T.cursor === 0) return; T.cursor--; const s = S.subs[T.cursor]; s.p = true; tapBar(); S.dirty = true; markRows(); }
$('#bTap').onclick = () => tapToggle();

/* ---------- trasporto ---------- */
const togglePlay = () => video.paused ? video.play() : video.pause();
function transportState() {
  const playing = !video.paused;
  $('#bPlay').classList.toggle('active', playing);
  $('#bPause').classList.toggle('active', !playing && video.currentTime > 0.01);
}
$('#bPlay').onclick = e => { video.play(); e.currentTarget.blur(); };
$('#bPause').onclick = e => { video.pause(); e.currentTarget.blur(); };
$('#bStop').onclick = e => {                       // stop: ferma e torna all'inizio
  video.pause(); video.currentTime = 0; S.scroll = 0; syncScroll(); S.dirty = true; transportState(); e.currentTarget.blur();
};
video.onplay = video.onpause = video.onseeked = transportState;
video.onclick = togglePlay;
$('#seek').oninput = e => { video.currentTime = e.target.value / 1000 * S.dur; };
const seekTo = t => { video.currentTime = clamp(t, 0, S.dur); S.dirty = true; };

/* ---------- timeline (canvas) ---------- */
const cv = $('#tl'), ctx = cv.getContext('2d');
const L = { ruler: 22, waveTop: 22, waveBot: 100, laneTop: 108, laneBot: 168 };
const X = t => (t - S.scroll) * S.zoom, T = x => x / S.zoom + S.scroll;
let drag = null;

function resizeCanvas() {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); S.dirty = true;
}
function fitZoom() { S.zoom = Math.max(4, (cv.clientWidth - 20) / Math.max(1, S.dur)); S.scroll = 0; S.dirty = true; syncScroll(); }
function setZoom(z, anchorT, anchorX) {
  S.zoom = clamp(z, 4, 1200); S.scroll = anchorT - anchorX / S.zoom; clampScroll(); S.dirty = true; syncScroll();
}
function clampScroll() { S.scroll = clamp(S.scroll, 0, Math.max(0, S.dur - cv.clientWidth / S.zoom * .9)); }
function syncScroll() { const r = $('#scroll'); r.max = Math.max(0, S.dur - cv.clientWidth / S.zoom); r.value = S.scroll; }
function ensureVisible(t) { const w = cv.clientWidth / S.zoom; if (t < S.scroll || t > S.scroll + w * .92) { S.scroll = Math.max(0, t - w * .1); clampScroll(); syncScroll(); S.dirty = true; } }
$('#zIn').onclick = () => setZoom(S.zoom * 1.5, video.currentTime, X(video.currentTime));
$('#zOut').onclick = () => setZoom(S.zoom / 1.5, video.currentTime, X(video.currentTime));
$('#zFit').onclick = fitZoom;
$('#scroll').oninput = e => { S.scroll = +e.target.value; S.dirty = true; };

function drawTimeline() {
  const w = cv.clientWidth, h = cv.clientHeight; ctx.clearRect(0, 0, w, h);
  // ruler
  const steps = [.1, .25, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]; const step = steps.find(s => s * S.zoom >= 70) || 600;
  ctx.fillStyle = '#1a1d23'; ctx.fillRect(0, 0, w, L.ruler); ctx.font = '11px ui-monospace,monospace'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#2d333d'; ctx.fillStyle = '#8b93a3';
  for (let t = Math.floor(S.scroll / step) * step; X(t) < w; t += step) {
    const x = Math.round(X(t)) + .5; ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, h); ctx.stroke();
    ctx.fillText(fmt(t).replace(/\.?0+$/, ''), x + 3, 8);
  }
  // waveform
  const P = S.peaks;
  if (P && P.a.length) {
    const mid = (L.waveTop + L.waveBot) / 2, amp = (L.waveBot - L.waveTop) / 2 - 2; ctx.fillStyle = '#3b6ea5';
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor(T(x) * P.rate), i1 = Math.max(i0 + 1, Math.floor(T(x + 1) * P.rate)); let m = 0;
      for (let i = i0; i < i1 && i < P.a.length; i++) if (P.a[i] > m) m = P.a[i];
      const v = Math.min(1, m / P.norm) * amp; if (v > .3) ctx.fillRect(x, mid - v, 1, v * 2);
    }
  }
  // blocks
  ctx.font = '12px system-ui'; ctx.textBaseline = 'middle';
  S.subs.forEach((s, i) => {
    const x0 = X(s.start), x1 = X(s.end); if (x1 < 0 || x0 > w) return;
    const sel = s.id === S.sel, bw = Math.max(2, x1 - x0);
    ctx.fillStyle = s.p ? '#4a2a30' : sel ? '#e49a14' : (i % 2 ? '#2f6f57' : '#2f5f8f');
    ctx.fillRect(x0, L.laneTop, bw, L.laneBot - L.laneTop);
    ctx.strokeStyle = sel ? '#fff' : 'rgba(255,255,255,.25)'; ctx.lineWidth = sel ? 2 : 1;
    if (s.p) ctx.setLineDash([4, 3]); ctx.strokeRect(x0 + .5, L.laneTop + .5, bw - 1, L.laneBot - L.laneTop - 1); ctx.setLineDash([]); ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x0, L.laneTop, 3, L.laneBot - L.laneTop); ctx.fillRect(x0 + bw - 3, L.laneTop, 3, L.laneBot - L.laneTop);
    if (bw > 24) { ctx.save(); ctx.beginPath(); ctx.rect(x0 + 5, L.laneTop, bw - 10, L.laneBot - L.laneTop); ctx.clip(); ctx.fillStyle = sel ? '#1a1300' : '#fff'; ctx.fillText(`${i + 1}  ${s.text.replace(/\n/g, ' ')}`, x0 + 6, (L.laneTop + L.laneBot) / 2); ctx.restore(); }
  });
  // playhead
  const px = Math.round(X(video.currentTime)) + .5;
  ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = '#ff5a5a'; ctx.beginPath(); ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 8); ctx.fill();
  if (drag?.snapT != null) { ctx.strokeStyle = '#ffe14a'; ctx.setLineDash([3, 3]); const sx = Math.round(X(drag.snapT)) + .5; ctx.beginPath(); ctx.moveTo(sx, L.ruler); ctx.lineTo(sx, h); ctx.stroke(); ctx.setLineDash([]); }
}

function hit(x, y) {
  if (y < L.laneTop || y > L.laneBot) return null;
  for (let i = S.subs.length - 1; i >= 0; i--) {                        // il selezionato per primo, poi dall'alto
    const s = S.subs[i]; const a = X(s.start), b = X(s.end);
    if (x >= a - 3 && x <= b + 3) {
      const edge = Math.min(8, (b - a) / 3);
      return { s, part: x <= a + edge ? 'l' : x >= b - edge ? 'r' : 'm' };
    }
  }
  return null;
}
function snap(t, exclude, noSnap) {
  if (noSnap) return { t, snapT: null };
  const th = 8 / S.zoom; let best = null, bd = th;
  const cands = [video.currentTime]; for (const s of S.subs) if (s !== exclude) cands.push(s.start, s.end);
  for (const c of cands) { const d = Math.abs(c - t); if (d < bd) { bd = d; best = c; } }
  return best == null ? { t, snapT: null } : { t: best, snapT: best };
}
const mouse = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

cv.onpointerdown = e => {
  cv.setPointerCapture(e.pointerId); const [x, y] = mouse(e); const h = hit(x, y);
  if (h) {
    begin(); select(h.s.id, false); renderListSelection(h.s);
    drag = { type: h.part, s: h.s, t0: T(x), start: h.s.start, end: h.s.end };
  } else { drag = { type: 'seek' }; if (y < L.laneTop || true) { S.sel = null; markRows(); } seekTo(T(x)); }
};
cv.onpointermove = e => {
  const [x, y] = mouse(e);
  if (!drag) { const h = hit(x, y); cv.style.cursor = h ? (h.part === 'm' ? 'grab' : 'ew-resize') : 'default'; return; }
  const t = clamp(T(x), 0, S.dur);
  if (drag.type === 'seek') { seekTo(t); return; }
  const s = drag.s, d = T(x) - drag.t0, noSnap = e.altKey, MIN = .1;
  if (drag.type === 'm') {
    const len = drag.end - drag.start; let ns = clamp(drag.start + d, 0, Math.max(0, S.dur - len));
    const a = snap(ns, s, noSnap), b = snap(ns + len, s, noSnap);
    if (a.snapT != null && (b.snapT == null || Math.abs(a.t - ns) <= Math.abs(b.t - ns - len))) { ns = a.t; drag.snapT = a.snapT; }
    else if (b.snapT != null) { ns = b.t - len; drag.snapT = b.snapT; } else drag.snapT = null;
    s.start = clamp(ns, 0, S.dur - len); s.end = s.start + len; cv.style.cursor = 'grabbing';
  } else if (drag.type === 'l') {
    const r = snap(clamp(drag.start + d, 0, drag.end - MIN), s, noSnap); drag.snapT = r.snapT; s.start = clamp(r.t, 0, drag.end - MIN);
  } else {
    const r = snap(clamp(drag.end + d, drag.start + MIN, S.dur), s, noSnap); drag.snapT = r.snapT; s.end = clamp(r.t, drag.start + MIN, S.dur);
  }
  s.p = false; S.dirty = true; refreshTimes(); renderOverlay();
};
cv.onpointerup = () => {
  if (drag && drag.type !== 'seek') { sortSubs(); commit(); renderList(); }
  drag = null; S.dirty = true;
};
cv.ondblclick = e => {
  const [x, y] = mouse(e); if (hit(x, y)) return;
  begin(); const t = clamp(T(x), 0, S.dur); const n = newSub(t, Math.min(S.dur, t + 2.5), 'Nuovo testo');
  S.subs.push(n); sortSubs(); S.sel = n.id; commit(); renderList(); $(`.sub[data-id="${n.id}"] textarea`).select();
};
cv.addEventListener('wheel', e => {
  e.preventDefault(); const [x] = mouse(e);
  if (e.ctrlKey || e.metaKey) setZoom(S.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), T(x), x);
  else { S.scroll += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / S.zoom; clampScroll(); syncScroll(); S.dirty = true; }
}, { passive: false });
function renderListSelection(s) { markRows(); document.querySelector(`.sub[data-id="${s.id}"]`)?.scrollIntoView({ block: 'nearest' }); }

/* ---------- loop di rendering ---------- */
let lastT = -1;
function loop() {
  raf = requestAnimationFrame(loop);
  if (!S.id) return;
  const t = video.currentTime;
  if (t !== lastT) {
    lastT = t; S.dirty = true; $('#tcur').textContent = fmt(t);
    if (S.dur) $('#seek').value = t / S.dur * 1000;
    renderOverlay(); markRows();
    if (!video.paused && !drag) ensureVisible(t);
  }
  if (S.dirty) { S.dirty = false; drawTimeline(); }
}

/* ---------- esportazione ---------- */
$('#bExport').onclick = async () => {
  if (S.subs.some(s => s.p) && !confirm('Alcune frasi non sono ancora sincronizzate (righe rosse). Esportare comunque?')) return;
  clearTimeout(saveTimer); await saveNow();
  try { await api('export', { id: S.id }); } catch (e) { $('#exMsg').textContent = e.message; return; }
  $('#dlVideo').hidden = true; exportPoll();
};
async function exportPoll() {
  clearTimeout(exportTimer); const id = S.id; if (!id) return;
  const st = await api('status', { id, mode: 'export' }).catch(() => ({ status: 'idle' }));
  if (S.id !== id) return;
  const busy = st.status === 'queued' || st.status === 'running';
  $('#exProg').hidden = !busy; $('#bExport').disabled = busy; $('#exProg').value = (st.progress || 0) * 100;
  $('#exMsg').textContent = busy ? `Rendering ffmpeg… ${Math.round((st.progress || 0) * 100)}%` : st.status === 'error' ? 'Errore: ' + st.error : st.status === 'done' ? 'Video pronto.' : '';
  $('#dlVideo').hidden = !st.hasOutput;
  if (busy) exportTimer = setTimeout(exportPoll, 1000);
}

/* ---------- anteprima fedele (clip ffmpeg) ---------- */
$('#bClip').onclick = async () => {
  const btn = $('#bClip'), label = btn.textContent; video.pause();
  if (S.subs.some(s => s.p) && !S.subs.some(s => !s.p)) { alert('Nessuna frase è ancora sincronizzata: non ci sarebbe nulla da vedere.'); return; }
  btn.disabled = true; btn.textContent = 'Rendering… 0%';
  try {
    clearTimeout(saveTimer); await saveNow();
    await api('clip', { id: S.id, t: video.currentTime.toFixed(3) });
    for (;;) {
      await new Promise(r => setTimeout(r, 700));
      const st = await api('status', { id: S.id, mode: 'clip' });
      btn.textContent = `Rendering… ${Math.round((st.progress || 0) * 100)}%`;
      if (st.status === 'error') throw new Error(st.error);
      if (st.status === 'done') break;
    }
    $('#clipVideo').src = `${API}?a=get_clip&id=${S.id}&v=${Date.now()}`;
    $('#clipDlg').showModal(); $('#clipVideo').play().catch(() => {});
  } catch (e) { alert(e.message); }
  btn.disabled = false; btn.textContent = label;
};
$('#clipClose').onclick = () => $('#clipDlg').close();
$('#clipDlg').addEventListener('close', () => $('#clipVideo').pause());

/* ---------- scorciatoie ---------- */
document.addEventListener('keydown', e => {
  if (!S.id || $('#editor').hidden) return;
  const tag = document.activeElement?.tagName, typing = tag === 'INPUT' && document.activeElement.type !== 'range' || tag === 'TEXTAREA' || tag === 'SELECT';
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
  if (typing || mod) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'Enter' && S.tap) { e.preventDefault(); tapStamp(); }
  else if (k === 'Backspace' && S.tap) { e.preventDefault(); tapBack(); }
  else if (k === 'ArrowLeft') { e.preventDefault(); seekTo(video.currentTime - (e.shiftKey ? 5 : .5)); }
  else if (k === 'ArrowRight') { e.preventDefault(); seekTo(video.currentTime + (e.shiftKey ? 5 : .5)); }
  else if ((k === 's' || k === 'S') && bySel()) rowAction(bySel(), 'ss');
  else if ((k === 'e' || k === 'E') && bySel()) rowAction(bySel(), 'se');
  else if ((k === 'Delete') && bySel()) rowAction(bySel(), 'del');
  else if (k === 'Escape' && S.tap) tapToggle(false);
});

/* ---------- avvio ---------- */
window.addEventListener('resize', () => { resizeCanvas(); applyLimits(); layoutStage(); });
/* ---------- riquadro video ridimensionabile (altezza) e divisore colonne (larghezza) ---------- */
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* */ } } };
const gridEl = $('.grid'), stageEl = $('#stage');
const maxStageH = () => S.meta ? S.meta.height : 1200;                          // al massimo l'altezza originale del video (niente upscaling)
function setStageH(h, persist) { S.vpTarget = null; h = clamp(Math.round(h), 140, maxStageH()); stageEl.style.setProperty('--sh', h + 'px'); stageEl.style.height = h + 'px'; if (persist) store.set('subtitler.sh', h); layoutStage(); }
function setLeftW(w, persist) { S.vpTarget = null; const max = Math.min(gridEl.clientWidth - 24 - 320 - 8, S.meta ? S.meta.width + 22 : Infinity); w = clamp(Math.round(w), 360, Math.max(360, max)); gridEl.style.setProperty('--lw', w + 'px'); if (persist) store.set('subtitler.lw', w); layoutStage(); resizeCanvas(); }
/** Mantiene il riquadro video entro WxH originali (niente upscaling): chiamata a ogni apertura/ridimensionamento. */
/* Dimensione del video nell'anteprima + pulsanti rapidi 100% / 50% della risoluzione originale */
function updateVpInfo() {
  if (!S.meta) return;
  const W = S.meta.width, vw = $('#vwrap').clientWidth, vh = $('#vwrap').clientHeight, k = vw / W, el = $('#vpInfo');
  el.textContent = `Anteprima ${vw}×${vh} (${Math.round(k * 100)}%)`;
  const short = S.vpTarget && k < S.vpTarget - .015;                                  // richiesta non raggiungibile con lo spazio disponibile
  el.classList.toggle('warn', !!short);
  el.title = short ? `Spazio insufficiente per il ${Math.round(S.vpTarget * 100)}%: allarga la finestra o riduci il riquadro di destra` : "Dimensione attuale del video nell'anteprima";
  $('#vp100').classList.toggle('on', Math.abs(k - 1) < .015); $('#vp50').classList.toggle('on', Math.abs(k - .5) < .015);
}
function setViewScale(s) {
  if (!S.meta) return;
  const W = S.meta.width, H = S.meta.height;
  const h = Math.round(H * s); stageEl.style.setProperty('--sh', h + 'px'); stageEl.style.height = h + 'px'; store.set('subtitler.sh', h);
  const max = Math.min(gridEl.clientWidth - 24 - 320 - 8, W + 22), w = clamp(Math.round(W * s) + 22, 360, Math.max(360, max));
  gridEl.style.setProperty('--lw', w + 'px'); store.set('subtitler.lw', w);
  S.vpTarget = s; layoutStage(); resizeCanvas();
}
$('#vp100').onclick = () => setViewScale(1);
$('#vp50').onclick = () => setViewScale(.5);

function applyLimits() {
  if (!S.meta) return;
  if (stageEl.clientHeight > S.meta.height) setStageH(S.meta.height, false);
  if ($('.left').getBoundingClientRect().width > S.meta.width + 23) setLeftW(S.meta.width + 22, false);
}
function dragger(el, onMove, onEnd) {
  el.onpointerdown = e => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag'); document.body.classList.add('resizing'); const x0 = e.clientX, y0 = e.clientY; el._o = el._start(); el.onpointermove = ev => onMove(ev.clientX - x0, ev.clientY - y0, el._o); };
  el.onpointerup = el.onpointercancel = () => { el.onpointermove = null; el.classList.remove('drag'); document.body.classList.remove('resizing'); onEnd(); };
}
const hg = $('#hgrip'), vs = $('#vsplit');
hg._start = () => stageEl.clientHeight; dragger(hg, (dx, dy, o) => setStageH(o + dy, false), () => store.set('subtitler.sh', stageEl.clientHeight));
vs._start = () => $('.left').getBoundingClientRect().width; dragger(vs, (dx, dy, o) => setLeftW(o + dx, false), () => store.set('subtitler.lw', Math.round($('.left').getBoundingClientRect().width)));
hg.ondblclick = () => { stageEl.style.removeProperty('--sh'); stageEl.style.height = ''; store.set('subtitler.sh', null); layoutStage(); applyLimits(); };
vs.ondblclick = () => { gridEl.style.removeProperty('--lw'); store.set('subtitler.lw', null); layoutStage(); resizeCanvas(); applyLimits(); };
{ const h = +store.get('subtitler.sh'), w = +store.get('subtitler.lw'); if (h) { stageEl.style.setProperty('--sh', h + 'px'); stageEl.style.height = h + 'px'; } if (w) gridEl.style.setProperty('--lw', w + 'px'); }
new ResizeObserver(() => { layoutStage(); }).observe(stageEl);
new ResizeObserver(() => { resizeCanvas(); }).observe($('#tl'));
video.addEventListener('loadedmetadata', () => { if (isFinite(video.duration) && video.duration > 0) { S.dur = video.duration; $('#tdur').textContent = fmt(S.dur); syncScroll(); } layoutStage(); });
async function route() {
  const h = location.hash.slice(1);
  try {
    await flushSave();                                  // non perdere modifiche in attesa del salvataggio automatico
    if (h === 'new') return showNew();
    if (h) { resizeCanvas(); await openProject(h); resizeCanvas(); fitZoom(); updateMenuState(); return; }
    // avvio senza progetto indicato: riapri l'ultimo, se l'opzione è attiva
    const set = await api('settings');
    $('#optOpenLast').checked = !!set.openLast;
    if (set.openLast) {
      const last = (await api('list', { limit: 1 }))[0];
      if (last) { history.replaceState(null, '', '#' + last.id); return route(); }
    }
    history.replaceState(null, '', '#new'); showNew();
  } catch (e) { alert(e.message); history.replaceState(null, '', '#new'); showNew(); }
}
window.addEventListener('hashchange', route);
api('settings').then(set => { $('#optOpenLast').checked = !!set.openLast; }).catch(() => {});
route();


/* ---------- dimensioni di uscita (ritaglio) ---------- */
const CROP_RATIOS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5, '4:3': 4 / 3, '3:4': 3 / 4 };
const cropRatio = () => CROP_RATIOS[S.cropKey] || null;
function setOut(o) {                                  // o = {x,y,w,h} in pixel del video originale, oppure null (nessun ritaglio)
  const W = S.meta.width, H = S.meta.height;
  if (o) {
    const w = clamp(Math.round(o.w) & ~1, 16, W & ~1), h = clamp(Math.round(o.h) & ~1, 16, H & ~1);
    const x = clamp(Math.round(o.x) & ~1, 0, W - w), y = clamp(Math.round(o.y) & ~1, 0, H - h);
    o = (w >= W - 1 && h >= H - 1) ? null : { w, h, x, y };
  }
  S.meta.style.out = o; if (!o) S.cropKey = 'orig';
  syncCropForm(); layoutStage(); renderOverlay(); scheduleSave();
}
function syncCropForm() {
  if (!S.meta) return;
  const r = cropRect(), W = S.meta.width, H = S.meta.height;
  $('#cW').value = r.w; $('#cH').value = r.h; $('#cX').value = r.x; $('#cY').value = r.y; $('#cPreset').value = S.cropKey || 'orig';
  $('#cW').max = W; $('#cH').max = H;
  $('#cInfo').textContent = isCropped() ? `Ritaglio ${r.w}×${r.h} px a partire da (${r.x}, ${r.y}). Il video non viene ridimensionato: i sottotitoli sono dimensionati sul frame di uscita.` : 'Nessun ritaglio: il video esce alla risoluzione originale.';
  const ri = $('#resInfo'); ri.hidden = false; $('#resBar').hidden = false;
  ri.textContent = isCropped() ? `${W}×${H} → ${r.w}×${r.h}` : `${W}×${H}`;
  ri.title = isCropped() ? `Originale ${W}×${H} px · Uscita (ritaglio) ${r.w}×${r.h} px` : `Risoluzione originale ${W}×${H} px (uscita identica)`;
  ri.classList.toggle('crop', isCropped());
}
$('#cPreset').onchange = e => {
  const v = e.target.value, W = S.meta.width, H = S.meta.height; S.cropKey = v;
  if (v === 'orig') return setOut(null);
  if (v === 'free') return syncCropForm();
  const r = CROP_RATIOS[v]; let w = W, h = W / r; if (h > H) { h = H; w = H * r; }
  setOut({ w, h, x: (W - w) / 2, y: (H - h) / 2 });
};
function cropDim(which, val) {
  const W = S.meta.width, H = S.meta.height, r = cropRect(), ratio = cropRatio();
  let w = which === 'w' ? clamp(val, 16, W) : r.w, h = which === 'h' ? clamp(val, 16, H) : r.h;
  if (ratio) { if (which === 'w') { h = w / ratio; if (h > H) { h = H; w = h * ratio; } } else { w = h * ratio; if (w > W) { w = W; h = w / ratio; } } }
  setOut({ ...r, w, h });
}
$('#cW').onchange = e => cropDim('w', parseInt(e.target.value, 10) || cropRect().w);
$('#cH').onchange = e => cropDim('h', parseInt(e.target.value, 10) || cropRect().h);
$('#cX').onchange = e => setOut({ ...cropRect(), x: parseInt(e.target.value, 10) || 0 });
$('#cY').onchange = e => setOut({ ...cropRect(), y: parseInt(e.target.value, 10) || 0 });
$('#cCenter').onclick = () => { const r = cropRect(); setOut({ ...r, x: (S.meta.width - r.w) / 2, y: (S.meta.height - r.h) / 2 }); };
$('#cReset').onclick = () => { S.cropKey = 'orig'; setOut(null); };

/* riquadro di ritaglio sul video: trascina per spostare, maniglie agli angoli per ridimensionare */
const cbox = $('#cropbox'); let cdrag = null;
cbox.onpointerdown = e => {
  e.preventDefault(); cbox.setPointerCapture(e.pointerId);
  const rc = $('#vwrap').getBoundingClientRect();
  cdrag = { handle: e.target.dataset ? e.target.dataset.h || null : null, x0: e.clientX, y0: e.clientY, r0: cropRect(), kv: rc.width / S.meta.width, rc, moved: false };
};
cbox.onpointermove = e => {
  if (!cdrag) return;
  const { kv, r0, rc } = cdrag, W = S.meta.width, H = S.meta.height;
  if (Math.abs(e.clientX - cdrag.x0) + Math.abs(e.clientY - cdrag.y0) > 3) cdrag.moved = true;
  if (!cdrag.moved) return;
  if (!cdrag.handle) { setOut({ ...r0, x: r0.x + (e.clientX - cdrag.x0) / kv, y: r0.y + (e.clientY - cdrag.y0) / kv }); return; }
  const px = clamp((e.clientX - rc.left) / kv, 0, W), py = clamp((e.clientY - rc.top) / kv, 0, H), hd = cdrag.handle, ratio = cropRatio();
  let x1 = r0.x, y1 = r0.y, x2 = r0.x + r0.w, y2 = r0.y + r0.h;
  if (hd.includes('w')) x1 = Math.min(px, x2 - 16); if (hd.includes('e')) x2 = Math.max(px, x1 + 16);
  if (hd.includes('n')) y1 = Math.min(py, y2 - 16); if (hd.includes('s')) y2 = Math.max(py, y1 + 16);
  let w = x2 - x1, h = y2 - y1;
  if (ratio) {                                          // proporzione bloccata: l'altezza segue la larghezza, entro i bordi del video
    h = w / ratio; const room = hd.includes('n') ? y2 : H - y1;
    if (h > room) { h = room; w = h * ratio; }
    if (hd.includes('w')) x1 = x2 - w; else x2 = x1 + w;
    if (hd.includes('n')) y1 = y2 - h; else y2 = y1 + h;
  }
  setOut({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
};
cbox.onpointerup = cbox.onpointercancel = () => { if (cdrag && !cdrag.moved && !cdrag.handle) togglePlay(); cdrag = null; };
