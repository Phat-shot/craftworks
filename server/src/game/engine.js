'use strict';
// ═══════════════════════════════════════════════════════
//  WARCRAFT TD — SERVER-SIDE GAME ENGINE
//  All game logic lives here. Client is view-only.
// ═══════════════════════════════════════════════════════

const { TDB, RACES, getTowersForRace } = require('./towers');

const COLS = 25, ROWS = 35, ENTRY_COL = 12;
const TILE = 32;

// ── Enemy Base Config ────────────────────────────────────
const EBASE_HP = { basic:70, fast:45, armored:150, healer:90,  boss:1800, air_light:55, air_heavy:130 };
const EBASE = {
  basic:     { col:'#b02810', szF:.26, spdBase:1.6, rewBase:8,   name:'Läufer' },
  fast:      { col:'#b09010', szF:.20, spdBase:2.8, rewBase:10,  name:'Renner' },
  armored:   { col:'#406888', szF:.34, spdBase:1.1, rewBase:18,  name:'Gepanzert' },
  healer:    { col:'#108840', szF:.26, spdBase:1.3, rewBase:22,  name:'Heiler' },
  boss:      { col:'#600880', szF:.52, spdBase:.9,  rewBase:120, name:'BOSS' },
  air_light: { col:'#c8a820', szF:.22, spdBase:2.2, rewBase:12,  name:'Gryphon' },
  air_heavy: { col:'#8030a0', szF:.38, spdBase:1.4, rewBase:25,  name:'Drache' },
};

const WAVE_CYCLE   = ['basic','fast','armored','healer'];
const ARMOR_VARIANTS = [
  [0,0],[0.25,0],[0,0.25],[0.2,0.2],[0.35,0],[0,0.35],[0.28,0.18],[0.40,0.10],
];

// ── Calc Stats ───────────────────────────────────────────
function calcStats(t) {
  const b = TDB[t.type];
  const s = {
    name:b.name, col:b.col, dmgType:b.dmgType, canHitAir:b.canHitAir||false,
    range:b.baseRange, cd:b.baseCd, dmg:b.baseDmg,
    pierce:b.basePierce||0, splashR:b.baseSplashR||0,
    chains:b.baseChains||0, decay:b.baseDecay||1,
    slowFrac:b.baseSlowFrac||0, slowDur:b.baseSlowDur||0,
    dotDmg:b.baseDotDmg||0, dotTicks:b.baseDotTicks||0,
    dotInt:b.baseDotInt||700, slowPct:b.baseSlowPct||0,
    armorShred:0, fireDur:0, fireDmg:0, overN:0, shatBonus:0,
    dotMult:1, totalCdDelta:0, spreadChance:0, clusterN:0,
    // New mechanics
    isSpinAoe:  b.isSpinAoe||false,
    isRingAoe:  b.isRingAoe||false,
    isAura:     b.isAura||false,
    isHealAura: b.isHealAura||false,
    isPull:     b.isPull||false,
    auraAttackSpeed: b.auraAttackSpeed||0,
    auraDmg:    0,
    pullStrength: b.pullStrength||0,
    rootDur:    b.baseRootDur||0,
    healRate:   b.healRate||0,
    healMult:   1,
    dmgReduction: b.damageReduction||0,
    slowDurDelta: 0,
  };
  t.paths.forEach((lvl, pi) => {
    const path = b.paths[pi];
    for (let i = 0; i < lvl; i++) {
      const u = path.upgrades[i];
      if (u.dmg)            s.dmg            += u.dmg;
      if (u.pierce)         s.pierce         += u.pierce;
      if (u.chains)         s.chains         += u.chains;
      if (u.splashR)        s.splashR        += u.splashR;
      if (u.cdDelta)        s.totalCdDelta   += u.cdDelta;
      if (u.rangeDelta)     s.range          += u.rangeDelta;
      if (u.clusterN)       s.clusterN       = Math.max(s.clusterN, u.clusterN);
      if (u.auraSpeed)      s.auraAttackSpeed+= u.auraSpeed;
      if (u.auraDmg)        s.auraDmg        += u.auraDmg;
      if (u.pullStrength)   s.pullStrength   += u.pullStrength;
      if (u.rootDurDelta)   s.rootDur        += u.rootDurDelta;
      if (u.slowDurDelta)   s.slowDurDelta   += u.slowDurDelta;
    }
    if (lvl > 0) {
      const L = path.upgrades[lvl-1];
      if (L.slowFrac     !== undefined) s.slowFrac     = L.slowFrac;
      if (L.slowPct      !== undefined) s.slowPct      = L.slowPct;
      if (L.dotMult      !== undefined) s.dotMult      = L.dotMult;
      if (L.armorShred   !== undefined) s.armorShred   = L.armorShred;
      if (L.fireDur      !== undefined) { s.fireDur = L.fireDur; s.fireDmg = L.fireDmg; }
      if (L.overN        !== undefined) s.overN        = L.overN;
      if (L.shatBonus    !== undefined) s.shatBonus    = L.shatBonus;
      if (L.spreadChance !== undefined) s.spreadChance = L.spreadChance;
      if (L.healMult     !== undefined) s.healMult     = L.healMult;
      if (L.dmgRedDelta  !== undefined) s.dmgReduction += L.dmgRedDelta;
    }
  });
  s.cd     = Math.max(100, Math.round(b.baseCd * (1 - Math.min(0.9, s.totalCdDelta))));
  s.dotDmg = Math.round((b.baseDotDmg||0) * s.dotMult);
  s.slowDur = (b.baseSlowDur||0) + s.slowDurDelta;
  s.healRate = (b.healRate||0) * s.healMult;
  return s;
}

function getUpgradeCost(t, pi) {
  const lvl = t.paths[pi]; if (lvl >= 5) return null;
  const base   = TDB[t.type].paths[pi].upgrades[lvl].cost;
  const others = t.paths.reduce((sum, v, i) => i !== pi ? sum + v : sum, 0);
  return Math.round(base * (1 + others * 0.35));
}

// ── Wave Config ──────────────────────────────────────────
function getWaveType(wave) {
  if (wave === 5 || wave === 15) return wave === 5 ? 'air_light' : 'air_heavy';
  if (wave === 25 || wave % 10 === 0) return 'boss';
  return WAVE_CYCLE[(wave-1) % 4];
}

