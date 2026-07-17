import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { api } from '../api';

const BUILTIN_MAPS = [
  { id:'builtin_td_default', title:'Grünes Tal',   icon:'🌿', game_mode:'td',          difficulty:'normal', description:'Klassische TD-Karte',               bg_style:'grass'  },
  { id:'builtin_td_desert',  title:'Wüstenpfad',   icon:'🏜️', game_mode:'td',          difficulty:'hard',   description:'Schnelle Gegner, Gruppen-Spawn',    bg_style:'desert', available_races:['standard','techies'] },
  { id:'builtin_vs_arena',   title:'Zentralarena', icon:'⚔️', game_mode:'vs',          difficulty:'normal', description:'VS: Kommandozentrale zerstören'    },
  { id:'builtin_ta_spiral',  title:'Spirale',      icon:'🌀', game_mode:'time_attack', difficulty:'normal', description:'Time Attack: Maze bauen',           rounds:10 },
  { id:'builtin_ta_spiral_3d', title:'Spirale 3D', icon:'🌐', game_mode:'time_attack', difficulty:'normal', description:'Time Attack: 3D Low-Poly', rounds:10, available_races:['standard'] },
];

const RACES = {
  standard: { name:'Standard', icon:'⚔️', color:'#c0a060', desc:'Dart · Gift · Kanone',                    td_towers:['dart','poison','splash','frost','lightning'], ta_blocks:['wall_block','slow_block'] },
  orcs:     { name:'Orcs',     icon:'💀', color:'#80c020', desc:'Fleischwolf · Wurfspeer · Kriegstrommel', td_towers:['fleischwolf','wurfspeer','kriegstrommel','frost','lightning'], ta_blocks:['wall_block','spike_block'] },
  techies:  { name:'Techies',  icon:'⚙️', color:'#60a8d0', desc:'Mörser · Elektrozaun · Raketenwerfer',   td_towers:['mortar','electrofence','rocket','frost','lightning'], ta_blocks:['wall_block','mine_block'] },
  elemente: { name:'Elemente', icon:'🌊', color:'#40c0e0', desc:'Magmaquelle · Sturmstrudel · Eisspitze',  td_towers:['magma','storm','icepike','frost','lightning'], ta_blocks:['wall_block','freeze_block'] },
  urwald:   { name:'Urwald',   icon:'🌿', color:'#40a840', desc:'Rankenfalle · Giftpilz · Mondlichtaltar', td_towers:['vinetrap','poisonshroom','moonaltar','frost','lightning'], ta_blocks:['wall_block','root_block'] },
};

// C&C Generals factions for VS mode
const GEN_FACTIONS = {
  gla:   { name:'GLA',   icon:'☠️', color:'#c09020', desc:'Guerilla · Tunnel · SCUD · Kein Strom' },
  usa:   { name:'USA',   icon:'🦅', color:'#4090e0', desc:'Technologie · Luftmacht · Partikelkanone' },
  china: { name:'China', icon:'🐉', color:'#e02010', desc:'Panzermassen · Propaganda · Atombombe' },
};

const DIFF_LABELS = { easy:'Easy 100%', normal:'Normal 150%', hard:'Hard 200%', expert:'Expert 250%', horror:'Horror 300%' };
const MODE_LABEL  = { td:'🏰 Tower Defense', vs:'⚔️ VS', time_attack:'⏱️ Time Attack', pve:'🤖 PvE' };

