'use strict';
/**
 * MU 2D Online — servidor autoritativo (Node.js + ws + PostgreSQL).
 * O servidor decide movimento, combate, XP, loot e inventário.
 * O cliente só envia intenções (mover, atacar, usar item...).
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3000;
const MAX_LEVEL = +process.env.MAX_LEVEL || 1000;
const XP_RATE = +process.env.XP_RATE || 1;
const DROP_RATE = +process.env.DROP_RATE || 1;
const TILE = 32, W = 64, H = 48;
const TOWN = { x0: 26, y0: 19, x1: 37, y1: 28 };
const SPEED = 150;
const INV_SIZE = 24;
const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ───────────────────────── Mapa (Lorencia) ───────────────────────── */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function genMap() {
  const r = rng(20260), g = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      let c = '.';
      const edge = x < 2 || y < 2 || x >= W - 2 || y >= H - 2;
      const inTown = x >= TOWN.x0 && x <= TOWN.x1 && y >= TOWN.y0 && y <= TOWN.y1;
      const path = (y >= 22 && y <= 24) || (x >= 30 && x <= 32);
      const river = x === 46 || x === 47;
      const v = r();
      if (edge) c = 'T';
      else if (river) c = (y >= 22 && y <= 24) ? 'b' : '~';
      else if (inTown) c = 'S';
      else if (path) c = ',';
      else if (v < 0.07) c = 'T';
      else if (v < 0.09) c = 'R';
      row += c;
    }
    g.push(row);
  }
  return g;
}
const MAP = genMap();
const solidCh = c => c === 'T' || c === 'R' || c === '~';
const tileAt = (px, py) => { const x = Math.floor(px / TILE), y = Math.floor(py / TILE); return (x < 0 || y < 0 || x >= W || y >= H) ? 'T' : MAP[y][x]; };
const collides = (x, y, r) => solidCh(tileAt(x - r, y - r)) || solidCh(tileAt(x + r, y - r)) || solidCh(tileAt(x - r, y + r)) || solidCh(tileAt(x + r, y + r));
const inTownPx = (x, y) => x >= TOWN.x0 * TILE && x < (TOWN.x1 + 1) * TILE && y >= TOWN.y0 * TILE && y < (TOWN.y1 + 1) * TILE;
const TOWN_C = { x: (TOWN.x0 + TOWN.x1 + 1) * TILE / 2, y: (TOWN.y0 + TOWN.y1 + 1) * TILE / 2 };