function getWaveConfig(wave, diffMult) {
  const type = getWaveType(wave);
  const bossNum = Math.floor(wave / 10);
  const waveHpMult = Math.pow(1.08, wave-1) * diffMult;
  const waveSpd    = 1 + Math.min(0.8, (wave-1) * 0.025);
  if (type === 'boss' || type === 'air_light' || type === 'air_heavy') {
    const isAir = type !== 'boss';
    const bn = bossNum || 1;
    return {
      type, isAir,
      count: type === 'boss' ? Math.max(1, Math.floor(bn/2)) : 6+wave,
      hpMult: Math.pow(1.4, Math.max(0, bn-1)) * diffMult,
      spdMult: isAir ? 0.9+wave*0.02 : 0.9+bn*0.05,
      armorPhys:  type === 'boss' ? Math.min(0.5, 0.08*bn) : 0,
      armorMagic: type === 'boss' ? Math.min(0.4, 0.05*bn) : 0,
      rew: type === 'boss' ? 120*bn : type === 'air_light' ? 12 : 20,
    };
  }
  const vi = bossNum === 0 ? 0 : bossNum % ARMOR_VARIANTS.length;
  const [ap, am] = ARMOR_VARIANTS[vi];
  let armorPhys = ap + bossNum*0.025, armorMagic = am + bossNum*0.015;
  if (type === 'armored') armorPhys = Math.min(0.7, armorPhys + 0.12);
  return {
    type, isAir: false,
    count: 8 + wave*2,
    hpMult: waveHpMult, spdMult: waveSpd,
    armorPhys: Math.min(0.7, armorPhys),
    armorMagic: Math.min(0.6, armorMagic),
    rew: null,
  };
}

// ── BFS Pathfinding ──────────────────────────────────────
function findPath(towers, extraR, extraC) {
  const blocked = new Set(towers.flatMap(t => [
    `${t.row},${t.col}`, `${t.row},${t.col+1}`,
    `${t.row+1},${t.col}`, `${t.row+1},${t.col+1}`,
  ]));
  if (extraR !== undefined) {
    blocked.add(`${extraR},${extraC}`);
    blocked.add(`${extraR},${extraC+1}`);
    blocked.add(`${extraR+1},${extraC}`);
    blocked.add(`${extraR+1},${extraC+1}`);
  }
  const EXIT_ROW = ROWS - 1;
  const queue = [[0, ENTRY_COL]];
  const par   = new Map([[`0,${ENTRY_COL}`, null]]);
  const dirs  = [[1,0],[0,1],[0,-1],[-1,0]];
  while (queue.length) {
    const [r, c] = queue.shift();
    if (r === EXIT_ROW) {
      const path = []; let k = `${r},${c}`;
      while (k !== null) {
        const [pr, pc] = k.split(',').map(Number);
        path.unshift([pr, pc]); k = par.get(k);
      }
      return path;
    }
    for (const [dr, dc] of dirs) {
      const nr = r+dr, nc = c+dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const k = `${nr},${nc}`;
      if (blocked.has(k) || par.has(k)) continue;
      par.set(k, `${r},${c}`); queue.push([nr, nc]);
    }
  }
  return null;
}

function canPlaceAt(towers, r, c) {
  const EXIT_ROW = ROWS - 1;
  if (r < 0 || r+1 >= ROWS || c < 0 || c+1 >= COLS) return false;
  const cells = [[r,c],[r,c+1],[r+1,c],[r+1,c+1]];
  for (const [rr, cc] of cells) {
    if (rr === 0  && cc === ENTRY_COL) return false;
    if (rr === EXIT_ROW && cc === ENTRY_COL) return false;
  }
  for (const t of towers) {
    const tr = [[t.row,t.col],[t.row,t.col+1],[t.row+1,t.col],[t.row+1,t.col+1]];
    for (const [rr,cc] of cells)
      for (const [tr2,tc2] of tr)
        if (rr === tr2 && cc === tc2) return false;
  }
  return true;
}

// ── Game Session ─────────────────────────────────────────
let _eid = 0;
let _bid = 0;

function mkEnemy(cfg, wave) {
  const b   = EBASE[cfg.type];
  const hp  = Math.round(EBASE_HP[cfg.type] * cfg.hpMult);
  const spd = b.spdBase * cfg.spdMult;
  const rew = cfg.rew || Math.round(b.rewBase * (1 + wave * .04));
  return {
    id: ++_eid, type: cfg.type, col: b.col, szF: b.szF, name: b.name,
    hp: Math.max(1, hp), maxHp: Math.max(1, hp),
    spd, rew,
    armorPhys: cfg.armorPhys||0, armorMagic: cfg.armorMagic||0,
    isAir: cfg.isAir||false,
    row: 0, col2: ENTRY_COL,
    px: ENTRY_COL*TILE + TILE/2, py: TILE/2, pathIdx: 1,
    airX: ENTRY_COL*TILE + TILE/2, airY: -TILE, airPhase: Math.random()*Math.PI*2,
    poison: null, slow: null, fire: null, healTimer: 0,
    dead: false, escaped: false,
  };
}

function createGame(sessionId, difficulty, mode, players, playerRaces = {}) {
  const diffMult = { easy:1.0, normal:1.5, hard:2.0, expert:2.5, horror:3.0 }[difficulty] || 1.5;
  const playerCount = players.length;

  // Per-player state
  const playerState = {};
  for (const p of players) {
    const race = playerRaces[p.userId] || 'standard';
    playerState[p.userId] = {
      userId: p.userId, username: p.username, avatar_color: p.avatar_color,
      lives: 50, gold: 150, score: 0, kills: 0,
      status: 'playing',
      race,
      availableTowers: getTowersForRace(race),
    };
  }

  const path = findPath([]);
  const pathSet = new Set((path||[]).map(([r,c]) => `${r},${c}`));

  return {
    sessionId, difficulty, mode, diffMult, playerCount,
    players: playerState,
    towers: [], enemies: [], bullets: [], particles: [], bolts: [], fireZones: [],
    wave: 0, waveActive: false, gameOver: false,
    spawnQ: [], spawnIdx: 0, spawnTimer: 0, spawnInterval: 0,
    gameTime: 0, lastTick: Date.now(),
    globalPath: path, pathSet,
    sharedLives: 50,
    // Coop: extra starting gold debt (150g * extra players, paid off from wave bonuses)
    startingGoldDebt: mode === 'coop' ? 150 * Math.max(0, playerCount - 1) : 0,
  };
}

