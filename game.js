'use strict';
/* MU 2D Online — cliente (Phaser 3). Sprites pixel art gerados por código (originais). */
const $ = id => document.getElementById(id);
const CLSN = { DK: 'Dark Knight', DW: 'Dark Wizard', FE: 'Fairy Elf', SU: 'Summoner' };
const RARN = ['Comum', 'Rara', 'Épica', 'Lendária'];
const SLOTN = { weapon: 'Arma', armor: 'Armadura', helm: 'Elmo', boots: 'Botas' };
let ws = null, wel = null, game = null, scene = null, ME = {}, loggedIn = false, mode = 'login', pickCls = 'DK', retry = 0;
let sndOn = true; try { sndOn = localStorage.getItem('mu_snd') !== '0'; } catch { }

/* ───── áudio simples (WebAudio) ───── */
let AC = null;
function beep(f, d, type, v) {
  if (!sndOn) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain(); o.type = type || 'square'; o.frequency.value = f;
    g.gain.value = v || 0.04; g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + d);
    o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + d);
  } catch { }
}

/* ───── login ───── */
for (const k in CLSN) { const b = document.createElement('button'); b.textContent = CLSN[k]; b.dataset.k = k; if (k === 'DK') b.className = 'on'; $('classes').appendChild(b); }
$('classes').onclick = e => { const k = e.target.dataset.k; if (!k) return; pickCls = k; [...$('classes').children].forEach(b => b.classList.toggle('on', b.dataset.k === k)); };
$('tL').onclick = () => setMode('login'); $('tR').onclick = () => setMode('register');
function setMode(m) { mode = m; $('tL').classList.toggle('on', m === 'login'); $('tR').classList.toggle('on', m === 'register'); $('classes').style.display = m === 'register' ? 'grid' : 'none'; $('go').textContent = m === 'login' ? 'ENTRAR' : 'CRIAR E JOGAR'; $('err').textContent = ''; }
$('go').onclick = () => { $('err').textContent = ''; connect({ t: mode, u: $('u').value.trim(), p: $('p').value, cls: pickCls }); };
let savedTok = null; try { savedTok = localStorage.getItem('mu_tok'); } catch { }
if (savedTok) connect({ t: 'token', tok: savedTok });

function connect(first) {
  if (ws) { try { ws.onclose = null; ws.close(); } catch { } }
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => ws.send(JSON.stringify(first));
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
  ws.onclose = () => {
    if (!loggedIn) return;
    $('conn').style.display = 'flex';
    setTimeout(() => { retry++; let t = null; try { t = localStorage.getItem('mu_tok'); } catch { } if (t) connect({ t: 'token', tok: t }); else location.reload(); }, Math.min(5000, 1000 + retry * 500));
  };
}
const tx = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function onMsg(m) {
  switch (m.t) {
    case 'err': $('err').textContent = m.m; if (m.relogin) { try { localStorage.removeItem('mu_tok'); } catch { } if (loggedIn) location.reload(); } break;
    case 'welcome':
      wel = m; loggedIn = true; retry = 0; $('conn').style.display = 'none'; $('login').style.display = 'none';
      try { localStorage.setItem('mu_tok', m.tok); } catch { }
      $('who').textContent = `${m.name} — ${CLSN[m.cls]}`;
      if (!game) startGame(); break;
    case 's': if (scene && scene.ready) scene.applySnap(m); break;
    case 'me': ME = m; renderInv(); hudXp(); break;
    case 'log': addChat('', m.m, '#9fe6ff'); break;
    case 'chat': addChat(m.n, m.m, '#fff'); break;
  }
}
function addChat(n, m, col) {
  const d = document.createElement('div'); d.style.color = col;
  if (n) { const b = document.createElement('b'); b.textContent = n + ': '; b.style.color = '#ffd24a'; d.appendChild(b); }
  d.appendChild(document.createTextNode(m)); const L = $('chatlog'); L.appendChild(d);
  while (L.children.length > 6) L.removeChild(L.firstChild);
}
function bar(id, v, mx, txt) { const e = $(id); e.firstChild.style.width = Math.max(0, Math.min(100, v / mx * 100)) + '%'; e.lastChild.textContent = txt; }
function hudXp() { if (ME.xpn) bar('bxp', ME.xp, ME.xpn, `Nv ${ME.lvl}  XP ${ME.xp}/${ME.xpn}`); $('zen').textContent = 'Zen: ' + (ME.zen || 0); }