/* ───────────────────────── Persistência ───────────────────────── */
let pool = null;
const FILE = path.join(__dirname, '..', 'data', 'accounts.json');
let fileDb = {};
async function initDb() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false } });
    await pool.query(`CREATE TABLE IF NOT EXISTS accounts(
      username TEXT PRIMARY KEY, pass_hash TEXT NOT NULL, data JSONB NOT NULL,
      banned BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    log('PostgreSQL conectado e migrado.');
  } else {
    log('AVISO: DATABASE_URL ausente — usando arquivo local (NÃO use em produção).');
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fileDb = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { fileDb = {}; }
  }
}
const flushFile = () => { try { fs.writeFileSync(FILE, JSON.stringify(fileDb)); } catch (e) { log('erro salvando arquivo', e.message); } };
async function getAcc(u) {
  if (pool) { const r = await pool.query('SELECT username,pass_hash,data,banned FROM accounts WHERE username=$1', [u.toLowerCase()]); return r.rows[0] ? { username: r.rows[0].username, hash: r.rows[0].pass_hash, data: r.rows[0].data, banned: r.rows[0].banned } : null; }
  const a = fileDb[u.toLowerCase()]; return a ? { username: u.toLowerCase(), hash: a.hash, data: a.data, banned: !!a.banned } : null;
}
async function createAcc(u, hash, data) {
  if (pool) await pool.query('INSERT INTO accounts(username,pass_hash,data) VALUES($1,$2,$3)', [u.toLowerCase(), hash, data]);
  else { fileDb[u.toLowerCase()] = { hash, data }; flushFile(); }
}
async function saveData(u, data) {
  try {
    if (pool) await pool.query('UPDATE accounts SET data=$2, updated_at=now() WHERE username=$1', [u, data]);
    else if (fileDb[u]) { fileDb[u].data = data; flushFile(); }
  } catch (e) { log('erro ao salvar', u, e.message); }
}
function hashPw(pw) { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); }
function checkPw(pw, h) { const [s, k] = h.split(':'); const b = crypto.scryptSync(pw, s, 64); return crypto.timingSafeEqual(b, Buffer.from(k, 'hex')); }

/* ───────────────────────── Dados do jogo ───────────────────────── */
const CLS = {
  DK: { n: 'Dark Knight', hp: 120, mp: 40, atk: 14, def: 5, ghp: 16, gmp: 3, gatk: 3.2, gdef: 1.2, range: 56, wp: 'Espada', sk: { n: 'Corte Giratório', mult: 1.9, cost: 15, cd: 3000, r: 105, self: true } },
  DW: { n: 'Dark Wizard', hp: 80, mp: 100, atk: 18, def: 2, ghp: 9, gmp: 9, gatk: 3.8, gdef: 0.6, range: 200, wp: 'Cajado', sk: { n: 'Bola de Fogo', mult: 2.6, cost: 18, cd: 2500, r: 80, self: false } },
  FE: { n: 'Fairy Elf', hp: 90, mp: 70, atk: 15, def: 3, ghp: 11, gmp: 6, gatk: 3.2, gdef: 0.8, range: 220, wp: 'Arco', sk: { n: 'Chuva de Flechas', mult: 1.7, cost: 16, cd: 3000, r: 110, self: false } },
  SU: { n: 'Summoner', hp: 85, mp: 90, atk: 16, def: 2, ghp: 10, gmp: 8, gatk: 3.4, gdef: 0.7, range: 180, wp: 'Grimório', sk: { n: 'Maldição Sombria', mult: 2.2, cost: 17, cd: 2800, r: 95, self: false } },
};
const MON = {
  slime: { n: 'Slime', hp: 40, atk: 6, def: 0, xp: 12, spd: 55, lvl: 1, aggro: 140, range: 28, zen: [3, 9] },
  goblin: { n: 'Goblin', hp: 95, atk: 12, def: 2, xp: 30, spd: 75, lvl: 3, aggro: 170, range: 30, zen: [8, 20] },
  wolf: { n: 'Lobo Sombrio', hp: 160, atk: 19, def: 4, xp: 58, spd: 115, lvl: 6, aggro: 200, range: 32, zen: [15, 35] },
  skeleton: { n: 'Esqueleto', hp: 280, atk: 30, def: 8, xp: 110, spd: 85, lvl: 10, aggro: 200, range: 34, zen: [30, 70] },
  golem: { n: 'Golem Ancião (BOSS)', hp: 3200, atk: 48, def: 14, xp: 1800, spd: 65, lvl: 20, aggro: 280, range: 54, zen: [800, 1500], boss: true },
};
const SPAWNS = [['slime', 22, 380, 800], ['goblin', 18, 700, 1100], ['wolf', 14, 1000, 1450], ['skeleton', 12, 1300, 1950]];
const RAR = [{ n: 'Comum', m: 1 }, { n: 'Rara', m: 1.5 }, { n: 'Épica', m: 2.3 }, { n: 'Lendária', m: 3.6 }];
const SLOTS = { weapon: 'Arma', armor: 'Armadura', helm: 'Elmo', boots: 'Botas' };
const SLOT_NAME = { armor: 'Armadura', helm: 'Elmo', boots: 'Botas' };
const uid = () => crypto.randomBytes(6).toString('hex');
const xpNeed = l => Math.floor(40 * Math.pow(l, 1.7));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function genItem(mlvl, cls, boss) {
  const slotKeys = Object.keys(SLOTS);
  const slot = slotKeys[rnd(0, 3)];
  const v = Math.random() * 100;
  const rar = boss ? (Math.random() < 0.3 ? 3 : 2) : v < 1 ? 3 : v < 8 ? 2 : v < 30 ? 1 : 0;
  const mult = RAR[rar].m, j = () => 0.85 + Math.random() * 0.3;
  const it = { id: uid(), k: 'eq', slot, r: rar, lvl: Math.max(1, mlvl - 2), atk: 0, def: 0, cls: null };
  if (slot === 'weapon') {
    const keys = Object.keys(CLS);
    it.cls = Math.random() < 0.7 ? cls : keys[rnd(0, 3)];
    it.atk = Math.round((3 + mlvl * 1.6) * mult * j());
    it.n = `${CLS[it.cls].wp} ${RAR[rar].n}`;
  } else {
    it.def = Math.round((2 + mlvl * 0.9) * mult * j() * (slot === 'armor' ? 1 : slot === 'helm' ? 0.6 : 0.45));
    it.n = `${SLOT_NAME[slot]} ${RAR[rar].n}`;
  }
  return it;
}
const potion = (k, q) => ({ id: uid(), k, n: k === 'hp' ? 'Poção de Vida' : 'Poção de Mana', q });

/* ───────────────────────── Estado do mundo ───────────────────────── */
const players = new Map();
let NID = 1, events = [];
const ev = o => events.push(o);
const monsters = [];
let MID = 1;

function freeNear(x, y) {
  for (let i = 0; i < 200; i++) {
    const nx = x + (Math.random() - 0.5) * 200, ny = y + (Math.random() - 0.5) * 200;
    if (!collides(nx, ny, 16) && !inTownPx(nx, ny)) return { x: nx, y: ny };
  }
  return { x, y };
}
function mkMonster(type, x, y) {
  const t = MON[type];
  const m = { id: MID++, type, x, y, hx: x, hy: y, hp: t.hp, mh: t.hp, atk: t.atk, def: t.def, dead: false, respawnAt: 0, target: null, dmg: {}, nextAtk: 0, wanderAt: 0, wx: 0, wy: 0, slamAt: 0, nextSlam: Date.now() + 6000 };
  monsters.push(m);
}
function spawnAll() {
  for (const [type, n, d0, d1] of SPAWNS) {
    let c = 0, tries = 0;
    while (c < n && tries++ < 5000) {
      const x = Math.random() * W * TILE, y = Math.random() * H * TILE;
      const d = Math.hypot(x - TOWN_C.x, y - TOWN_C.y);
      if (d < d0 || d > d1 || collides(x, y, 16) || inTownPx(x, y)) continue;
      mkMonster(type, x, y); c++;
    }
  }
  const b = freeNear(57 * TILE, 10 * TILE);
  mkMonster('golem', b.x, b.y);
  log(`Mundo: ${monsters.length} monstros.`);
}

/* ───────────────────────── Jogadores ───────────────────────── */
function recalc(p) {
  const c = CLS[p.cls], l = p.lvl - 1;
  p.maxhp = Math.round(c.hp + l * c.ghp); p.maxmp = Math.round(c.mp + l * c.gmp);
  p.atk = Math.round(c.atk + l * c.gatk); p.def = Math.round(c.def + l * c.gdef);
  for (const s in p.eq) { p.atk += p.eq[s].atk || 0; p.def += p.eq[s].def || 0; }
}
function newData(name, cls) {
  return { name, cls, lvl: 1, xp: 0, zen: 100, hp: 0, mp: 0, x: TOWN_C.x, y: TOWN_C.y + 40, inv: [potion('hp', 5), potion('mp', 3)], eq: {} };
}
function snapshot(p) {
  return { name: p.name, cls: p.cls, lvl: p.lvl, xp: p.xp, zen: p.zen, hp: p.hp, mp: p.mp, x: p.dead ? TOWN_C.x : p.x, y: p.dead ? TOWN_C.y : p.y, inv: p.inv, eq: p.eq };
}
const save = p => saveData(p.user, snapshot(p));
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const say = (p, m) => send(p.ws, { t: 'log', m });
function sendMe(p) {
  p.dirty = false;
  send(p.ws, { t: 'me', lvl: p.lvl, xp: p.xp, xpn: xpNeed(p.lvl), zen: p.zen, atk: p.atk, def: p.def, inv: p.inv, eq: p.eq, cls: p.cls, sk: CLS[p.cls].sk.n, skcd: CLS[p.cls].sk.cd, skcost: CLS[p.cls].sk.cost });
}
function addItem(p, it) {
  if (it.q) { const s = p.inv.find(i => i.k === it.k); if (s) { s.q += it.q; p.dirty = true; return true; } }
  if (p.inv.length >= INV_SIZE) { say(p, 'Inventário cheio! Item perdido: ' + it.n); return false; }
  p.inv.push(it); p.dirty = true; return true;
}
function addXp(p, xp) {
  p.xp += xp;
  while (p.lvl < MAX_LEVEL && p.xp >= xpNeed(p.lvl)) {
    p.xp -= xpNeed(p.lvl); p.lvl++; recalc(p); p.hp = p.maxhp; p.mp = p.maxmp;
    say(p, `LEVEL UP! Nível ${p.lvl}`); ev({ k: 'lvl', x: p.x, y: p.y });
  }
  if (p.lvl >= MAX_LEVEL) p.xp = 0;
  p.dirty = true;
}
function respawn(p) {
  p.dead = false; p.x = TOWN_C.x + rnd(-60, 60); p.y = TOWN_C.y + rnd(-40, 40);
  p.hp = Math.ceil(p.maxhp * 0.5); p.mp = Math.ceil(p.maxmp * 0.5); p.dirty = true;
  say(p, 'Você renasceu em Lorencia.');
}
function hurtPlayer(p, dmg, x, y) {
  if (p.dead || inTownPx(p.x, p.y)) return;
  if (Math.random() < 0.05) { ev({ k: 'dmg', x: p.x, y: p.y - 30, v: 'miss', to: 'p' }); return; }
  const d = Math.max(1, Math.round(dmg * (0.85 + Math.random() * 0.3) - p.def * 0.5));
  p.hp -= d; ev({ k: 'dmg', x: p.x, y: p.y - 30, v: d, to: 'p' });
  if (p.hp <= 0) { p.hp = 0; p.dead = true; p.respawnAt = Date.now() + 3500; p.ix = p.iy = 0; say(p, 'Você morreu...'); }
}

/* ───────────────────────── Combate ───────────────────────── */
const calc = (a, d) => Math.max(1, Math.round(a * (0.85 + Math.random() * 0.3) - d * 0.5));
function pickTarget(p, range, pref) {
  let best = null, bd = 1e9;
  for (const m of monsters) {
    if (m.dead) continue;
    const d = Math.hypot(m.x - p.x, m.y - p.y);
    if (d > range) continue;
    if (m.id === pref) return m;
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}
function hit(p, m, mult) {
  const crit = Math.random() < 0.1;
  const d = calc(p.atk * mult * (crit ? 1.8 : 1), m.def);
  m.hp -= d; m.dmg[p.id] = (m.dmg[p.id] || 0) + d; if (!m.target) m.target = p.id;
  ev({ k: 'dmg', x: m.x, y: m.y - 30, v: d, c: crit ? 1 : 0, to: 'm' });
  if (m.hp <= 0) killMonster(m);
}
function killMonster(m) {
  m.dead = true; m.hp = 0; m.target = null;
  const t = MON[m.type]; m.respawnAt = Date.now() + (t.boss ? 60000 : 10000);
  let total = 0, top = null, topD = 0;
  for (const id in m.dmg) { total += m.dmg[id]; if (m.dmg[id] > topD && players.has(+id)) { topD = m.dmg[id]; top = players.get(+id); } }
  for (const id in m.dmg) {
    const p = players.get(+id); if (!p || p.gone) continue;
    const share = m.dmg[id] / total, xp = Math.max(1, Math.floor(t.xp * XP_RATE * share));
    const zen = Math.floor(rnd(t.zen[0], t.zen[1]) * share);
    p.zen += zen; addXp(p, xp);
    say(p, `${t.n} derrotado: +${xp} XP, +${zen} Zen`);
  }
  if (top) {
    if (Math.random() < 0.35 * DROP_RATE) addItem(top, potion(Math.random() < 0.6 ? 'hp' : 'mp', rnd(1, 3)));
    if (t.boss || Math.random() < 0.12 * DROP_RATE) { const it = genItem(t.lvl, top.cls, t.boss); if (addItem(top, it)) say(top, `Drop: ${it.n}!`); }
    if (t.boss) ev({ k: 'boss', n: top.name });
  }
  m.dmg = {};
}
function doAttack(p, tg) {
  const now = Date.now(); if (p.dead || now < p.nextAtk) return;
  const c = CLS[p.cls]; const m = pickTarget(p, c.range, tg); if (!m) return;
  p.nextAtk = now + 650;
  ev({ k: 'atk', c: p.cls, x: p.x, y: p.y, tx: m.x, ty: m.y, id: p.id });
  hit(p, m, 1);
}
function doSkill(p, tg) {
  const now = Date.now(); if (p.dead || now < p.skillAt) return;
  const c = CLS[p.cls], s = c.sk;
  if (p.mp < s.cost) { say(p, 'Mana insuficiente.'); return; }
  let cx = p.x, cy = p.y;
  if (!s.self) { const m = pickTarget(p, c.range, tg); if (!m) return; cx = m.x; cy = m.y; }
  p.mp -= s.cost; p.skillAt = now + s.cd;
  ev({ k: 'skill', c: p.cls, x: cx, y: cy, r: s.r, px: p.x, py: p.y });
  for (const m of monsters) if (!m.dead && Math.hypot(m.x - cx, m.y - cy) <= s.r) hit(p, m, s.mult);
}

/* ───────────────────────── Ações de inventário ───────────────────────── */
const invFind = (p, id) => p.inv.findIndex(i => i.id === id);
function actUse(p, id) {
  const i = invFind(p, id); if (i < 0 || p.dead) return; const it = p.inv[i];
  if (it.k !== 'hp' && it.k !== 'mp') return;
  const now = Date.now(); if (now < p.potAt) return; p.potAt = now + 1000;
  if (it.k === 'hp') p.hp = Math.min(p.maxhp, p.hp + 80 + p.lvl * 8); else p.mp = Math.min(p.maxmp, p.mp + 50 + p.lvl * 5);
  if (--it.q <= 0) p.inv.splice(i, 1);
  p.dirty = true;
}
function actEquip(p, id) {
  const i = invFind(p, id); if (i < 0) return; const it = p.inv[i];
  if (it.k !== 'eq') return;
  if (p.lvl < it.lvl) return say(p, `Requer nível ${it.lvl}.`);
  if (it.cls && it.cls !== p.cls) return say(p, `Somente para ${CLS[it.cls].n}.`);
  p.inv.splice(i, 1);
  const old = p.eq[it.slot]; p.eq[it.slot] = it; if (old) p.inv.push(old);
  recalc(p); p.hp = Math.min(p.hp, p.maxhp); p.dirty = true;
}
function actUnequip(p, slot) {
  const it = p.eq[slot]; if (!it) return;
  if (p.inv.length >= INV_SIZE) return say(p, 'Inventário cheio.');
  delete p.eq[slot]; p.inv.push(it); recalc(p); p.hp = Math.min(p.hp, p.maxhp); p.dirty = true;
}
function actDrop(p, id, confirm) {
  const i = invFind(p, id); if (i < 0) return; const it = p.inv[i];
  if (it.r >= 1 && !confirm) return say(p, 'Item valioso: confirme para descartar.');
  p.inv.splice(i, 1); p.dirty = true;
}
const sellValue = it => it.k === 'eq' ? Math.round(((it.atk || 0) + (it.def || 0)) * 4 * RAR[it.r].m) + 5 : (it.q || 1) * 4;
function actSell(p, id, confirm) {
  if (!inTownPx(p.x, p.y)) return say(p, 'Só é possível vender em Lorencia.');
  const i = invFind(p, id); if (i < 0) return; const it = p.inv[i];
  if (it.r >= 2 && !confirm) return say(p, 'Item épico/lendário: confirme a venda.');
  p.zen += sellValue(it); p.inv.splice(i, 1); p.dirty = true;
}
function actBuy(p, k) {
  if (!inTownPx(p.x, p.y)) return say(p, 'Loja só em Lorencia.');
  if (k !== 'hp' && k !== 'mp') return; if (p.zen < 20) return say(p, 'Zen insuficiente.');
  if (addItem(p, potion(k, 1))) p.zen -= 20;
}

/* ───────────────────────── Loop do mundo ───────────────────────── */
function moveEnt(e, dx, dy, speed, dt, r, noTown) {
  const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
  const nx = e.x + dx * speed * dt, ny = e.y + dy * speed * dt;
  if (!collides(nx, e.y, r) && !(noTown && inTownPx(nx, e.y))) e.x = nx;
  if (!collides(e.x, ny, r) && !(noTown && inTownPx(e.x, ny))) e.y = ny;
}
function updateMonster(m, now, dt) {
  const t = MON[m.type];
  if (m.dead) { if (now >= m.respawnAt) { m.dead = false; m.hp = m.mh; m.x = m.hx; m.y = m.hy; m.target = null; m.dmg = {}; } return; }
  let tg = m.target ? players.get(m.target) : null;
  if (tg && (tg.dead || tg.gone || inTownPx(tg.x, tg.y) || Math.hypot(tg.x - m.hx, tg.y - m.hy) > 520)) { tg = null; m.target = null; }
  if (!tg) {
    let bd = t.aggro;
    for (const p of players.values()) {
      if (p.dead || inTownPx(p.x, p.y)) continue;
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d < bd) { bd = d; tg = p; m.target = p.id; }
    }
  }
  if (tg) {
    const dx = tg.x - m.x, dy = tg.y - m.y, d = Math.hypot(dx, dy);
    if (d > t.range - 4) moveEnt(m, dx, dy, t.spd, dt, 12, true);
    else if (now >= m.nextAtk) { m.nextAtk = now + 1200; hurtPlayer(tg, m.atk, m.x, m.y); }
    if (t.boss) {
      if (!m.slamAt && now >= m.nextSlam) { m.slamAt = now + 1100; ev({ k: 'tele', x: m.x, y: m.y, r: 120, ms: 1100 }); }
      if (m.slamAt && now >= m.slamAt) {
        m.slamAt = 0; m.nextSlam = now + 6000;
        for (const p of players.values()) if (!p.dead && Math.hypot(p.x - m.x, p.y - m.y) <= 120) hurtPlayer(p, m.atk * 2.2, m.x, m.y);
      }
    }
  } else {
    if (now >= m.wanderAt) {
      m.wanderAt = now + rnd(1200, 3500);
      const far = Math.hypot(m.x - m.hx, m.y - m.hy) > 160;
      if (far) { m.wx = m.hx - m.x; m.wy = m.hy - m.y; } else if (Math.random() < 0.5) { m.wx = m.wy = 0; } else { const a = Math.random() * 6.283; m.wx = Math.cos(a); m.wy = Math.sin(a); }
    }
    if (m.wx || m.wy) moveEnt(m, m.wx, m.wy, t.spd * 0.4, dt, 12, true);
    if (m.hp < m.mh) m.hp = Math.min(m.mh, m.hp + m.mh * 0.02 * dt);
  }
}
let last = Date.now(), lastMe = 0;
function tick() {
  const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  for (const p of players.values()) {
    if (p.dead) { if (now >= p.respawnAt) respawn(p); continue; }
    if (p.ix || p.iy) moveEnt(p, p.ix, p.iy, SPEED, dt, 10, false);
    if (now - p.regenAt >= 1000) {
      p.regenAt = now; const f = inTownPx(p.x, p.y) ? 0.06 : 0.01;
      p.hp = Math.min(p.maxhp, p.hp + Math.ceil(p.maxhp * f)); p.mp = Math.min(p.maxmp, p.mp + Math.ceil(p.maxmp * (f + 0.01)));
    }
    if (now - p.lastSave > 30000) { p.lastSave = now; save(p); }
  }
  for (const m of monsters) updateMonster(m, now, dt);
  const P = [], M = [];
  for (const q of players.values()) P.push({ i: q.id, n: q.name, c: q.cls, x: Math.round(q.x), y: Math.round(q.y), hp: q.hp, mh: q.maxhp, mp: q.mp, mm: q.maxmp, l: q.lvl, d: q.dead ? 1 : 0 });
  for (const m of monsters) if (!m.dead) M.push({ i: m.id, k: m.type, x: Math.round(m.x), y: Math.round(m.y), hp: Math.round(m.hp), mh: m.mh });
  const doMe = now - lastMe > 2000; if (doMe) lastMe = now;
  for (const p of players.values()) {
    const near = (o) => Math.abs(o.x - p.x) < 900 && Math.abs(o.y - p.y) < 700;
    send(p.ws, { t: 's', me: p.id, p: P.filter(near), m: M.filter(near), e: events });
    if (p.dirty || doMe) sendMe(p);
  }
  events = [];
}

/* ───────────────────────── Rede ───────────────────────── */
const app = express();
app.disable('x-powered-by');
app.get('/health', (q, r) => r.json({ ok: true, players: players.size, monsters: monsters.filter(m => !m.dead).length, db: pool ? 'postgres' : 'file' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const SESS = new Map(), LOGIN = new Map();
function limited(ip) {
  const now = Date.now(), r = LOGIN.get(ip) || { n: 0, t: now };
  if (now - r.t > 60000) { r.n = 0; r.t = now; }
  r.n++; LOGIN.set(ip, r); return r.n > 12;
}
async function authenticate(ws, m, ip) {
  if (ws.p || ws.busy) return; ws.busy = true;
  try {
    if (limited(ip)) return send(ws, { t: 'err', m: 'Muitas tentativas. Aguarde 1 minuto.' });
    let acc = null;
    if (m.t === 'token') {
      const s = SESS.get(String(m.tok)); if (!s || s.exp < Date.now()) return send(ws, { t: 'err', m: 'Sessão expirada. Entre novamente.', relogin: 1 });
      acc = await getAcc(s.u);
    } else {
      const u = String(m.u || ''), pw = String(m.p || '');
      if (!/^[A-Za-z0-9_]{3,14}$/.test(u)) return send(ws, { t: 'err', m: 'Usuário: 3-14 letras, números ou _.' });
      if (pw.length < 6 || pw.length > 64) return send(ws, { t: 'err', m: 'Senha: 6 a 64 caracteres.' });
      if (m.t === 'register') {
        if (await getAcc(u)) return send(ws, { t: 'err', m: 'Usuário já existe.' });
        const cls = CLS[m.cls] ? m.cls : 'DK';
        await createAcc(u, hashPw(pw), newData(u, cls));
        acc = await getAcc(u);
      } else {
        acc = await getAcc(u);
        if (!acc || !checkPw(pw, acc.hash)) return send(ws, { t: 'err', m: 'Usuário ou senha inválidos.' });
      }
    }
    if (!acc) return send(ws, { t: 'err', m: 'Conta não encontrada.', relogin: 1 });
    if (acc.banned) return send(ws, { t: 'err', m: 'Conta banida.' });
    enter(ws, acc);
  } catch (e) { log('auth erro', e.message); send(ws, { t: 'err', m: 'Erro no servidor.' }); }
  finally { ws.busy = false; }
}
function enter(ws, acc) {
  for (const o of players.values()) if (o.user === acc.username) { o.gone = true; save(o); players.delete(o.id); try { o.ws.close(); } catch { } }
  const d = acc.data;
  const p = { id: NID++, user: acc.username, name: d.name, cls: d.cls, lvl: d.lvl, xp: d.xp, zen: d.zen, inv: d.inv || [], eq: d.eq || {}, x: d.x, y: d.y, ix: 0, iy: 0, ws, nextAtk: 0, skillAt: 0, potAt: 0, dead: false, respawnAt: 0, dirty: true, regenAt: 0, lastSave: Date.now(), chatAt: 0, gone: false };
  recalc(p); p.hp = d.hp > 0 ? Math.min(d.hp, p.maxhp) : p.maxhp; p.mp = d.mp > 0 ? Math.min(d.mp, p.maxmp) : p.maxmp;
  if (collides(p.x, p.y, 10)) { p.x = TOWN_C.x; p.y = TOWN_C.y; }
  ws.p = p; players.set(p.id, p);
  const tok = crypto.randomBytes(24).toString('hex'); SESS.set(tok, { u: acc.username, exp: Date.now() + 3600e3 });
  send(ws, { t: 'welcome', id: p.id, tok, tile: TILE, w: W, h: H, map: MAP, town: TOWN, name: p.name, cls: p.cls });
  log(`+ ${p.name} (${p.cls}) entrou. Online: ${players.size}`);
  for (const q of players.values()) if (q !== p) say(q, `${p.name} entrou no jogo.`);
}
wss.on('connection', (ws, req) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  ws.rate = 0;
  ws.on('message', raw => {
    if (++ws.rate > 40) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const p = ws.p;
    if (!p) { if (m.t === 'login' || m.t === 'register' || m.t === 'token') authenticate(ws, m, ip); return; }
    if (p.gone) return;
    switch (m.t) {
      case 'in': { const x = +m.x || 0, y = +m.y || 0, l = Math.hypot(x, y); p.ix = l > 1 ? x / l : x; p.iy = l > 1 ? y / l : y; break; }
      case 'atk': doAttack(p, +m.tg || 0); break;
      case 'skill': doSkill(p, +m.tg || 0); break;
      case 'use': actUse(p, String(m.id)); break;
      case 'equip': actEquip(p, String(m.id)); break;
      case 'unequip': actUnequip(p, String(m.slot)); break;
      case 'drop': actDrop(p, String(m.id), !!m.ok); break;
      case 'sell': actSell(p, String(m.id), !!m.ok); break;
      case 'buy': actBuy(p, String(m.k)); break;
      case 'chat': {
        const now = Date.now(); if (now - p.chatAt < 1000) return; p.chatAt = now;
        const txt = String(m.m || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120); if (!txt) return;
        for (const q of players.values()) send(q.ws, { t: 'chat', n: p.name, m: txt });
        break;
      }
    }
  });
  ws.on('close', () => { const p = ws.p; if (p && !p.gone) { p.gone = true; players.delete(p.id); save(p); log(`- ${p.name} saiu. Online: ${players.size}`); } });
  ws.on('error', () => { });
});
setInterval(() => { for (const c of wss.clients) c.rate = 0; }, 1000);
setInterval(() => { const n = Date.now(); for (const [k, v] of SESS) if (v.exp < n) SESS.delete(k); }, 60000);

async function shutdown() { log('Encerrando, salvando jogadores...'); await Promise.all([...players.values()].map(save)); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

initDb().then(() => { spawnAll(); setInterval(tick, 50); server.listen(PORT, () => log(`Servidor na porta ${PORT}`)); })
  .catch(e => { console.error('Falha ao iniciar:', e); process.exit(1); });