// ── Game Logic Tick ──────────────────────────────────────
function tick(gs) {
  const now  = Date.now();
  const dt   = Math.min((now - gs.lastTick) / 1000, 0.05);
  gs.lastTick = now;
  if (gs.gameOver) return;

  gs.gameTime += dt * 1000;

  updateSpawn(gs, dt);
  updateEnemies(gs, dt);
  updateTowers(gs);
  updateBullets(gs, dt);
  updateParticles(gs, dt);
  updateFireZones(gs);
  checkWaveEnd(gs);
}

function updateSpawn(gs, dt) {
  if (!gs.waveActive || gs.spawnIdx >= gs.spawnQ.length) return;
  gs.spawnTimer -= dt * 1000;
  if (gs.spawnTimer <= 0) {
    gs.enemies.push(gs.spawnQ[gs.spawnIdx++]);
    gs.spawnTimer = gs.spawnInterval;
  }
}

function updateEnemies(gs, dt) {
  const path = gs.globalPath;
  const EXIT_ROW = ROWS - 1;
  for (const e of gs.enemies) {
    if (e.dead || e.escaped) continue;
    let spd = e.spd * TILE;
    if (!e.isAir && e.slow) {
      e.slow.until > gs.gameTime ? spd *= (1 - e.slow.frac) : (e.slow = null);
    }
    if (e.rooted && gs.gameTime < e.rooted.until) {
      // Rooted: skip movement
    } else {
      if (e.rooted) e.rooted = null;
    if (e.isAir) {
      e.airY += spd * dt;
      e.airX = ENTRY_COL*TILE + TILE/2 + Math.sin(e.airY/(TILE*2) + e.airPhase)*TILE*.4;
      if (e.airY > EXIT_ROW*TILE + TILE) {
        e.escaped = true;
        loseLife(gs);
      }
    } else {
      if (!path || !path.length) continue;
      if (e.pathIdx >= path.length) {
        e.escaped = true; loseLife(gs); continue;
      }
      const [tr, tc] = path[e.pathIdx];
      const tx = tc*TILE + TILE/2, ty = tr*TILE + TILE/2;
      const dx = tx - e.px, dy = ty - e.py;
      const dist = Math.hypot(dx, dy), step = spd * dt;
      if (step >= dist || dist < .5) {
        e.row = tr; e.col2 = tc; e.px = tx; e.py = ty; e.pathIdx++;
        if (e.pathIdx >= path.length) { e.escaped = true; loseLife(gs); }
      } else { e.px += dx/dist*step; e.py += dy/dist*step; }
    }
    } // end root block
    // Poison tick
    if (e.poison && e.poison.ticks > 0 && gs.gameTime >= e.poison.next) {
      dealDmg(gs, e, e.poison.dmg, 'magic');
      e.poison.ticks--;
      e.poison.ticks > 0 ? (e.poison.next = gs.gameTime + e.poison.int) : (e.poison = null);
    }
    // Fire tick
    if (e.fire && e.fire.until > gs.gameTime && gs.gameTime >= e.fire.next) {
      dealDmg(gs, e, e.fire.dmg, 'expl');
      e.fire.next = gs.gameTime + 500;
    }
    // Healer aura
    if (e.type === 'healer' && gs.gameTime - e.healTimer > 2000) {
      e.healTimer = gs.gameTime;
      for (const o of gs.enemies) {
        if (o === e || o.dead || o.escaped) continue;
        if (Math.hypot(o.px-e.px, o.py-e.py) < TILE*2.5)
          o.hp = Math.min(o.maxHp, o.hp + Math.round(o.maxHp*.07));
      }
    }
  }
}

function loseLife(gs) {
  gs.sharedLives = Math.max(0, gs.sharedLives - 1);
  // Distribute lives display to all players
  for (const p of Object.values(gs.players)) p.lives = gs.sharedLives;
  if (gs.sharedLives <= 0) endGame(gs, false);
}

function updateTowers(gs) {
  // Build aura buffs map: towerId -> {cdMult, dmgMult}
  const auraBufs = {};
  for (const a of gs.towers) {
    const ab = TDB[a.type];
    if (!ab.isAura && !ab.isHealAura) continue;
    const as_ = calcStats(a);
    const ax = a.col*TILE+TILE, ay = a.row*TILE+TILE;
    const ar2 = (as_.range*TILE)**2;
    for (const t of gs.towers) {
      if (t === a) continue;
      const tx = t.col*TILE+TILE, ty = t.row*TILE+TILE;
      if ((tx-ax)**2+(ty-ay)**2 > ar2) continue;
      if (!auraBufs[t.id]) auraBufs[t.id] = {cdMult:1, dmgMult:1};
      if (as_.auraAttackSpeed > 0) auraBufs[t.id].cdMult  *= (1 - as_.auraAttackSpeed);
      if (as_.auraDmg         > 0) auraBufs[t.id].dmgMult *= (1 + as_.auraDmg);
    }
    // Heal aura: restore lives slowly
    if (ab.isHealAura && as_.healRate > 0) {
      const healAmt = as_.healRate * (gs.gameTime - (a._lastHealTick||gs.gameTime)) / 1000;
      if (healAmt > 0) {
        gs.sharedLives = Math.min(50, gs.sharedLives + healAmt);
        a._lastHealTick = gs.gameTime;
        for (const p of Object.values(gs.players)) p.lives = Math.round(gs.sharedLives);
      }
    }
    // Store damage reduction from mondlichtaltar
    if (as_.dmgReduction > 0) gs._dmgReduction = (gs._dmgReduction||0) + as_.dmgReduction;
  }
  gs._dmgReduction = Math.min(0.5, gs._dmgReduction||0);

  for (const t of gs.towers) {
    const b = TDB[t.type];
    if (b.isAura || b.isHealAura) continue; // aura towers don't fire
    const s = calcStats(t);
    // Apply aura buffs
    const buf = auraBufs[t.id];
    if (buf) { s.cd = Math.round(s.cd * buf.cdMult); s.dmg = Math.round(s.dmg * buf.dmgMult); }
    const cooldown = b.isSpinAoe ? s.cd : s.cd;
    if (gs.gameTime - t.lastFire >= cooldown) {
      if (b.isSpinAoe) {
        // Fleischwolf: damage all enemies in range simultaneously
        fireSpinAoe(gs, t, s);
      } else if (b.isRingAoe) {
        // Elektrozaun: zap all in range
        fireRingAoe(gs, t, s);
      } else {
        const tgt = bestTarget(gs, t, s);
        if (tgt) fireTower(gs, t, s, tgt);
      }
    }
  }
  gs._dmgReduction = 0; // reset each tick, recalculated above
}