/* ───── inventário ───── */
let selId = null;
const itemTxt = it => it.k === 'eq' ? `${it.n}\n${it.atk ? 'ATK +' + it.atk : 'DEF +' + it.def}` : `${it.n} x${it.q}`;
function slotEl(it, sel) {
  const d = document.createElement('div'); d.className = 'sl' + (sel ? ' sel' : '');
  if (it) { d.classList.add('r' + (it.r || 0)); d.textContent = itemTxt(it).replace('\n', ' '); }
  return d;
}
function renderInv() {
  if (!ME.inv) return;
  $('stats').textContent = `Nv ${ME.lvl} • ATK ${ME.atk} • DEF ${ME.def} • Skill: ${ME.sk}`;
  const eq = $('eq'); eq.textContent = '';
  for (const s in SLOTN) { const it = (ME.eq || {})[s]; const d = slotEl(it, false); if (!it) d.textContent = SLOTN[s]; d.onclick = () => { selId = it ? 'eq:' + s : null; renderInv(); }; eq.appendChild(d); }
  const g = $('grid'); g.textContent = ''; $('cnt').textContent = `${ME.inv.length}/24`;
  for (let i = 0; i < 24; i++) { const it = ME.inv[i]; const d = slotEl(it, it && it.id === selId); if (it) d.onclick = () => { selId = it.id; renderInv(); }; g.appendChild(d); }
  renderDet();
}
function renderDet() {
  const D = $('det'); D.textContent = '';
  if (!selId) { D.textContent = 'Toque em um item.'; return; }
  const eqSel = selId.startsWith('eq:'); const it = eqSel ? (ME.eq || {})[selId.slice(3)] : ME.inv.find(i => i.id === selId);
  if (!it) { selId = null; D.textContent = 'Toque em um item.'; return; }
  const h = document.createElement('div'); h.className = 'r' + (it.r || 0); h.style.fontWeight = '700'; h.textContent = it.n; D.appendChild(h);
  if (it.k === 'eq') {
    const cur = (ME.eq || {})[it.slot], da = (it.atk || 0) - (cur && !eqSel ? cur.atk || 0 : 0), dd = (it.def || 0) - (cur && !eqSel ? cur.def || 0 : 0);
    const t = document.createElement('div'); t.textContent = `${RARN[it.r]} • Req. Nv ${it.lvl}${it.cls ? ' • ' + CLSN[it.cls] : ''} • ${it.atk ? 'ATK +' + it.atk : 'DEF +' + it.def}` + (!eqSel && cur ? `  (vs equipado: ${(it.atk ? da : dd) >= 0 ? '+' : ''}${it.atk ? da : dd})` : ''); D.appendChild(t);
  }
  const mk = (txt, fn) => { const b = document.createElement('button'); b.textContent = txt; b.onclick = fn; D.appendChild(b); };
  if (eqSel) mk('Desequipar', () => { tx({ t: 'unequip', slot: selId.slice(3) }); selId = null; });
  else {
    if (it.k === 'eq') mk('Equipar', () => tx({ t: 'equip', id: it.id }));
    else mk('Usar', () => tx({ t: 'use', id: it.id }));
    mk('Vender', () => { if (it.r >= 1 && !confirm('Vender ' + it.n + '?')) return; tx({ t: 'sell', id: it.id, ok: 1 }); selId = null; });
    mk('Descartar', () => { if (it.r >= 1 && !confirm('Descartar ' + it.n + '?')) return; tx({ t: 'drop', id: it.id, ok: 1 }); selId = null; });
  }
}
$('tInv').onclick = () => { const v = $('inv').style.display !== 'block'; $('inv').style.display = v ? 'block' : 'none'; if (v) renderInv(); };
$('shHp').onclick = () => tx({ t: 'buy', k: 'hp' }); $('shMp').onclick = () => tx({ t: 'buy', k: 'mp' });
$('tSnd').onclick = () => { sndOn = !sndOn; $('tSnd').style.opacity = sndOn ? 1 : 0.5; try { localStorage.setItem('mu_snd', sndOn ? '1' : '0'); } catch { } };
$('tSnd').style.opacity = sndOn ? 1 : 0.5;
$('tChat').onclick = () => { const b = $('chatbox'); const v = b.style.display !== 'block'; b.style.display = v ? 'block' : 'none'; if (v) $('chatin').focus(); };
$('chatin').onkeydown = e => { if (e.key === 'Enter') { const v = $('chatin').value.trim(); if (v) tx({ t: 'chat', m: v }); $('chatin').value = ''; $('chatbox').style.display = 'none'; $('chatin').blur(); } e.stopPropagation(); };