export default function MapSelect() {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  const [maps,     setMaps]     = useState(BUILTIN_MAPS);
  const [selMap,   setSelMap]   = useState(null);
  const [selRace,  setSelRace]  = useState('gla');
  const [selDiff,  setSelDiff]  = useState('normal');
  const [selRounds,setRounds]   = useState(10);
  const [starting, setStarting] = useState(false);

  const mode    = selMap?.game_mode || 'td';
  const isVS    = mode === 'vs';
  const isTA    = mode === 'time_attack';
  const isTD    = !isVS && !isTA;
  const showRace    = true;
  const showDiff    = isTD;
  const showRounds  = isTA;

  // Available races: VS → generals, else map-specific or all
  const racePool   = isVS ? GEN_FACTIONS : RACES;
  const allowedKeys = isVS
    ? Object.keys(GEN_FACTIONS)
    : (selMap?.available_races?.filter(r => RACES[r]) || Object.keys(RACES));

  useEffect(() => {
    const pre = sessionStorage.getItem('preselect_map');
    let preMap = null;
    if (pre) {
      try { preMap = JSON.parse(pre); sessionStorage.removeItem('preselect_map'); } catch {}
    }
    const loadMaps = async () => {
      try {
        const [builtinRes, mineRes] = await Promise.all([
          api.get('/workshop/maps/builtin').catch(() => ({ data: [] })),
          api.get('/workshop/maps/mine').catch(()   => ({ data: [] })),
        ]);
        const builtins = Array.isArray(builtinRes.data) && builtinRes.data.length ? builtinRes.data : BUILTIN_MAPS;
        const mine     = Array.isArray(mineRes.data) ? mineRes.data : [];
        const combined = [...builtins, ...mine.filter(m => !builtins.find(b => b.id === m.id))];
        setMaps(combined);
        const initial = preMap ? (combined.find(m => m.id === preMap.id) || preMap) : combined[0];
        if (initial) { setSelMap(initial); if (initial.difficulty) setSelDiff(initial.difficulty); }
      } catch {
        setSelMap(preMap || BUILTIN_MAPS[0]);
      }
    };
    loadMaps();
  }, []);

  // When map changes: reset race
  // Reset race whenever map changes to ensure correct pool is picked
  useEffect(() => {
    if (!selMap) return;
    const newIsVS = selMap.game_mode === 'vs';
    const pool = newIsVS
      ? Object.keys(GEN_FACTIONS)
      : (selMap.available_races?.filter(r => RACES[r]) || Object.keys(RACES));
    // Always pick first available race for the new map
    const defaultRace = pool[0] || (newIsVS ? 'gla' : 'standard');
    if (!pool.includes(selRace)) setSelRace(defaultRace);
    if (selMap.difficulty) setSelDiff(selMap.difficulty);
    if (selMap.rounds)     setRounds(selMap.rounds);
  }, [selMap?.id, selMap?.game_mode]);

  const start = () => {
    if (!selMap) return;
    setStarting(true);
    const rawMode = selMap.game_mode || 'td';
    const mode2   = rawMode === 'td' ? 'solo' : rawMode;
    const baseCfg = selMap?.config || {};
    const srcLayout = baseCfg.ta_layout || {};
    const workshopConfig = {
      ...baseCfg,
      id: selMap.id, title: selMap.title, game_mode: rawMode,
      bg_style: selMap.bg_style || baseCfg.bg_style || 'grass',
      ta_layout: rawMode === 'time_attack' ? {
        cols: selMap.cols || srcLayout.cols || 35,
        rows: selMap.rows || srcLayout.rows || 50,
        rounds: selRounds,
        gold_per_round: srcLayout.gold_per_round ?? 15,
        wood_per_round: srcLayout.wood_per_round ?? 2,
        round_selection: srcLayout.round_selection || 'random',
        prebuilt_towers: srcLayout.prebuilt_towers || [],
        prebuilt_sequences: [],   // server injects from builtin-maps.js
      } : undefined,
      available_races: selMap.available_races || Object.keys(isVS ? GEN_FACTIONS : RACES),
      td_towers: RACES[selRace]?.td_towers || ['dart','poison','splash','frost','lightning'],
      ta_blocks: RACES[selRace]?.ta_blocks || ['wall_block','slow_block'],
      renderer: selMap?.config?.renderer || undefined,
    };
    sessionStorage.setItem('mp_session', JSON.stringify({
      solo: true, userId: user.id, username: user.username,
      mode: mode2, difficulty: selDiff, race: selRace, workshopConfig,
    }));
    const is3D = workshopConfig?.renderer === 'threejs' || selMap?.id?.endsWith('_3d');
    const gameUrl = rawMode === 'vs' ? '/vs-game.html'
      : rawMode === 'time_attack' ? (is3D ? '/ta-game-3d.html' : '/ta-game.html')
      : '/td-game.html';
    window.location.href = gameUrl;
  };

  if (!selMap) return <div className="loading-screen">⏳ Lädt…</div>;

  return (
    <div style={{ height:'100%', overflow:'auto', padding:'20px 16px' }}>
      <div style={{ maxWidth:680, margin:'0 auto' }}>
        <div style={{ fontFamily:'Cinzel,serif', fontSize:20, fontWeight:900, color:'var(--gold)', marginBottom:2 }}>🗡️ Einzelspieler</div>
        <div style={{ fontSize:11, color:'var(--text3)', marginBottom:20 }}>Map, Rasse und Schwierigkeit wählen</div>

        {/* Map */}
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:8 }}>🗺️ Map</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:10, marginBottom:20 }}>
          {maps.map(m => (
            <div key={m.id} onClick={()=>setSelMap(m)} style={{
              padding:'12px 10px', borderRadius:10, cursor:'pointer', textAlign:'center',
              border:`2px solid ${selMap?.id===m.id?'var(--gold)':'var(--border2)'}`,
              background:selMap?.id===m.id?'rgba(240,200,60,.08)':'var(--bg2)',
            }}>
              <div style={{ fontSize:26, marginBottom:4 }}>{m.icon||'🗺️'}</div>
              <div style={{ fontSize:11, fontWeight:800, color:selMap?.id===m.id?'var(--gold)':'var(--text)' }}>{m.title||m.name}</div>
              <div style={{ fontSize:9, color:'var(--text3)', marginTop:3 }}>{MODE_LABEL[m.game_mode]||m.game_mode}</div>
              <div style={{ fontSize:8, color:'var(--text3)', marginTop:2, lineHeight:1.3 }}>{m.description||''}</div>
            </div>
          ))}
        </div>

        {/* Race / Faction */}
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:8 }}>
          {isVS ? '🎖️ Fraktion' : '⚔️ Rasse'}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:7, marginBottom:16 }}>
          {allowedKeys.map(key => {
            const r = racePool[key]; if (!r) return null;
            const sel = selRace === key;
            return (
              <div key={key} onClick={()=>setSelRace(key)} style={{
                padding:'10px 8px', borderRadius:8, cursor:'pointer', textAlign:'center',
                border:`2px solid ${sel?r.color:'var(--border2)'}`,
                background:sel?`${r.color}18`:'var(--bg2)',
              }}>
                <div style={{ fontSize:22 }}>{r.icon}</div>
                <div style={{ fontSize:11, fontWeight:700, color:sel?r.color:'var(--text2)', marginTop:3 }}>{r.name}</div>
                <div style={{ fontSize:8, color:'var(--text3)', marginTop:2, lineHeight:1.4 }}>{r.desc}</div>
              </div>
            );
          })}
        </div>

        {/* Rounds (TA) */}
        {showRounds && (
          <>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:8 }}>🔄 Runden</div>
            <div style={{ display:'flex', gap:6, marginBottom:16 }}>
              {[3,5,7,10].map(n=>(
                <button key={n} onClick={()=>setRounds(n)} style={{
                  flex:1, padding:'7px 5px', borderRadius:6, cursor:'pointer',
                  fontSize:13, fontWeight:700,
                  border:`2px solid ${selRounds===n?'var(--gold)':'var(--border2)'}`,
                  background:selRounds===n?'rgba(240,200,60,.1)':'var(--bg2)',
                  color:selRounds===n?'var(--gold)':'var(--text2)',
                }}>{n}</button>
              ))}
            </div>
          </>
        )}

        {/* Difficulty (TD/PvE) */}
        {showDiff && (
          <>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:8 }}>⚡ Schwierigkeit</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:20 }}>
              {Object.entries(DIFF_LABELS).map(([d,l])=>(
                <button key={d} onClick={()=>setSelDiff(d)} style={{
                  flex:1, minWidth:60, padding:'7px 5px', borderRadius:6,
                  cursor:'pointer', fontSize:10, fontWeight:700,
                  border:`2px solid ${selDiff===d?'var(--gold)':'var(--border2)'}`,
                  background:selDiff===d?'rgba(240,200,60,.1)':'var(--bg2)',
                  color:selDiff===d?'var(--gold)':'var(--text2)',
                }}>{l}</button>
              ))}
            </div>
          </>
        )}

        <button onClick={start} disabled={!selMap||starting} style={{
          width:'100%', padding:'14px', fontFamily:'Cinzel,serif', fontSize:14, fontWeight:900,
          background:'linear-gradient(180deg,rgba(60,160,20,.5),rgba(30,100,10,.4))',
          border:'2px solid #3a8020', color:'#80ff40', borderRadius:8, cursor:'pointer',
          opacity:(!selMap||starting)?0.5:1, marginBottom:8,
        }}>
          {starting ? '⏳ Starte…' : `▶ Spielen — ${selMap?.title||'Map wählen'}`}
        </button>
        <button onClick={()=>navigate('/')} style={{ width:'100%', padding:'8px', background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:12 }}>
          ← Zurück
        </button>
      </div>
    </div>
  );
}