function fireSpinAoe(gs, t, s) {
  t.lastFire = gs.gameTime;
  const cx = t.col*TILE+TILE, cy = t.row*TILE+TILE;
  const r2 = (s.range*TILE)**2;
  let hit = false;
  for (const e of gs.enemies) {
    if (e.dead || e.escaped || e.isAir) continue;
    if ((e.px-cx)**2+(e.py-cy)**2 > r2) continue;
    dealDmg(gs, e, s.dmg, 'phys');
    hit = true;
  }
  if (hit) gs.bolts.push({x1:cx,y1:cy,x2:cx+s.range*TILE,y2:cy,life:4,maxLife:4,kind:'spin'});
}

function fireRingAoe(gs, t, s) {
  t.lastFire = gs.gameTime;
  const cx = t.col*TILE+TILE, cy = t.row*TILE+TILE;
  const r2 = (s.range*TILE)**2;
  for (const e of gs.enemies) {
    if (e.dead || e.escaped) continue;
    const ex = e.isAir?e.airX:e.px, ey = e.isAir?e.airY:e.py;
    if ((ex-cx)**2+(ey-cy)**2 > r2) continue;
    dealDmg(gs, e, s.dmg, 'magic');
    if (s.slowFrac > 0) applySlow(e, s.slowFrac, s.slowDur||1000, gs.gameTime);
  }
  gs.bolts.push({x1:cx,y1:cy,x2:cx,y2:cy-s.range*TILE,life:6,maxLife:6,kind:'ring'});
}

function bestTarget(gs, t, s) {
  const cx = t.col*TILE + TILE, cy = t.row*TILE + TILE;
  const r2 = (s.range * TILE) ** 2;
  const blindR2 = TDB[t.type].blindSpot ? (TDB[t.type].blindSpot * TILE)**2 : 0;
  let best = null, bm = -Infinity;
  for (const e of gs.enemies) {
    if (e.dead || e.escaped) continue;
    if (e.isAir && !s.canHitAir) continue;
    const ex = e.isAir ? e.airX : e.px, ey = e.isAir ? e.airY : e.py;
    const d2 = (ex-cx)**2 + (ey-cy)**2;
    if (d2 > r2) continue;
    if (blindR2 > 0 && d2 < blindR2) continue; // blind spot (Mörser)
    const m = s.dmgType === 'expl' ? -(e.isAir ? e.airY : e.pathIdx) : e.isAir ? e.airY : e.pathIdx;
    if (m > bm) { bm = m; best = e; }
  }
  return best;
}