/* ───── controles ───── */
const IN = { jx: 0, jy: 0, kx: 0, ky: 0, atk: false };
(function joystick() {
  const j = $('joy'), k = $('knob'); let id = null;
  const upd = e => { const r = j.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = e.clientX - cx, dy = e.clientY - cy; const m = 50, l = Math.hypot(dx, dy); if (l > m) { dx = dx / l * m; dy = dy / l * m; } k.style.left = (34 + dx) + 'px'; k.style.top = (34 + dy) + 'px'; IN.jx = Math.abs(dx) < 8 && Math.abs(dy) < 8 ? 0 : dx / m; IN.jy = Math.abs(dx) < 8 && Math.abs(dy) < 8 ? 0 : dy / m; };
  j.addEventListener('pointerdown', e => { id = e.pointerId; j.setPointerCapture(id); upd(e); e.preventDefault(); });
  j.addEventListener('pointermove', e => { if (e.pointerId === id) upd(e); });
  const end = e => { if (e.pointerId !== id) return; id = null; IN.jx = IN.jy = 0; k.style.left = '34px'; k.style.top = '34px'; };
  j.addEventListener('pointerup', end); j.addEventListener('pointercancel', end);
})();
const hold = (el, on, off) => { el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); on(); }); const f = () => off && off(); el.addEventListener('pointerup', f); el.addEventListener('pointercancel', f); };
hold($('bAtk'), () => { IN.atk = true; }, () => { IN.atk = false; });
hold($('bSk'), () => skill());
hold($('bHp'), () => usePot('hp')); hold($('bMp'), () => usePot('mp'));
function usePot(k) { const it = (ME.inv || []).find(i => i.k === k); if (it) tx({ t: 'use', id: it.id }); else addChat('', 'Sem poção!', '#f88'); }
let skAt = 0;
function skill() { tx({ t: 'skill', tg: scene ? scene.target : 0 }); skAt = performance.now(); }
const keys = {};
addEventListener('keydown', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  keys[e.key.toLowerCase()] = true;
  const k = e.key.toLowerCase();
  if (k === 'q') skill(); if (k === '1') usePot('hp'); if (k === '2') usePot('mp'); if (k === 'i') $('tInv').onclick(); if (k === 'enter') $('tChat').onclick(); if (k === ' ') { IN.atk = true; e.preventDefault(); }
});
addEventListener('keyup', e => { const k = e.key.toLowerCase(); keys[k] = false; if (k === ' ') IN.atk = false; });
addEventListener('contextmenu', e => e.preventDefault());

