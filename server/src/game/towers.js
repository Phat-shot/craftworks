'use strict';
// ═══════════════════════════════════════════════════════
//  ALL TOWER DEFINITIONS — 5 races × 3-5 towers
//  Each tower: 3 upgrade paths × 5 levels
// ═══════════════════════════════════════════════════════

const RACES = {
  standard: { name: 'Standard',   icon: '⚔️',  color: '#c0a060' },
  orcs:     { name: 'Orcs',       icon: '💀',  color: '#80c020' },
  techies:  { name: 'Techies',    icon: '⚙️',  color: '#60a8d0' },
  elemente: { name: 'Elemente',   icon: '🌊',  color: '#40c0e0' },
  urwald:   { name: 'Urwald',     icon: '🌿',  color: '#40a840' },
};
// Universal specials: available to every race in TD mode (unlock W10/W20)
const UNIVERSAL_SPECIALS = ['frost', 'lightning'];

const TDB = {

  // ═══════════════════════════════════════════════════
  //  STANDARD RACE (original 5 towers)
  // ═══════════════════════════════════════════════════
  dart: {
    race:'standard', name:'Dart', cost:75, col:'#3ab8ff',
    baseRange:3.5, baseCd:460, baseDmg:20, dmgType:'phys',
    basePierce:0, canHitAir:true, unlock:0,
    paths:[
      { id:'range',  name:'Reichweite',  icon:'🎯', upgrades:[
        {desc:'+0.4T Reichw.',  cost:55,  rangeDelta:0.4},
        {desc:'+0.7T Reichw.',  cost:88,  rangeDelta:0.7},
        {desc:'+1.0T Reichw.',  cost:130, rangeDelta:1.0},
        {desc:'+1.4T Reichw.',  cost:188, rangeDelta:1.4},
        {desc:'+2.0T Reichw.',  cost:265, rangeDelta:2.0}]},
      { id:'pierce', name:'Durchschlag', icon:'➡️', upgrades:[
        {desc:'Pierce ×1',      cost:55,  pierce:1},
        {desc:'Pierce ×2',      cost:88,  pierce:1},
        {desc:'Pierce ×3',      cost:130, pierce:1},
        {desc:'Pierce ×5',      cost:188, pierce:2},
        {desc:'Pierce ×8',      cost:265, pierce:3}]},
      { id:'dmg',    name:'Schaden',     icon:'⚔️', upgrades:[
        {desc:'+10 Dmg',        cost:50,  dmg:10},
        {desc:'+18 Dmg',        cost:80,  dmg:18},
        {desc:'+28 Dmg',        cost:115, dmg:28},
        {desc:'+40 Dmg',        cost:165, dmg:40},
        {desc:'+55 Dmg',        cost:230, dmg:55}]}
    ]},

  poison: {
    race:'standard', name:'Gift', cost:100, col:'#44d040',
    baseRange:3.0, baseCd:1800, baseDmg:8, dmgType:'magic',
    baseDotDmg:7, baseDotTicks:5, baseDotInt:700, baseSlowPct:0.14,
    canHitAir:true, unlock:0,
    paths:[
      { id:'vir',    name:'Virulenz',    icon:'☠️', upgrades:[
        {desc:'DoT ×1.3',       cost:60,  dotMult:1.3},
        {desc:'DoT ×1.7',       cost:95,  dotMult:1.7},
        {desc:'DoT ×2.2',       cost:140, dotMult:2.2},
        {desc:'DoT ×3.0',       cost:200, dotMult:3.0},
        {desc:'DoT ×4.0',       cost:280, dotMult:4.0}]},
      { id:'acid',   name:'Säure',       icon:'🧪', upgrades:[
        {desc:'−5% Rüstg.',     cost:70,  armorShred:0.05},
        {desc:'−10% Rüstg.',    cost:110, armorShred:0.10},
        {desc:'−18% Rüstg.',    cost:165, armorShred:0.18},
        {desc:'−28% Rüstg.',    cost:235, armorShred:0.28},
        {desc:'−40% Rüstg.',    cost:325, armorShred:0.40}]},
      { id:'spread', name:'Ausbreitung', icon:'🦠', upgrades:[
        {desc:'20% Ausbreit.',  cost:65,  spreadChance:0.20},
        {desc:'35% Ausbreit.',  cost:105, spreadChance:0.35},
        {desc:'50% Ausbreit.',  cost:155, spreadChance:0.50},
        {desc:'70% Ausbreit.',  cost:220, spreadChance:0.70},
        {desc:'90% Ausbreit.',  cost:310, spreadChance:0.90}]}
    ]},

  splash: {
    race:'standard', name:'Kanone', cost:125, col:'#ff7820',
    baseRange:2.8, baseCd:1600, baseDmg:48, dmgType:'expl',
    baseSplashR:0.9, canHitAir:false, unlock:0,
    paths:[
      { id:'nap',    name:'Napalm',       icon:'🔥', upgrades:[
        {desc:'Feuer 2s',       cost:85,  fireDur:2000, fireDmg:4},
        {desc:'Feuer 3s',       cost:135, fireDur:3000, fireDmg:7},
        {desc:'Feuer 4s',       cost:200, fireDur:4000, fireDmg:11},
        {desc:'Feuer 6s',       cost:285, fireDur:6000, fireDmg:16},
        {desc:'Feuer 8s',       cost:395, fireDur:8000, fireDmg:22}]},
      { id:'clust',  name:'Clusterbombe', icon:'💥', upgrades:[
        {desc:'2 Mini-Bomben',  cost:90,  clusterN:2},
        {desc:'3 Mini-Bomben',  cost:145, clusterN:3},
        {desc:'4 Mini-Bomben',  cost:215, clusterN:4},
        {desc:'6 Mini-Bomben',  cost:305, clusterN:6},
        {desc:'8 Mini-Bomben',  cost:420, clusterN:8}]},
      { id:'pow',    name:'Sprengkraft',  icon:'💣', upgrades:[
        {desc:'+16 Dmg',        cost:70,  dmg:16},
        {desc:'+28 Dmg',        cost:110, dmg:28},
        {desc:'+42 Dmg',        cost:160, dmg:42},
        {desc:'+58 Dmg',        cost:225, dmg:58},
        {desc:'+80 Dmg',        cost:315, dmg:80}]}
    ]},

  lightning: {
    race:'universal', name:'Blitz', cost:200, col:'#ffe840',
    baseRange:4.0, baseCd:860, baseDmg:62, dmgType:'magic',
    baseChains:3, baseDecay:0.62, unlock:20, canHitAir:true,
    paths:[
      { id:'volt',   name:'Spannung',     icon:'⚡', upgrades:[
        {desc:'+22 Dmg',        cost:90,  dmg:22},
        {desc:'+38 Dmg',        cost:140, dmg:38},
        {desc:'+56 Dmg',        cost:205, dmg:56},
        {desc:'+78 Dmg',        cost:290, dmg:78},
        {desc:'+105 Dmg',       cost:400, dmg:105}]},
      { id:'chain',  name:'Ketten',       icon:'🔗', upgrades:[
        {desc:'+1 Sprung',      cost:95,  chains:1},
        {desc:'+2 Sprünge',     cost:150, chains:2},
        {desc:'+3 Sprünge',     cost:220, chains:3},
        {desc:'+4 Sprünge',     cost:310, chains:4},
        {desc:'+6 Sprünge',     cost:430, chains:6}]},
      { id:'over',   name:'Überspannung', icon:'🌩️', upgrades:[
        {desc:'×3 alle 5',      cost:100, overN:5},
        {desc:'×3 alle 4',      cost:160, overN:4},
        {desc:'×3 alle 3',      cost:240, overN:3},
        {desc:'×3 alle 2',      cost:335, overN:2},
        {desc:'×3 jeden',       cost:460, overN:1}]}
    ]},

  frost: {
    race:'universal', name:'Frost', cost:175, col:'#80eeff',
    baseRange:3.6, baseCd:1150, baseDmg:18, dmgType:'magic',
    baseSlowFrac:0.50, baseSlowDur:2600, unlock:10, canHitAir:true,
    paths:[
      { id:'deep',   name:'Tiefkühlung',  icon:'🧊', upgrades:[
        {desc:'Slow 55%',       cost:80,  slowFrac:0.55},
        {desc:'Slow 62%',       cost:125, slowFrac:0.62},
        {desc:'Slow 68%',       cost:185, slowFrac:0.68},
        {desc:'Slow 72%',       cost:265, slowFrac:0.72},
        {desc:'Slow 75%',       cost:360, slowFrac:0.75}]},
      { id:'field',  name:'Eisfeld',      icon:'❄️', upgrades:[
        {desc:'+0.5T AoE',      cost:90,  splashR:0.5},
        {desc:'+0.9T AoE',      cost:145, splashR:0.9},
        {desc:'+1.4T AoE',      cost:215, splashR:1.4},
        {desc:'+2.0T AoE',      cost:305, splashR:2.0},
        {desc:'+2.8T AoE',      cost:420, splashR:2.8}]},
      { id:'shat',   name:'Scherbeis',    icon:'💎', upgrades:[
        {desc:'+5% Shatbonus',  cost:80,  shatBonus:0.05},
        {desc:'+10%',           cost:130, shatBonus:0.10},
        {desc:'+18%',           cost:195, shatBonus:0.18},
        {desc:'+28%',           cost:275, shatBonus:0.28},
        {desc:'+40%',           cost:380, shatBonus:0.40}]}
    ]},

  // ═══════════════════════════════════════════════════
  //  ORCS
  // ═══════════════════════════════════════════════════
  fleischwolf: {
    race:'orcs', name:'Fleischwolf', cost:110, col:'#e04020',
    baseRange:1.5, baseCd:600, baseDmg:55, dmgType:'phys',
    baseSplashR:1.4, isSpinAoe:true, canHitAir:false, unlock:0,
    desc:'Melee-Kreisel: trifft alle Gegner in kurzer Reichweite gleichzeitig',
    paths:[
      { id:'blut',   name:'Blutgier',     icon:'🩸', upgrades:[
        {desc:'+20 Dmg',        cost:70,  dmg:20},
        {desc:'+35 Dmg',        cost:110, dmg:35},
        {desc:'+55 Dmg',        cost:160, dmg:55},
        {desc:'+80 Dmg',        cost:225, dmg:80},
        {desc:'+110 Dmg',       cost:310, dmg:110}]},
      { id:'wirbel', name:'Wirbelwind',   icon:'🌀', upgrades:[
        {desc:'+0.4T AoE',      cost:80,  splashR:0.4},
        {desc:'+0.7T AoE',      cost:130, splashR:0.7},
        {desc:'+1.0T AoE',      cost:190, splashR:1.0},
        {desc:'+1.5T AoE',      cost:270, splashR:1.5},
        {desc:'+2.0T AoE',      cost:370, splashR:2.0}]},
      { id:'rage',   name:'Raserei',      icon:'💢', upgrades:[
        {desc:'−10% CD',        cost:65,  cdDelta:0.10},
        {desc:'−18% CD',        cost:105, cdDelta:0.18},
        {desc:'−28% CD',        cost:155, cdDelta:0.28},
        {desc:'−38% CD',        cost:220, cdDelta:0.38},
        {desc:'−50% CD',        cost:305, cdDelta:0.50}]}
    ]},

  wurfspeer: {
    race:'orcs', name:'Wurfspeer', cost:90, col:'#c06020',
    baseRange:5.0, baseCd:1100, baseDmg:35, dmgType:'phys',
    basePierce:2, canHitAir:true, unlock:0,
    desc:'Langer Reichweite, durchbohrt Gegner, reißt Rüstung auf',
    paths:[
      { id:'wucht',  name:'Wucht',        icon:'💪', upgrades:[
        {desc:'+12 Dmg',        cost:55,  dmg:12},
        {desc:'+22 Dmg',        cost:88,  dmg:22},
        {desc:'+35 Dmg',        cost:130, dmg:35},
        {desc:'+50 Dmg',        cost:185, dmg:50},
        {desc:'+70 Dmg',        cost:260, dmg:70}]},
      { id:'riss',   name:'Rüstungsriss', icon:'🛡️', upgrades:[
        {desc:'−8% Rüstg.',     cost:65,  armorShred:0.08},
        {desc:'−15% Rüstg.',    cost:105, armorShred:0.15},
        {desc:'−25% Rüstg.',    cost:155, armorShred:0.25},
        {desc:'−38% Rüstg.',    cost:220, armorShred:0.38},
        {desc:'−50% Rüstg.',    cost:305, armorShred:0.50}]},
      { id:'ziel',   name:'Zielkunst',    icon:'🏹', upgrades:[
        {desc:'+0.8T Reichw.',  cost:60,  rangeDelta:0.8},
        {desc:'+1.4T Reichw.',  cost:95,  rangeDelta:1.4},
        {desc:'Pierce ×2',      cost:140, pierce:2},
        {desc:'+2.0T Reichw.',  cost:200, rangeDelta:2.0},
        {desc:'Pierce ×4',      cost:275, pierce:4}]}
    ]},

  kriegstrommel: {
    race:'orcs', name:'Kriegstrommel', cost:150, col:'#a05010',
    baseRange:3.0, baseCd:99999, baseDmg:0, dmgType:'phys',
    isAura:true, auraAttackSpeed:0.15, canHitAir:false, unlock:0,
    desc:'Aura: benachbarte Tower schießen 15% schneller',
    paths:[
      { id:'beat',   name:'Trommelbeat',  icon:'🥁', upgrades:[
        {desc:'Aura +5% Speed', cost:85,  auraSpeed:0.05},
        {desc:'Aura +8% Speed', cost:135, auraSpeed:0.08},
        {desc:'Aura +12%',      cost:200, auraSpeed:0.12},
        {desc:'Aura +17%',      cost:280, auraSpeed:0.17},
        {desc:'Aura +25%',      cost:390, auraSpeed:0.25}]},
      { id:'war',    name:'Kriegsruf',    icon:'📯', upgrades:[
        {desc:'+5% Dmg Aura',   cost:90,  auraDmg:0.05},
        {desc:'+10% Dmg Aura',  cost:145, auraDmg:0.10},
        {desc:'+16% Dmg Aura',  cost:215, auraDmg:0.16},
        {desc:'+24% Dmg Aura',  cost:305, auraDmg:0.24},
        {desc:'+35% Dmg Aura',  cost:420, auraDmg:0.35}]},
      { id:'radius', name:'Reichweite',   icon:'🔊', upgrades:[
        {desc:'+0.5T Radius',   cost:70,  rangeDelta:0.5},
        {desc:'+0.8T Radius',   cost:115, rangeDelta:0.8},
        {desc:'+1.2T Radius',   cost:170, rangeDelta:1.2},
        {desc:'+1.8T Radius',   cost:240, rangeDelta:1.8},
        {desc:'+2.5T Radius',   cost:335, rangeDelta:2.5}]}
    ]},

  // ═══════════════════════════════════════════════════
  //  TECHIES
  // ═══════════════════════════════════════════════════
  moerser: {
    race:'techies', name:'Mörser', cost:140, col:'#a0a0a0',
    baseRange:5.5, baseCd:2200, baseDmg:80, dmgType:'expl',
    baseSplashR:1.5, blindSpot:1.5, canHitAir:false, unlock:0,
    desc:'Hohe Reichweite, große Explosion, kann nahe Ziele nicht treffen',
    paths:[
      { id:'kaliber',name:'Kaliber',      icon:'💣', upgrades:[
        {desc:'+30 Dmg',        cost:90,  dmg:30},
        {desc:'+55 Dmg',        cost:140, dmg:55},
        {desc:'+85 Dmg',        cost:205, dmg:85},
        {desc:'+120 Dmg',       cost:290, dmg:120},
        {desc:'+165 Dmg',       cost:400, dmg:165}]},
      { id:'radius_m',name:'Splitterzone',icon:'💥', upgrades:[
        {desc:'+0.5T Splash',   cost:80,  splashR:0.5},
        {desc:'+1.0T Splash',   cost:130, splashR:1.0},
        {desc:'+1.5T Splash',   cost:195, splashR:1.5},
        {desc:'+2.0T Splash',   cost:275, splashR:2.0},
        {desc:'+2.8T Splash',   cost:380, splashR:2.8}]},
      { id:'feuer_m', name:'Brandsatz',   icon:'🔥', upgrades:[
        {desc:'Feuer 3s',       cost:100, fireDur:3000, fireDmg:6},
        {desc:'Feuer 5s',       cost:160, fireDur:5000, fireDmg:10},
        {desc:'Feuer 7s',       cost:235, fireDur:7000, fireDmg:16},
        {desc:'Feuer 10s',      cost:330, fireDur:10000,fireDmg:22},
        {desc:'Feuer 14s',      cost:460, fireDur:14000,fireDmg:30}]}
    ]},

  elektrozaun: {
    race:'techies', name:'Elektrozaun', cost:160, col:'#60d8ff',
    baseRange:3.0, baseCd:1400, baseDmg:30, dmgType:'magic',
    isRingAoe:true, canHitAir:true, unlock:0,
    desc:'Entlädt sich auf ALLE Feinde im Radius gleichzeitig',
    paths:[
      { id:'volt2',  name:'Hochspannung', icon:'⚡', upgrades:[
        {desc:'+12 Dmg',        cost:75,  dmg:12},
        {desc:'+22 Dmg',        cost:120, dmg:22},
        {desc:'+35 Dmg',        cost:175, dmg:35},
        {desc:'+50 Dmg',        cost:250, dmg:50},
        {desc:'+70 Dmg',        cost:345, dmg:70}]},
      { id:'schock', name:'Schockwelle',  icon:'🌊', upgrades:[
        {desc:'+0.5T Radius',   cost:85,  rangeDelta:0.5},
        {desc:'+0.8T Radius',   cost:135, rangeDelta:0.8},
        {desc:'+1.2T Radius',   cost:200, rangeDelta:1.2},
        {desc:'+1.7T Radius',   cost:280, rangeDelta:1.7},
        {desc:'+2.3T Radius',   cost:390, rangeDelta:2.3}]},
      { id:'stun',   name:'Betäubung',   icon:'😵', upgrades:[
        {desc:'Slow 20%',       cost:90,  slowFrac:0.20, slowDur:800},
        {desc:'Slow 35%',       cost:145, slowFrac:0.35, slowDur:1000},
        {desc:'Slow 50%',       cost:215, slowFrac:0.50, slowDur:1200},
        {desc:'Slow 60%',       cost:305, slowFrac:0.60, slowDur:1400},
        {desc:'Slow 70%',       cost:420, slowFrac:0.70, slowDur:1600}]}
    ]},

  raketenwerfer: {
    race:'techies', name:'Raketenwerfer', cost:185, col:'#e08040',
    baseRange:4.5, baseCd:800, baseDmg:45, dmgType:'expl',
    canHitAir:true, baseSplashR:0.5, unlock:0,
    desc:'Schnelle Rakete, trifft Luft- und Bodenziele, kleine Explosion',
    paths:[
      { id:'warhead',name:'Gefechtskopf', icon:'🚀', upgrades:[
        {desc:'+18 Dmg',        cost:80,  dmg:18},
        {desc:'+32 Dmg',        cost:130, dmg:32},
        {desc:'+50 Dmg',        cost:190, dmg:50},
        {desc:'+72 Dmg',        cost:270, dmg:72},
        {desc:'+100 Dmg',       cost:370, dmg:100}]},
      { id:'salve',  name:'Salvenfeuer',  icon:'🔁', upgrades:[
        {desc:'−10% CD',        cost:70,  cdDelta:0.10},
        {desc:'−18% CD',        cost:115, cdDelta:0.18},
        {desc:'−28% CD',        cost:170, cdDelta:0.28},
        {desc:'−38% CD',        cost:240, cdDelta:0.38},
        {desc:'−50% CD',        cost:335, cdDelta:0.50}]},
      { id:'cluster2',name:'Clusterkopf',icon:'💥', upgrades:[
        {desc:'2 Splitter',     cost:95,  clusterN:2},
        {desc:'3 Splitter',     cost:150, clusterN:3},
        {desc:'4 Splitter',     cost:220, clusterN:4},
        {desc:'6 Splitter',     cost:310, clusterN:6},
        {desc:'8 Splitter',     cost:430, clusterN:8}]}
    ]},

  // ═══════════════════════════════════════════════════
  //  ELEMENTE
  // ═══════════════════════════════════════════════════
  magmaquelle: {
    race:'elemente', name:'Magmaquelle', cost:130, col:'#ff4010',
    baseRange:2.5, baseCd:2000, baseDmg:25, dmgType:'expl',
    baseSplashR:1.2, canHitAir:false, unlock:0,
    desc:'Verursacht große Feuerzonen, schmilzt physische Rüstung',
    paths:[
      { id:'magma',  name:'Magmafluss',   icon:'🌋', upgrades:[
        {desc:'Feuer 4s +8dmg',  cost:85,  fireDur:4000, fireDmg:8},
        {desc:'Feuer 6s +13dmg', cost:135, fireDur:6000, fireDmg:13},
        {desc:'Feuer 9s +20dmg', cost:200, fireDur:9000, fireDmg:20},
        {desc:'Feuer 12s +28dmg',cost:285, fireDur:12000,fireDmg:28},
        {desc:'Feuer 16s +38dmg',cost:395, fireDur:16000,fireDmg:38}]},
      { id:'schmelz',name:'Schmelzhitze', icon:'♨️', upgrades:[
        {desc:'−10% phys.Rüstg.',cost:80,  armorShred:0.10},
        {desc:'−18%',            cost:130, armorShred:0.18},
        {desc:'−28%',            cost:195, armorShred:0.28},
        {desc:'−40%',            cost:275, armorShred:0.40},
        {desc:'−55%',            cost:380, armorShred:0.55}]},
      { id:'eruption',name:'Eruption',   icon:'💥', upgrades:[
        {desc:'+0.4T Splash',    cost:70,  splashR:0.4},
        {desc:'+0.8T Splash',    cost:115, splashR:0.8},
        {desc:'+1.3T Splash',    cost:170, splashR:1.3},
        {desc:'+1.9T Splash',    cost:245, splashR:1.9},
        {desc:'+2.6T Splash',    cost:340, splashR:2.6}]}
    ]},

  sturmstrudel: {
    race:'elemente', name:'Sturmstrudel', cost:155, col:'#80c0ff',
    baseRange:3.5, baseCd:1200, baseDmg:22, dmgType:'magic',
    isPull:true, pullStrength:0.4, canHitAir:true, unlock:0,
    desc:'Zieht Gegner zur Mitte — verlängert Aufenthaltszeit im Radius',
    paths:[
      { id:'sog',    name:'Sogwirkung',   icon:'🌀', upgrades:[
        {desc:'Pull +20%',      cost:80,  pullStrength:0.20},
        {desc:'Pull +35%',      cost:130, pullStrength:0.35},
        {desc:'Pull +55%',      cost:190, pullStrength:0.55},
        {desc:'Pull +80%',      cost:270, pullStrength:0.80},
        {desc:'Pull +120%',     cost:375, pullStrength:1.20}]},
      { id:'wind',   name:'Windklinge',   icon:'🌬️', upgrades:[
        {desc:'+10 Dmg',        cost:70,  dmg:10},
        {desc:'+18 Dmg',        cost:115, dmg:18},
        {desc:'+28 Dmg',        cost:170, dmg:28},
        {desc:'+40 Dmg',        cost:240, dmg:40},
        {desc:'+56 Dmg',        cost:335, dmg:56}]},
      { id:'auge',   name:'Sturmrücken',  icon:'👁️', upgrades:[
        {desc:'+0.5T Radius',   cost:75,  rangeDelta:0.5},
        {desc:'+0.9T Radius',   cost:120, rangeDelta:0.9},
        {desc:'+1.4T Radius',   cost:180, rangeDelta:1.4},
        {desc:'+2.0T Radius',   cost:255, rangeDelta:2.0},
        {desc:'+2.8T Radius',   cost:355, rangeDelta:2.8}]}
    ]},

  eisspitze: {
    race:'elemente', name:'Eisspitze', cost:175, col:'#c0f0ff',
    baseRange:4.0, baseCd:2400, baseDmg:70, dmgType:'magic',
    baseSlowFrac:0.75, baseSlowDur:3000,
    shatBonus:0.20, canHitAir:true, unlock:0,
    desc:'Mächtiger Einzelschuss — Splitterbonus auf eingefrorene Ziele',
    paths:[
      { id:'kalt',   name:'Absolute Kälte',icon:'🧊', upgrades:[
        {desc:'+25 Dmg',        cost:90,  dmg:25},
        {desc:'+45 Dmg',        cost:145, dmg:45},
        {desc:'+70 Dmg',        cost:215, dmg:70},
        {desc:'+100 Dmg',       cost:305, dmg:100},
        {desc:'+140 Dmg',       cost:420, dmg:140}]},
      { id:'split',  name:'Splitter',      icon:'💎', upgrades:[
        {desc:'Shat +15%',      cost:85,  shatBonus:0.15},
        {desc:'Shat +25%',      cost:135, shatBonus:0.25},
        {desc:'Shat +40%',      cost:200, shatBonus:0.40},
        {desc:'Shat +60%',      cost:285, shatBonus:0.60},
        {desc:'Shat +85%',      cost:395, shatBonus:0.85}]},
      { id:'permafrost',name:'Permafrost', icon:'❄️', upgrades:[
        {desc:'Slow +3s',       cost:80,  slowDurDelta:3000},
        {desc:'Slow +5s',       cost:130, slowDurDelta:5000},
        {desc:'AoE 0.8T',       cost:195, splashR:0.8},
        {desc:'AoE 1.5T',       cost:275, splashR:1.5},
        {desc:'AoE 2.2T',       cost:380, splashR:2.2}]}
    ]},

  // ═══════════════════════════════════════════════════
  //  URWALD
  // ═══════════════════════════════════════════════════
  rankenfalle: {
    race:'urwald', name:'Rankenfalle', cost:100, col:'#50d040',
    baseRange:3.2, baseCd:2500, baseDmg:30, dmgType:'phys',
    baseRootDur:1200, baseSlowFrac:0.45, baseSlowDur:2500,
    canHitAir:false, unlock:0,
    desc:'Verwurzelt Ziel kurz vollständig, dann dauerhafter Slow',
    paths:[
      { id:'wurzel', name:'Tiefwurzel',   icon:'🌿', upgrades:[
        {desc:'Root +0.5s',     cost:75,  rootDurDelta:500},
        {desc:'Root +0.8s',     cost:120, rootDurDelta:800},
        {desc:'Root +1.2s',     cost:180, rootDurDelta:1200},
        {desc:'Root +1.8s',     cost:255, rootDurDelta:1800},
        {desc:'Root +2.5s',     cost:355, rootDurDelta:2500}]},
      { id:'dornen', name:'Dornen',       icon:'🌵', upgrades:[
        {desc:'+12 Dmg',        cost:65,  dmg:12},
        {desc:'+22 Dmg',        cost:105, dmg:22},
        {desc:'+35 Dmg',        cost:155, dmg:35},
        {desc:'+50 Dmg',        cost:220, dmg:50},
        {desc:'+70 Dmg',        cost:305, dmg:70}]},
      { id:'netz',   name:'Geflecht',     icon:'🕸️', upgrades:[
        {desc:'+0.5T Radius',   cost:70,  rangeDelta:0.5},
        {desc:'AoE 0.6T',       cost:115, splashR:0.6},
        {desc:'AoE 1.0T',       cost:170, splashR:1.0},
        {desc:'AoE 1.5T',       cost:245, splashR:1.5},
        {desc:'AoE 2.2T',       cost:340, splashR:2.2}]}
    ]},

  giftpilz: {
    race:'urwald', name:'Giftpilz', cost:115, col:'#90c020',
    baseRange:3.0, baseCd:2000, baseDmg:10, dmgType:'magic',
    baseDotDmg:12, baseDotTicks:6, baseDotInt:600,
    baseSplashR:1.0, canHitAir:false, unlock:0,
    desc:'AoE Giftwolke, Sporen verbreiten sich auf nahestehende Gegner beim Tod',
    paths:[
      { id:'sporen', name:'Sporenwolke',  icon:'🍄', upgrades:[
        {desc:'DoT ×1.4',       cost:70,  dotMult:1.4},
        {desc:'DoT ×2.0',       cost:110, dotMult:2.0},
        {desc:'DoT ×2.8',       cost:165, dotMult:2.8},
        {desc:'DoT ×3.8',       cost:235, dotMult:3.8},
        {desc:'DoT ×5.0',       cost:325, dotMult:5.0}]},
      { id:'ausbreit2',name:'Ausbreitung',icon:'🦠', upgrades:[
        {desc:'30% Spread',     cost:75,  spreadChance:0.30},
        {desc:'50% Spread',     cost:120, spreadChance:0.50},
        {desc:'70% Spread',     cost:180, spreadChance:0.70},
        {desc:'85% Spread',     cost:255, spreadChance:0.85},
        {desc:'99% Spread',     cost:355, spreadChance:0.99}]},
      { id:'nebel',  name:'Giftnebel',   icon:'💨', upgrades:[
        {desc:'+0.5T AoE',      cost:65,  splashR:0.5},
        {desc:'+0.9T AoE',      cost:105, splashR:0.9},
        {desc:'+1.3T AoE',      cost:158, splashR:1.3},
        {desc:'+1.8T AoE',      cost:225, splashR:1.8},
        {desc:'+2.5T AoE',      cost:315, splashR:2.5}]}
    ]},

  mondlichtaltar: {
    race:'urwald', name:'Mondlichtaltar', cost:200, col:'#d0d0ff',
    baseRange:4.0, baseCd:99999, baseDmg:0, dmgType:'magic',
    isHealAura:true, healRate:0.002, damageReduction:0.05,
    canHitAir:false, unlock:0,
    desc:'Aura: regeneriert Leben (0.2%/s), reduziert Schaden an Leben um 5%',
    paths:[
      { id:'mond',   name:'Mondlicht',    icon:'🌙', upgrades:[
        {desc:'Heal ×1.5',      cost:100, healMult:1.5},
        {desc:'Heal ×2.2',      cost:160, healMult:2.2},
        {desc:'Heal ×3.0',      cost:235, healMult:3.0},
        {desc:'Heal ×4.0',      cost:330, healMult:4.0},
        {desc:'Heal ×5.5',      cost:460, healMult:5.5}]},
      { id:'schild', name:'Mondschild',   icon:'🛡️', upgrades:[
        {desc:'−3% Dmg an Hp',  cost:90,  dmgRedDelta:0.03},
        {desc:'−5% Dmg an Hp',  cost:145, dmgRedDelta:0.05},
        {desc:'−8% Dmg an Hp',  cost:215, dmgRedDelta:0.08},
        {desc:'−12% Dmg an Hp', cost:305, dmgRedDelta:0.12},
        {desc:'−18% Dmg an Hp', cost:420, dmgRedDelta:0.18}]},
      { id:'radius2',name:'Heilradius',   icon:'✨', upgrades:[
        {desc:'+0.8T Radius',   cost:80,  rangeDelta:0.8},
        {desc:'+1.3T Radius',   cost:130, rangeDelta:1.3},
        {desc:'+1.9T Radius',   cost:195, rangeDelta:1.9},
        {desc:'+2.7T Radius',   cost:275, rangeDelta:2.7},
        {desc:'+3.7T Radius',   cost:380, rangeDelta:3.7}]}
    ]},
};

// Tower lists by race
const TOWERS_BY_RACE = {};
for (const [id, t] of Object.entries(TDB)) {
  if (!TOWERS_BY_RACE[t.race]) TOWERS_BY_RACE[t.race] = [];
  TOWERS_BY_RACE[t.race].push(id);
}

// All tower IDs a player can access given their race choice
// Everyone gets: their race's 3 towers + universal specials (Frost W10, Blitz W20)
// Standard race gets: Dart + Gift + Kanone + universal specials
function getTowersForRace(race) {
  const raceTowers = TOWERS_BY_RACE[race] || [];
  return [...raceTowers, ...UNIVERSAL_SPECIALS];
}

module.exports = { RACES, TDB, TOWERS_BY_RACE, UNIVERSAL_SPECIALS, getTowersForRace };