function fireTower(gs, t, s, tgt) {
  t.lastFire = gs.gameTime;
  t.shotCount = (t.shotCount||0) + 1;
  const sx = t.col*TILE + TILE, sy = t.row*TILE + TILE;
  const tx = tgt.isAir ? tgt.airX : tgt.px, ty = tgt.isAir ? tgt.airY : tgt.py;
  const isOver = s.overN > 0 && t.shotCount % s.overN === 0;
  switch (t.type) {
    case 'dart':
      gs.bullets.push({ id:++_bid, kind:'dart', x:sx,y:sy, spd:9*TILE, target:tgt, dmg:s.dmg, pierce:s.pierce, pierced:[], dmgType:'phys' }); break;
    case 'poison':
      gs.bullets.push({ id:++_bid, kind:'poison', x:sx,y:sy, spd:5.5*TILE, target:tgt, dmg:s.dmg, dotDmg:s.dotDmg, dotTicks:s.dotTicks, dotInt:s.dotInt, slowPct:s.slowPct, armorShred:s.armorShred, spreadChance:s.spreadChance, dmgType:'magic' }); break;
    case 'splash':
      gs.bullets.push({ id:++_bid, kind:'bomb', x:sx,y:sy, spd:6.5*TILE, tx, ty, dmg:s.dmg, splR:s.splashR*TILE, fireDur:s.fireDur, fireDmg:s.fireDmg, clusterN:s.clusterN, clusterDmg:Math.round(s.dmg*.4), clusterSplR:Math.max(TILE*.5, s.splashR*TILE*.45), dmgType:'expl' }); break;
    case 'lightning': {
      const dmg2 = isOver ? s.dmg*3 : s.dmg;
      chainLight(gs, sx, sy, tgt, dmg2, s.chains, isOver ? 1.0 : s.decay, new Set([tgt.id]));
      break;
    }
    case 'frost': {
      const sm = s.shatBonus > 0 && tgt.slow && tgt.slow.until > gs.gameTime ? (1+s.shatBonus) : 1;
      gs.bullets.push({ id:++_bid, kind:'frost', x:sx,y:sy, spd:7*TILE, target:tgt, dmg:Math.round(s.dmg*sm), slowFrac:s.slowFrac, slowDur:s.slowDur, splashR:s.splashR*TILE, dmgType:'magic' }); break;
    }
    // ORCS
    case 'wurfspeer':
      gs.bullets.push({ id:++_bid, kind:'spear', x:sx,y:sy, spd:11*TILE, target:tgt, dmg:s.dmg, pierce:s.pierce, pierced:[], armorShred:s.armorShred, dmgType:'phys' }); break;
    // TECHIES
    case 'moerser': {
      // Long range bomb, blind spot check handled in bestTarget
      gs.bullets.push({ id:++_bid, kind:'bomb', x:sx,y:sy, spd:4*TILE, tx, ty, dmg:s.dmg, splR:s.splashR*TILE, fireDur:s.fireDur, fireDmg:s.fireDmg, clusterN:0, clusterDmg:0, clusterSplR:0, dmgType:'expl' }); break;
    }
    case 'raketenwerfer':
      gs.bullets.push({ id:++_bid, kind:'rocket', x:sx,y:sy, spd:12*TILE, target:tgt, dmg:s.dmg, splR:s.splashR*TILE, clusterN:s.clusterN, clusterDmg:Math.round(s.dmg*.35), clusterSplR:s.splashR*TILE*.5, dmgType:'expl' }); break;
    // ELEMENTE
    case 'magmaquelle': {
      gs.bullets.push({ id:++_bid, kind:'magma', x:sx,y:sy, spd:3.5*TILE, tx, ty, dmg:s.dmg, splR:s.splashR*TILE, fireDur:s.fireDur||4000, fireDmg:s.fireDmg||8, armorShred:s.armorShred, dmgType:'expl' }); break;
    }
    case 'sturmstrudel': {
      // Pull + damage all in range
      const cx2=t.col*TILE+TILE, cy2=t.row*TILE+TILE;
      const r2=(s.range*TILE)**2;
      t.lastFire=gs.gameTime;
      for (const e of gs.enemies) {
        if (e.dead||e.escaped) continue;
        const ex=e.isAir?e.airX:e.px, ey=e.isAir?e.airY:e.py;
        if ((ex-cx2)**2+(ey-cy2)**2>r2) continue;
        dealDmg(gs,e,s.dmg,'magic');
        // Pull toward center
        if (!e.isAir) {
          const dx=cx2-e.px, dy=cy2-e.py, dist=Math.hypot(dx,dy)||1;
          const pull=s.pullStrength*TILE*0.5;
          e.px+=dx/dist*pull; e.py+=dy/dist*pull;
        }
      }
      gs.bolts.push({x1:cx2,y1:cy2,x2:cx2,y2:cy2-s.range*TILE,life:8,maxLife:8,kind:'wind'});
      return; // already set lastFire and applied effects
    }
    case 'eisspitze': {
      const sm2 = s.shatBonus > 0 && tgt.slow && tgt.slow.until > gs.gameTime ? (1+s.shatBonus) : 1;
      gs.bullets.push({ id:++_bid, kind:'ice', x:sx,y:sy, spd:8*TILE, target:tgt, dmg:Math.round(s.dmg*sm2), slowFrac:0.75, slowDur:s.slowDur||3000, splashR:s.splashR*TILE, dmgType:'magic' }); break;
    }
    // URWALD
    case 'rankenfalle':
      gs.bullets.push({ id:++_bid, kind:'vine', x:sx,y:sy, spd:6*TILE, target:tgt, dmg:s.dmg, rootDur:s.rootDur, slowFrac:0.45, slowDur:2500, splashR:s.splashR*TILE, dmgType:'phys' }); break;
    case 'giftpilz':
      gs.bullets.push({ id:++_bid, kind:'spore', x:sx,y:sy, spd:4*TILE, tx, ty, dmg:s.dmg, dotDmg:s.dotDmg||12, dotTicks:s.dotTicks||6, dotInt:600, splR:s.splashR*TILE, spreadChance:s.spreadChance||0.3, dmgType:'magic' }); break;
  }
}

function chainLight(gs, fx, fy, tgt, dmg, left, decay, hit) {
  dealDmg(gs, tgt, dmg, 'magic');
  gs.bolts.push({ x1:fx, y1:fy, x2:tgt.isAir?tgt.airX:tgt.px, y2:tgt.isAir?tgt.airY:tgt.py, life:8, maxLife:8 });
  if (left <= 0) return;
  let nx = null, bd = 8*TILE;
  const tx = tgt.isAir?tgt.airX:tgt.px, ty2 = tgt.isAir?tgt.airY:tgt.py;
  for (const e of gs.enemies) {
    if (e.dead || e.escaped || hit.has(e.id)) continue;
    const ex = e.isAir?e.airX:e.px, ey = e.isAir?e.airY:e.py;
    const d = Math.hypot(ex-tx, ey-ty2);
    if (d < bd) { bd = d; nx = e; }
  }
  if (nx) { hit.add(nx.id); chainLight(gs, tx, ty2, nx, Math.round(dmg*decay), left-1, decay, hit); }
}