/* ───── texturas pixel art ───── */
function tex(s, key, w, h, draw) { if (s.textures.exists(key)) return; const t = s.textures.createCanvas(key, w, h), c = t.getContext(); c.imageSmoothingEnabled = false; draw(c); t.refresh(); }
const R = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
function sprRand(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
function makeTextures(s) {
  // tiles (desenhados em grade 16x16 e escalados 2x)
  const tile = (key, base, dots, seed, extra) => tex(s, key, 32, 32, c => { c.scale(2, 2); R(c, base, 0, 0, 16, 16); const r = sprRand(seed); for (const [col, n] of dots) for (let i = 0; i < n; i++) R(c, col, Math.floor(r() * 15), Math.floor(r() * 15), 1 + (r() > .7 ? 1 : 0), 1); if (extra) extra(c); });
  for (let i = 0; i < 3; i++) tile('g' + i, '#3f9e2f', [['#4fb53a', 14], ['#2f8a26', 10], ['#69cf4c', 4]], 11 + i * 7);
  tile('dirt', '#d9b57a', [['#c9a266', 16], ['#e6c58d', 12], ['#b98d54', 6]], 5, c => { R(c, '#c9a266', 0, 7, 16, 1); R(c, '#c9a266', 7, 0, 1, 7); R(c, '#c9a266', 11, 8, 1, 8); });
  tile('stone', '#c8c2b0', [['#d8d2c0', 8], ['#b4ae9c', 8]], 9, c => { R(c, '#a29c8a', 0, 0, 16, 1); R(c, '#a29c8a', 0, 0, 1, 16); R(c, '#a29c8a', 0, 8, 16, 1); R(c, '#a29c8a', 8, 0, 1, 8); R(c, '#a29c8a', 4, 8, 1, 8); R(c, '#a29c8a', 12, 8, 1, 8); });
  tile('water', '#2a6fd0', [['#4a8ae8', 10], ['#1f58b0', 8]], 3, c => { R(c, '#7ab4ff', 2, 4, 4, 1); R(c, '#7ab4ff', 9, 11, 4, 1); });
  tile('bridge', '#8a5a2b', [['#7a4c22', 6]], 4, c => { for (let x = 0; x < 16; x += 4) R(c, '#5e3a18', x, 0, 1, 16); R(c, '#a8733a', 0, 0, 16, 1); });
  const pine = (key, c1, c2, c3) => tex(s, key, 28, 36, c => {
    R(c, '#6b3b2a', 12, 26, 5, 10); R(c, '#4e2a1e', 15, 26, 2, 10);
    const tri = (cx, y, w, h, col) => { c.fillStyle = col; c.beginPath(); c.moveTo(cx, y); c.lineTo(cx + w / 2, y + h); c.lineTo(cx - w / 2, y + h); c.fill(); };
    tri(14, 12, 26, 18, c1); tri(14, 6, 22, 16, c2); tri(14, 0, 16, 14, c3);
    R(c, c3, 9, 20, 2, 1); R(c, c3, 17, 14, 2, 1); R(c, '#1b4a22', 8, 28, 2, 1);
  });
  pine('tree0', '#2f8a3a', '#3fb04a', '#6ad46a'); pine('tree1', '#2a4fa8', '#3a78d0', '#5ab4f0');
  tex(s, 'rock', 14, 10, c => { R(c, '#8a8a92', 1, 3, 12, 7); R(c, '#aaaab2', 2, 1, 9, 4); R(c, '#d0d0d8', 3, 1, 4, 2); R(c, '#6a6a72', 1, 9, 12, 1); });
  tex(s, 'fl0', 5, 5, c => { R(c, '#4aa8ff', 1, 0, 3, 3); R(c, '#fff', 2, 1, 1, 1); R(c, '#2a7a2a', 2, 3, 1, 2); });
  tex(s, 'fl1', 5, 5, c => { R(c, '#ff8ad8', 1, 0, 3, 3); R(c, '#fff', 2, 1, 1, 1); R(c, '#2a7a2a', 2, 3, 1, 2); });
  // personagens 16x24
  const base = (c, o) => {
    R(c, o.pants, 5, 16, 2, 5); R(c, o.pants, 9, 16, 2, 5); R(c, '#5a3a22', 4, 21, 3, 3); R(c, '#5a3a22', 9, 21, 3, 3);
    R(c, o.skin || '#f0c8a0', 2, 10, 2, 5); R(c, o.skin || '#f0c8a0', 12, 10, 2, 5);
    R(c, o.top, 4, 9, 8, 8); R(c, o.top, 2, 9, 2, 2); R(c, o.top, 12, 9, 2, 2); R(c, '#3a2a1a', 4, 15, 8, 1);
    R(c, o.skin || '#f0c8a0', 4, 2, 8, 7); R(c, '#2a5fd0', 6, 5, 1, 2); R(c, '#2a5fd0', 9, 5, 1, 2);
  };
  tex(s, 'DK', 16, 24, c => { R(c, '#dce8ff', 1, 9, 2, 13); R(c, '#9ab8e8', 1, 20, 2, 2); base(c, { pants: '#5a3a4a', top: '#d33a3a' }); R(c, '#e8f0ff', 3, 1, 10, 3); R(c, '#e8f0ff', 4, 0, 2, 1); R(c, '#e8f0ff', 8, 0, 2, 1); R(c, '#e8f0ff', 11, 0, 2, 1); R(c, '#e8f0ff', 3, 3, 1, 3); R(c, '#c8d8f0', 13, 1, 2, 14); R(c, '#fff', 13, 1, 1, 12); R(c, '#8a5a2b', 11, 15, 5, 1); R(c, '#6b3b2a', 13, 16, 2, 3); });
  tex(s, 'DW', 16, 24, c => { base(c, { pants: '#4a2a7a', top: '#6a3ab0' }); R(c, '#6a3ab0', 4, 15, 8, 6); R(c, '#4a2a7a', 3, 3, 10, 1); R(c, '#5a2a9a', 4, 1, 8, 3); R(c, '#5a2a9a', 6, 0, 4, 1); R(c, '#ffd84a', 7, 2, 2, 1); R(c, '#8a5a2b', 14, 4, 1, 19); R(c, '#6ff', 13, 1, 3, 3); R(c, '#fff', 14, 2, 1, 1); });
  tex(s, 'FE', 16, 24, c => { base(c, { pants: '#3a6a5a', top: '#3a9a5a' }); R(c, '#b4552d', 3, 1, 10, 3); R(c, '#b4552d', 2, 3, 2, 7); R(c, '#b4552d', 12, 3, 1, 2); R(c, '#6b3b2a', 0, 6, 1, 12); R(c, '#6b3b2a', 1, 5, 1, 1); R(c, '#6b3b2a', 1, 18, 1, 1); R(c, '#ddd', 1, 6, 1, 12); });
  tex(s, 'SU', 16, 24, c => { base(c, { pants: '#3a2a5a', top: '#a83aa8' }); R(c, '#e84a8a', 3, 1, 10, 3); R(c, '#e84a8a', 2, 3, 2, 6); R(c, '#e84a8a', 12, 3, 2, 3); R(c, '#ffd84a', 13, 11, 3, 4); R(c, '#8a5a2b', 14, 12, 1, 2); R(c, '#c9f', 0, 8, 2, 2); });
  // monstros
  tex(s, 'slime', 16, 12, c => { R(c, '#4ad07a', 2, 4, 12, 8); R(c, '#4ad07a', 3, 2, 10, 2); R(c, '#4ad07a', 5, 1, 6, 1); R(c, '#2a9a55', 2, 11, 12, 1); R(c, '#9af0b0', 4, 3, 3, 1); R(c, '#123', 5, 6, 2, 2); R(c, '#123', 9, 6, 2, 2); });
  tex(s, 'goblin', 16, 20, c => { R(c, '#6aa84a', 1, 4, 2, 2); R(c, '#6aa84a', 13, 4, 2, 2); R(c, '#6aa84a', 4, 2, 8, 7); R(c, '#ff0', 5, 5, 2, 1); R(c, '#ff0', 9, 5, 2, 1); R(c, '#2a4a1a', 6, 7, 4, 1); R(c, '#8a5a2b', 4, 9, 8, 7); R(c, '#6aa84a', 2, 10, 2, 4); R(c, '#4a3a2a', 5, 16, 2, 4); R(c, '#4a3a2a', 9, 16, 2, 4); R(c, '#6b3b2a', 13, 7, 2, 9); R(c, '#4e2a1e', 12, 4, 4, 3); });
  tex(s, 'wolf', 24, 14, c => { R(c, '#7a7a88', 4, 4, 14, 6); R(c, '#9a9aa8', 5, 4, 12, 2); R(c, '#7a7a88', 17, 2, 6, 6); R(c, '#5a5a68', 18, 0, 2, 2); R(c, '#5a5a68', 21, 0, 2, 2); R(c, '#f33', 21, 4, 1, 1); R(c, '#333', 22, 5, 2, 2); R(c, '#5a5a68', 5, 10, 2, 4); R(c, '#5a5a68', 9, 10, 2, 4); R(c, '#5a5a68', 14, 10, 2, 4); R(c, '#5a5a68', 17, 10, 2, 4); R(c, '#6a6a78', 1, 3, 4, 2); });
  tex(s, 'skeleton', 16, 24, c => { const b = '#e8e4d0'; R(c, b, 4, 2, 8, 7); R(c, '#222', 5, 5, 2, 2); R(c, '#222', 9, 5, 2, 2); R(c, '#222', 7, 7, 2, 1); R(c, b, 5, 9, 6, 1); R(c, b, 5, 10, 6, 6); R(c, '#222', 5, 12, 6, 1); R(c, b, 3, 10, 1, 5); R(c, b, 12, 10, 1, 5); R(c, b, 5, 16, 2, 7); R(c, b, 9, 16, 2, 7); R(c, '#99a', 14, 5, 1, 13); R(c, '#765', 13, 16, 3, 1); });
  tex(s, 'golem', 28, 32, c => { R(c, '#7a7468', 4, 10, 20, 16); R(c, '#9a9488', 5, 11, 18, 3); R(c, '#7a7468', 9, 2, 10, 9); R(c, '#9a9488', 10, 2, 8, 2); R(c, '#ff6a00', 11, 5, 2, 2); R(c, '#ff6a00', 15, 5, 2, 2); R(c, '#4a463e', 12, 9, 4, 1); R(c, '#6a645a', 0, 10, 4, 14); R(c, '#6a645a', 24, 10, 4, 14); R(c, '#5a554b', 0, 22, 4, 3); R(c, '#5a554b', 24, 22, 4, 3); R(c, '#6a645a', 7, 26, 5, 6); R(c, '#6a645a', 16, 26, 5, 6); R(c, '#4a8a3a', 6, 12, 3, 2); R(c, '#4a8a3a', 18, 20, 4, 2); R(c, '#4a463e', 14, 14, 1, 8); R(c, '#4a463e', 10, 18, 4, 1); });
}

/* ───── cena ───── */
const MONT = { slime: { n: 'Slime', s: 2 }, goblin: { n: 'Goblin', s: 2 }, wolf: { n: 'Lobo', s: 2 }, skeleton: { n: 'Esqueleto', s: 2 }, golem: { n: 'GOLEM (BOSS)', s: 3.2 } };
const PCOL = { DK: 0xffffff, DW: 0xcc88ff, FE: 0x88ff99, SU: 0xff88cc };

class GameScene extends Phaser.Scene {
  create() {
    scene = this; this.ready = false; this.ents = new Map(); this.target = 0; this.me = 0; this.lastIn = ''; this.lastInT = 0; this.nextAtk = 0;
    makeTextures(this);
    const T = wel.tile, W = wel.w, H = wel.h, M = wel.map, town = wel.town;
    const rt = this.add.renderTexture(0, 0, W * T, H * T).setDepth(-10000); const r = sprRand(77);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rt.draw('g' + Math.floor(r() * 3), x * T, y * T);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = M[y][x]; const k = { ',': 'dirt', S: 'stone', '~': 'water', b: 'bridge' }[c]; if (k) rt.draw(k, x * T, y * T); }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = M[y][x];
      if (c === 'T') this.add.image(x * T + 16, y * T + 30, 'tree' + (((x * 7 + y * 13) % 5) < 2 ? 1 : 0)).setOrigin(0.5, 1).setScale(2).setDepth(y * T + 30);
      else if (c === 'R') this.add.image(x * T + 16, y * T + 28, 'rock').setOrigin(0.5, 1).setScale(2).setDepth(y * T + 28);
      else if (c === '.' && r() < 0.05) this.add.image(x * T + r() * 28, y * T + r() * 28, 'fl' + (r() > .5 ? 1 : 0)).setScale(2).setDepth(-9000);
    }
    this.add.text((town.x0 + town.x1 + 1) * T / 2, town.y0 * T + 10, 'LORENCIA', { fontFamily: 'monospace', fontSize: '22px', color: '#ffe9a0', stroke: '#000', strokeThickness: 5, resolution: 2 }).setOrigin(0.5).setDepth(-8000);
    this.cameras.main.setBounds(0, 0, W * T, H * T); this.cameras.main.roundPixels = true;
    this.tgtRing = this.add.ellipse(0, 0, 40, 18).setStrokeStyle(2, 0xffff00).setDepth(99999).setVisible(false);
    this.fit(); this.scale.on('resize', () => this.fit());
    this.input.on('pointerdown', (p, over) => { if (!over.length) this.target = 0; });
    this.ready = true;
  }
  fit() { const z = Math.max(1.2, Math.min(this.scale.width, this.scale.height) / 300); this.cameras.main.setZoom(z); }
  mk(key, tex, x, y, scale, name, col, kind) {
    const c = this.add.container(x, y); const sh = this.add.ellipse(0, 0, 22 * (scale / 2), 8 * (scale / 2), 0, 0.35);
    const sp = this.add.image(0, 3, tex).setOrigin(0.5, 1).setScale(scale); const h = sp.height * scale;
    const nm = this.add.text(0, -h - 10, name, { fontFamily: 'monospace', fontSize: '10px', color: col, stroke: '#000', strokeThickness: 3, resolution: 2 }).setOrigin(0.5, 1);
    const bar = this.add.graphics(); c.add([sh, sp, bar, nm]);
    const e = { c, sp, nm, bar, tx: x, ty: y, hp: -1, mh: 1, h, kind, key, scale, mv: false };
    if (kind === 'm') { sp.setInteractive(); sp.on('pointerdown', () => { this.target = +key.slice(1); }); }
    return e;
  }
  drawBar(e, hp, mh) {
    if (e.hp === hp && e.mh === mh) return; e.hp = hp; e.mh = mh; const g = e.bar, w = 34, y = -e.h - 7; g.clear();
    g.fillStyle(0, 0.75).fillRect(-w / 2 - 1, y - 1, w + 2, 5); g.fillStyle(e.kind === 'm' ? 0xdd3333 : 0x44cc44).fillRect(-w / 2, y, w * Math.max(0, hp) / mh, 3);
  }
  applySnap(s) {
    this.me = s.me; const seen = new Set();
    for (const p of s.p) {
      const key = 'p' + p.i; seen.add(key); let e = this.ents.get(key);
      if (!e) { e = this.mk(key, p.c, p.x, p.y, 2, p.n, p.i === s.me ? '#ffe680' : '#ffffff', 'p'); e.c.setPosition(p.x, p.y); this.ents.set(key, e); }
      e.mv = Math.hypot(p.x - e.tx, p.y - e.ty) > 0.5; if (p.x !== e.tx) e.dir = p.x > e.tx ? 1 : -1; e.tx = p.x; e.ty = p.y; e.c.setAlpha(p.d ? 0.35 : 1);
      this.drawBar(e, p.hp, p.mh);
      if (p.i === s.me) { bar('bhp', p.hp, p.mh, `${p.hp}/${p.mh}`); bar('bmp', p.mp, p.mm, `${p.mp}/${p.mm}`); this.meDead = !!p.d; $('msg').style.display = p.d ? 'block' : 'none'; $('msg').textContent = 'Você morreu — renascendo em Lorencia...'; this.cameras.main.startFollow(e.c, true, 0.2, 0.2); }
    }
    let boss = null;
    for (const m of s.m) {
      const key = 'm' + m.i; seen.add(key); let e = this.ents.get(key); const d = MONT[m.k];
      if (!e) { e = this.mk(key, m.k, m.x, m.y, d.s, d.n, m.k === 'golem' ? '#ff9ad8' : '#ffb0b0', 'm'); e.c.setPosition(m.x, m.y); this.ents.set(key, e); }
      e.mv = Math.hypot(m.x - e.tx, m.y - e.ty) > 0.5; if (m.x !== e.tx) e.dir = m.x > e.tx ? 1 : -1; e.tx = m.x; e.ty = m.y; this.drawBar(e, m.hp, m.mh);
      if (m.k === 'golem') boss = m;
    }
    for (const [k, e] of this.ents) if (!seen.has(k)) { e.c.destroy(); this.ents.delete(k); if (k === 'm' + this.target) this.target = 0; }
    const bx = $('boss'); if (boss) { bx.style.display = 'block'; $('bossn').textContent = 'GOLEM ANCIÃO'; $('bossb').style.width = (boss.hp / boss.mh * 100) + '%'; } else bx.style.display = 'none';
    for (const e of s.e) this.fx(e);
  }
  fx(e) {
    if (e.k === 'dmg') {
      const col = e.to === 'p' ? '#ff5050' : (e.c ? '#ffd23a' : '#ffffff');
      const t = this.add.text(e.x + Phaser.Math.Between(-8, 8), e.y, String(e.v), { fontFamily: 'monospace', fontSize: e.c ? '18px' : '13px', fontStyle: 'bold', color: col, stroke: '#000', strokeThickness: 3, resolution: 2 }).setOrigin(0.5).setDepth(999999);
      this.tweens.add({ targets: t, y: e.y - 34, alpha: 0, duration: 800, onComplete: () => t.destroy() }); beep(e.to === 'p' ? 140 : 320, 0.07, 'square');
    } else if (e.k === 'atk') {
      const ent = this.ents.get('p' + e.id); if (ent) { const dir = Math.sign(e.tx - e.x) || 1; this.tweens.add({ targets: ent.sp, x: 6 * dir, duration: 70, yoyo: true }); }
      if (e.c === 'DK') { const g = this.add.arc(e.x + Math.sign(e.tx - e.x) * 22, e.y - 16, 22, 200, 340, false, 0xffffff, 0.8).setDepth(999998); this.tweens.add({ targets: g, alpha: 0, scale: 1.4, duration: 180, onComplete: () => g.destroy() }); }
      else { const col = { DW: 0xff8a3a, FE: 0xeedd88, SU: 0xc060ff }[e.c]; const b = this.add.circle(e.x, e.y - 16, 5, col).setDepth(999998); this.tweens.add({ targets: b, x: e.tx, y: e.ty - 14, duration: 160, onComplete: () => b.destroy() }); }
      beep(e.c === 'DK' ? 200 : 520, 0.08, 'sawtooth');
    } else if (e.k === 'skill') {
      const col = { DK: 0xffe080, DW: 0xff5a1a, FE: 0x80ff80, SU: 0xb040ff }[e.c];
      const c = this.add.circle(e.x, e.y, e.r, col, 0.35).setStrokeStyle(3, col).setDepth(999997); c.setScale(0.2);
      this.tweens.add({ targets: c, scale: 1, alpha: 0, duration: 420, onComplete: () => c.destroy() }); beep(110, 0.25, 'sawtooth', 0.06);
    } else if (e.k === 'tele') {
      const c = this.add.circle(e.x, e.y, e.r, 0xff0000, 0.25).setStrokeStyle(2, 0xff4040).setDepth(-5000);
      this.tweens.add({ targets: c, alpha: 0.7, duration: e.ms, onComplete: () => { this.cameras.main.shake(200, 0.01); c.destroy(); } }); beep(70, 0.5, 'sawtooth', 0.08);
    } else if (e.k === 'lvl') {
      const t = this.add.text(e.x, e.y - 50, 'LEVEL UP!', { fontFamily: 'monospace', fontSize: '20px', fontStyle: 'bold', color: '#ffe040', stroke: '#000', strokeThickness: 4, resolution: 2 }).setOrigin(0.5).setDepth(999999);
      this.tweens.add({ targets: t, y: e.y - 100, alpha: 0, duration: 1500, onComplete: () => t.destroy() }); beep(660, 0.3, 'triangle', 0.07);
    } else if (e.k === 'boss') addChat('', `${e.n} derrotou o Golem Ancião!`, '#ff9ad8');
  }
  update(time) {
    if (!this.ready) return;
    for (const e of this.ents.values()) {
      e.c.x += (e.tx - e.c.x) * 0.3; e.c.y += (e.ty - e.c.y) * 0.3; e.c.setDepth(e.c.y);
      if (e.dir) e.sp.setFlipX(e.dir < 0);
      e.sp.y = 3 + (e.mv ? Math.abs(Math.sin(time / 90)) * -3 : 0);
    }
    const te = this.target ? this.ents.get('m' + this.target) : null;
    this.tgtRing.setVisible(!!te); if (te) this.tgtRing.setPosition(te.c.x, te.c.y);
    // entrada
    let x = IN.jx, y = IN.jy;
    if (keys.a || keys.arrowleft) x -= 1; if (keys.d || keys.arrowright) x += 1; if (keys.w || keys.arrowup) y -= 1; if (keys.s || keys.arrowdown) y += 1;
    x = Math.round(Math.max(-1, Math.min(1, x)) * 10) / 10; y = Math.round(Math.max(-1, Math.min(1, y)) * 10) / 10;
    const sig = x + ',' + y;
    if (sig !== this.lastIn || time - this.lastInT > 300) { this.lastIn = sig; this.lastInT = time; tx({ t: 'in', x, y }); }
    if (IN.atk && time > this.nextAtk) { this.nextAtk = time + 250; tx({ t: 'atk', tg: this.target }); }
    // recarga skill
    const cd = ME.skcd || 3000, left = cd - (performance.now() - skAt), el = $('skcd');
    if (left > 0) { el.style.display = 'block'; el.style.height = (left / cd * 100) + '%'; el.style.top = 'auto'; el.style.bottom = '0'; } else el.style.display = 'none';
  }
}
function startGame() {
  game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', backgroundColor: '#10240f', pixelArt: true, scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' }, scene: GameScene, input: { activePointers: 4 } });
}