function updateBullets(gs, dt) {
  const rem = [];
  for (const b of gs.bullets) {
    if (b.kind === 'bomb') {
      const dx = b.tx-b.x, dy = b.ty-b.y, dist = Math.hypot(dx,dy), step = b.spd*dt;
      if (step >= dist) {
        for (const e of gs.enemies) {
          if (e.dead || e.escaped) continue;
          const ex = e.isAir?e.airX:e.px, ey = e.isAir?e.airY:e.py;
          if ((ex-b.tx)**2 + (ey-b.ty)**2 <= b.splR**2) {
            dealDmg(gs, e, b.dmg, 'expl');
            if (b.fireDur > 0 && !e.isAir) applyFire(e, b.fireDmg, b.fireDur, gs.gameTime);
          }
        }
        if (b.fireDur > 0) gs.fireZones.push({ x:b.tx, y:b.ty, r:b.splR*.8, dmg:b.fireDmg, dur:b.fireDur, until:gs.gameTime+b.fireDur, next:gs.gameTime+500 });
        // Magma: armor shred in zone
        if (b.armorShred > 0) {
          for (const e of gs.enemies) { if(e.dead||e.escaped) continue;
            const ex=e.isAir?e.airX:e.px,ey=e.isAir?e.airY:e.py;
            if((ex-b.tx)**2+(ey-b.ty)**2<=b.splR**2) e.armorPhys=Math.max(0,e.armorPhys-b.armorShred*0.1); }
        }
        // Spore: AoE poison cloud
        if (b.dotDmg > 0) {
          for (const e of gs.enemies) { if(e.dead||e.escaped) continue;
            const ex=e.isAir?e.airX:e.px,ey=e.isAir?e.airY:e.py;
            if((ex-b.tx)**2+(ey-b.ty)**2<=b.splR**2) {
              applyPoison(e,b.dotDmg,b.dotTicks,b.dotInt,0,0,gs.gameTime);
              if(b.spreadChance>0) e.poison.spreadChance=b.spreadChance; } }
        }
        if (b.clusterN > 0) {
          for (let ci = 0; ci < b.clusterN; ci++) {
            const ang = (ci/b.clusterN)*Math.PI*2 + Math.random()*.4;
            const d2 = TILE*(1.2+Math.random()*1.4);
            gs.bullets.push({ id:++_bid, kind:'bomb', x:b.tx, y:b.ty, tx:b.tx+Math.cos(ang)*d2, ty:b.ty+Math.sin(ang)*d2, spd:7*TILE, dmg:b.clusterDmg, splR:b.clusterSplR, fireDur:0, fireDmg:0, clusterN:0, clusterDmg:0, clusterSplR:0, dmgType:'expl' });
          }
        }
        spawnExp(gs, b.tx, b.ty); rem.push(b);
      } else { b.x += dx/dist*step; b.y += dy/dist*step; }
    } else {
      if (!b.target || b.target.dead || b.target.escaped) { rem.push(b); continue; }
      const tx2 = b.target.isAir?b.target.airX:b.target.px;
      const ty3 = b.target.isAir?b.target.airY:b.target.py;
      const dx = tx2-b.x, dy = ty3-b.y, dist = Math.hypot(dx,dy), step = b.spd*dt;
      if (step >= dist) {
        switch (b.kind) {
          case 'dart':
            dealDmg(gs, b.target, b.dmg, 'phys');
            if (b.pierce > 0 && b.pierced.length < b.pierce) {
              b.pierced.push(b.target.id);
              let nx = null, nd = 5*TILE;
              for (const e of gs.enemies) {
                if (e.dead || e.escaped || b.pierced.includes(e.id)) continue;
                const ex = e.isAir?e.airX:e.px, ey = e.isAir?e.airY:e.py;
                const d = Math.hypot(ex-b.x, ey-b.y); if (d < nd) { nd=d; nx=e; }
              }
              if (nx) { b.target = nx; continue; }
            }
            rem.push(b); break;
          case 'poison':
            dealDmg(gs, b.target, b.dmg, 'magic');
            applyPoison(b.target, b.dotDmg, b.dotTicks, b.dotInt, b.slowPct, b.armorShred, gs.gameTime);
            if (b.spreadChance > 0) b.target.poison.spreadChance = b.spreadChance;
            rem.push(b); break;
          case 'frost': case 'ice':
            dealDmg(gs, b.target, b.dmg, 'magic');
            if (b.splashR > 0) {
              for (const e of gs.enemies) {
                if (e.dead || e.escaped) continue;
                const ex = e.isAir?e.airX:e.px, ey = e.isAir?e.airY:e.py;
                if ((ex-tx2)**2 + (ey-ty3)**2 <= b.splashR**2) {
                  applySlow(e, b.slowFrac, b.slowDur, gs.gameTime);
                  dealDmg(gs, e, Math.round(b.dmg*.45), 'magic');
                }
              }
            } else { applySlow(b.target, b.slowFrac, b.slowDur, gs.gameTime); }
            rem.push(b); break;
          case 'spear': // like dart but with armorShred
            dealDmg(gs, b.target, b.dmg, 'phys');
            if (b.armorShred > 0) { b.target.armorPhys = Math.max(0, b.target.armorPhys - b.armorShred); }
            if (b.pierce > 0 && b.pierced.length < b.pierce) {
              b.pierced.push(b.target.id);
              let nx=null, nd=5*TILE;
              for (const e of gs.enemies) { if (e.dead||e.escaped||b.pierced.includes(e.id)) continue;
                const ex=e.isAir?e.airX:e.px,ey=e.isAir?e.airY:e.py; const d=Math.hypot(ex-b.x,ey-b.y); if(d<nd){nd=d;nx=e;} }
              if (nx) { b.target=nx; continue; }
            }
            rem.push(b); break;
          case 'rocket': // bomb that tracks + can hit air
            dealDmg(gs, b.target, b.dmg, 'expl');
            if (b.splashR > 0) {
              for (const e of gs.enemies) { if(e.dead||e.escaped) continue;
                const ex=e.isAir?e.airX:e.px,ey=e.isAir?e.airY:e.py;
                if((ex-tx2)**2+(ey-ty3)**2<=b.splashR**2) dealDmg(gs,e,Math.round(b.dmg*.5),'expl'); }
            }
            if (b.clusterN > 0) {
              for(let ci=0;ci<b.clusterN;ci++){const ang=(ci/b.clusterN)*Math.PI*2;const d2=TILE*(1+Math.random());
                gs.bullets.push({id:++_bid,kind:'bomb',x:tx2,y:ty3,tx:tx2+Math.cos(ang)*d2,ty:ty3+Math.sin(ang)*d2,spd:8*TILE,dmg:b.clusterDmg,splR:b.clusterSplR,fireDur:0,fireDmg:0,clusterN:0,clusterDmg:0,clusterSplR:0,dmgType:'expl'});}
            }
            spawnExp(gs,tx2,ty3); rem.push(b); break;
          case 'vine': // root then slow
            dealDmg(gs, b.target, b.dmg, 'phys');
            b.target.rooted = { until: gs.gameTime + (b.rootDur||1200) };
            if (b.splashR > 0) {
              for (const e of gs.enemies) { if(e.dead||e.escaped||e.isAir) continue;
                const ex=e.px,ey=e.py; if((ex-tx2)**2+(ey-ty3)**2<=b.splashR**2){
                  applySlow(e,b.slowFrac,b.slowDur,gs.gameTime);
                  if(!e.rooted) e.rooted={until:gs.gameTime+(b.rootDur||1200)*0.5};} }
            } else { applySlow(b.target, b.slowFrac, b.slowDur, gs.gameTime); }
            rem.push(b); break;
          default: rem.push(b);
        }
      } else { b.x += dx/dist*step; b.y += dy/dist*step; }
    }
  }
  gs.bullets = gs.bullets.filter(b => !rem.includes(b));
}

function updateParticles(gs, dt) {
  for (const p of gs.particles) { p.x += p.vx*dt; p.y += p.vy*dt; p.vy += 200*dt; p.life--; }
  gs.particles = gs.particles.filter(p => p.life > 0);
  gs.bolts = gs.bolts.filter(b => { b.life--; return b.life > 0; });
}

function updateFireZones(gs) {
  gs.fireZones = gs.fireZones.filter(f => f.until > gs.gameTime);
  for (const f of gs.fireZones) {
    if (gs.gameTime >= f.next) {
      f.next = gs.gameTime + 500;
      for (const e of gs.enemies) {
        if (e.dead || e.escaped || e.isAir) continue;
        if ((e.px-f.x)**2 + (e.py-f.y)**2 <= f.r**2) dealDmg(gs, e, f.dmg, 'expl');
      }
    }
  }
}

function checkWaveEnd(gs) {
  if (!gs.waveActive) return;
  if (gs.spawnIdx < gs.spawnQ.length) return;
  if (gs.enemies.some(e => !e.dead && !e.escaped)) return;
  gs.waveActive = false;
  gs.enemies = []; gs.spawnQ = []; gs.fireZones = [];
  const rawBonus = 25 + gs.wave*5;
  // Coop: pay off starting gold debt from wave bonuses (up to 50% per wave)
  let effectiveBonus = rawBonus;
  if (gs.startingGoldDebt > 0) {
    const pay = Math.min(gs.startingGoldDebt, Math.floor(rawBonus * 0.5));
    gs.startingGoldDebt -= pay;
    effectiveBonus = rawBonus - pay;
    gs._waveDebtPaid = true;
  }
  const bonus = Math.max(1, Math.ceil(effectiveBonus / (gs.mode==='coop' ? gs.playerCount : 1)));
  for (const p of Object.values(gs.players)) {
    p.gold  = (p.gold||150) + bonus;
    p.score = (p.score||0) + bonus*5;
  }
  gs._waveEndBonus = bonus;
  gs._waveJustEnded = true;
  if (gs.wave >= 25) endGame(gs, true);
}

function startWave(gs) {
  if (gs.waveActive || gs.gameOver || gs.wave >= 25) return false;
  gs.wave++;
  const cfg = getWaveConfig(gs.wave, gs.diffMult);
  gs.waveActive = true;
  gs.spawnQ = [];
  for (let i = 0; i < cfg.count; i++) gs.spawnQ.push(mkEnemy(cfg, gs.wave));
  gs.spawnIdx = 0;
  gs.spawnInterval = Math.max(230, 1300 - gs.wave*30);
  gs.spawnTimer = 0;
  gs._waveJustStarted = true;
  return true;
}

function dealDmg(gs, e, dmg, dmgType) {
  let d = dmg;
  if (dmgType === 'phys')       d = Math.round(dmg * (1 - e.armorPhys));
  else if (dmgType === 'expl')  d = Math.round(dmg * (1 - e.armorPhys*.5));
  else if (dmgType === 'magic') d = Math.round(dmg * (1 - e.armorMagic));
  d = Math.max(1, d); e.hp -= d;
  spawnHit(gs, e.isAir?e.airX:e.px, e.isAir?e.airY:e.py, dmgType);
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    const rew = e.rew;
    for (const p of Object.values(gs.players)) {
      p.gold  = (p.gold||0) + rew;
      p.score = (p.score||0) + rew*10;
      p.kills = (p.kills||0) + 1;
    }
    spawnDeath(gs, e.isAir?e.airX:e.px, e.isAir?e.airY:e.py, e.col);
    // Poison spread on death
    if (e.poison && e.poison.ticks > 0 && e.poison.spreadChance > 0) {
      const chance = e.poison.spreadChance;
      const ex = e.isAir?e.airX:e.px, ey = e.isAir?e.airY:e.py;
      for (const o of gs.enemies) {
        if (o === e || o.dead || o.escaped) continue;
        const ox = o.isAir?o.airX:o.px, oy = o.isAir?o.airY:o.py;
        if (Math.hypot(ox-ex, oy-ey) > TILE*2.8) continue;
        if (Math.random() < chance) {
          applyPoison(o, e.poison.dmg, Math.ceil(e.poison.ticks*.75), e.poison.int, 0, 0, gs.gameTime);
          o.poison.spreadChance = chance;
        }
      }
    }
  }
}

function applyPoison(e, dotDmg, dotTicks, dotInt, slowPct, armorShred, gameTime) {
  if (!e.poison) e.poison = {};
  e.poison.dmg   = Math.min((e.poison.dmg||0) + dotDmg, dotDmg*4);
  e.poison.ticks = Math.max(e.poison.ticks||0, dotTicks);
  e.poison.int   = dotInt; e.poison.next = gameTime + dotInt;
  if (e.poison.spreadChance === undefined) e.poison.spreadChance = 0;
  if (slowPct) applySlow(e, slowPct, dotTicks*dotInt, gameTime);
  if (armorShred > 0) { e.armorPhys = Math.max(0, e.armorPhys-armorShred); e.armorMagic = Math.max(0, e.armorMagic-armorShred*.5); }
}

function applySlow(e, frac, dur, gameTime) {
  const cur = (e.slow && e.slow.frac) || 0;
  e.slow = { frac: Math.min(cur+frac, .98), until: gameTime + dur };
}

function applyFire(e, dmg, dur, gameTime) {
  if (!e.fire || e.fire.until < gameTime) e.fire = { dmg, dur, until: gameTime+dur, next: gameTime+500 };
}

function spawnHit(gs, x, y, t) {
  const c = { phys:'#60c0ff', magic:'#d040e0', expl:'#ff8820' }[t]||'#fff';
  for (let i = 0; i < 4; i++) gs.particles.push({ x, y, vx:(Math.random()-.5)*70, vy:-Math.random()*50-8, r:3, life:20, maxLife:20, col:c });
}
function spawnDeath(gs, x, y, col) {
  for (let i = 0; i < 14; i++) { const a=Math.random()*Math.PI*2,s=Math.random()*100+40; gs.particles.push({ x, y, vx:Math.cos(a)*s, vy:Math.sin(a)*s, r:5, life:36, maxLife:36, col }); }
}
function spawnExp(gs, x, y) {
  for (let i = 0; i < 18; i++) { const a=Math.random()*Math.PI*2,s=Math.random()*140+50; gs.particles.push({ x, y, vx:Math.cos(a)*s, vy:Math.sin(a)*s, r:5, life:28, maxLife:28, col:'#ff8020' }); }
}

function rerouteEnemies(gs) {
  const path = gs.globalPath; if (!path) return;
  for (const e of gs.enemies) {
    if (e.dead || e.escaped || e.isAir) continue;
    let idx = path.findIndex(([r,c]) => r===e.row && c===e.col2);
    if (idx < 0) {
      let best=0, bd=Infinity;
      for (let i=0; i<path.length; i++) { const d=Math.abs(path[i][0]-e.row)+Math.abs(path[i][1]-e.col2); if(d<bd){bd=d;best=i;} }
      idx=best; e.row=path[idx][0]; e.col2=path[idx][1]; e.px=e.col2*TILE+TILE/2; e.py=e.row*TILE+TILE/2;
    }
    e.pathIdx = Math.min(idx+1, path.length-1);
    if (e.pathIdx >= path.length) e.escaped = true;
  }
}

function endGame(gs, win) {
  gs.gameOver = true;
  gs._gameOverWin = win;
}

// ── Player Actions (called from socket handlers) ─────────
function actionPlaceTower(gs, userId, type, row, col) {
  const b = TDB[type]; if (!b) return { ok:false, err:'unknown_type' };
  const p = gs.players[userId]; if (!p) return { ok:false, err:'not_in_game' };
  // Check player has access to this tower type via their race
  if (p.availableTowers && !p.availableTowers.includes(type))
    return { ok:false, err:'wrong_race' };
  if ((p.gold||0) < b.cost) return { ok:false, err:'no_gold' };
  if (b.unlock && gs.wave < b.unlock) return { ok:false, err:'locked' };
  if (!canPlaceAt(gs.towers, row, col)) return { ok:false, err:'blocked' };
  const np = findPath([...gs.towers, { row, col }]);
  if (!np) return { ok:false, err:'blocks_path' };
  p.gold -= b.cost;
  const tower = { id:`t${Date.now()}`, type, row, col, paths:[0,0,0], lastFire:0, invested:b.cost, shotCount:0, owner:userId };
  gs.towers.push(tower);
  gs.globalPath = np;
  gs.pathSet = new Set(np.map(([r,c]) => `${r},${c}`));
  rerouteEnemies(gs);
  return { ok:true, tower, player: p };
}

function actionUpgradePath(gs, userId, towerId, pi) {
  const t = gs.towers.find(t => t.id === towerId); if (!t) return { ok:false, err:'no_tower' };
  if (t.owner !== userId) return { ok:false, err:'not_owner' };
  const p = gs.players[userId]; if (!p) return { ok:false, err:'not_in_game' };
  const cost = getUpgradeCost(t, pi); if (cost === null) return { ok:false, err:'maxed' };
  if ((p.gold||0) < cost) return { ok:false, err:'no_gold' };
  p.gold -= cost; t.invested += cost; t.paths[pi]++;
  return { ok:true, tower:t, player:p };
}

function actionSellTower(gs, userId, towerId) {
  const t = gs.towers.find(t => t.id === towerId); if (!t) return { ok:false, err:'no_tower' };
  if (t.owner !== userId) return { ok:false, err:'not_owner' };
  const p = gs.players[userId]; if (!p) return { ok:false, err:'not_in_game' };
  const ref = Math.floor(t.invested * .6);
  p.gold += ref; gs.towers = gs.towers.filter(x => x !== t);
  const np = findPath(gs.towers);
  if (np) { gs.globalPath = np; gs.pathSet = new Set(np.map(([r,c]) => `${r},${c}`)); }
  rerouteEnemies(gs);
  return { ok:true, ref, player:p };
}

function actionStartWave(gs, userId) {
  return startWave(gs) ? { ok:true } : { ok:false, err:'wave_active' };
}

// ── State snapshot for broadcast ─────────────────────────
function getSnapshot(gs) {
  return {
    gameTime: gs.gameTime,
    wave: gs.wave,
    waveActive: gs.waveActive,
    gameOver: gs.gameOver,
    gameOverWin: gs._gameOverWin,
    waveJustEnded: gs._waveJustEnded||false,
    waveJustStarted: gs._waveJustStarted||false,
    waveEndBonus: gs._waveEndBonus||0,
    sharedLives: gs.sharedLives,
    players: Object.fromEntries(Object.entries(gs.players).map(([id, p]) => [id, {
      ...p,
      availableTowers: p.availableTowers || getTowersForRace('standard'),
    }])),
    towers: gs.towers.map(t => ({ id:t.id, type:t.type, row:t.row, col:t.col, paths:t.paths, lastFire:t.lastFire, cd:calcStats(t).cd, owner:t.owner, invested:t.invested })),
    enemies: gs.enemies.filter(e=>!e.dead&&!e.escaped).map(e => ({
      id:e.id, type:e.type, col:e.col, szF:e.szF,
      hp:e.hp, maxHp:e.maxHp, isAir:e.isAir,
      px:e.isAir?e.airX:e.px, py:e.isAir?e.airY:e.py,
      armorPhys:e.armorPhys, armorMagic:e.armorMagic,
      poison:e.poison?true:false, slow:e.slow&&e.slow.until>gs.gameTime?true:false,
      fire:e.fire&&e.fire.until>gs.gameTime?true:false,
    })),
    bullets: gs.bullets.map(b => ({ id:b.id, kind:b.kind, x:b.x, y:b.y })),
    particles: gs.particles.map(p => ({ x:p.x, y:p.y, r:p.r, life:p.life, maxLife:p.maxLife, col:p.col, vx:p.vx, vy:p.vy })),
    bolts: gs.bolts.map(b => ({ x1:b.x1,y1:b.y1,x2:b.x2,y2:b.y2,life:b.life,maxLife:b.maxLife })),
    fireZones: gs.fireZones.map(f => ({ x:f.x,y:f.y,r:f.r,until:f.until,dur:f.dur })),
    pathSet: [...gs.pathSet],
    globalPath: gs.globalPath,
  };
}

module.exports = {
  COLS, ROWS, ENTRY_COL, TILE, TDB, EBASE, EBASE_HP,
  RACES, getTowersForRace,
  createGame, tick, getSnapshot,
  actionPlaceTower, actionUpgradePath, actionSellTower, actionStartWave,
  calcStats, getUpgradeCost, findPath,
};
