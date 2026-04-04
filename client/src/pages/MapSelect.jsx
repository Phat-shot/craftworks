import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { api } from '../api';

const BUILTIN_MAPS = [
  { id:'builtin_td_default', title:'Grünes Tal',   icon:'🌿', game_mode:'td',          difficulty:'normal', description:'Klassische TD-Karte' },
  { id:'builtin_td_desert',  title:'Wüstenpfad',   icon:'🏜️', game_mode:'td',          difficulty:'hard',   description:'Schnelle Gegner, Gruppen-Spawn' },
  { id:'builtin_vs_arena',   title:'Zentralarena', icon:'⚔️', game_mode:'vs',          difficulty:'normal', description:'VS: Hauptgebäude zerstören' },
  { id:'builtin_ta_spiral',  title:'Spirale',      icon:'🌀', game_mode:'time_attack', difficulty:'normal', description:'Time Attack: Maze bauen' },
];

const RACES = {
  standard: { name:'Standard', icon:'⚔️', color:'#c0a060', desc:'Dart · Gift · Kanone' },
  orcs:     { name:'Orcs',     icon:'💀', color:'#80c020', desc:'Fleischwolf · Wurfspeer · Kriegstrommel' },
  techies:  { name:'Techies',  icon:'⚙️', color:'#60a8d0', desc:'Mörser · Elektrozaun · Raketenwerfer' },
  elemente: { name:'Elemente', icon:'🌊', color:'#40c0e0', desc:'Magmaquelle · Sturmstrudel · Eisspitze' },
  urwald:   { name:'Urwald',   icon:'🌿', color:'#40a840', desc:'Rankenfalle · Giftpilz · Mondlichtaltar' },
};

const DIFFS = ['easy','normal','hard','expert','horror'];
const DIFF_LABELS = { easy:'Easy 100%', normal:'Normal 150%', hard:'Hard 200%', expert:'Expert 250%', horror:'Horror 300%' };

export default function MapSelect() {
  const { user } = useAuth();
  const navigate  = useNavigate();
  const [maps,      setMaps]      = useState(BUILTIN_MAPS);
  const [selMap,    setSelMap]    = useState(BUILTIN_MAPS[0]);
  const [selRace,   setSelRace]   = useState('standard');
  const [selDiff,   setSelDiff]   = useState('normal');
  const [starting,  setStarting]  = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => {
    // Check if a map was pre-selected (from Workshop page)
    const pre = sessionStorage.getItem('preselect_map');
    if (pre) {
      try {
        const m = JSON.parse(pre);
        setSelMap(m);
        if (m.difficulty) setSelDiff(m.difficulty);
        sessionStorage.removeItem('preselect_map');
      } catch {}
    }
    api.get('/workshop/maps/builtin')
      .then(r => { if(Array.isArray(r.data) && r.data.length) setMaps(r.data); })
      .catch(() => {});
  }, []);

  // When map changes, set default diff from map
  useEffect(() => {
    if (selMap?.difficulty) setSelDiff(selMap.difficulty);
  }, [selMap?.id]);

  const start = () => {
    if (!selMap) return;
    setStarting(true);
    const rawMode = selMap?.game_mode || 'td';
    const mode = rawMode === 'td' ? 'solo' : rawMode;
    // workshopConfig carries map identity - difficulty/race come separately
    const workshopConfig = selMap?.config 
      ? { ...selMap.config, game_mode: rawMode }
      : { id: selMap.id, title: selMap.title, game_mode: rawMode };

    // Write everything to session — td/vs/ta-game.html will pick it up and start
    sessionStorage.setItem('mp_session', JSON.stringify({
      solo: true,
      userId: user.id,
      username: user.username,
      mode,
      difficulty: selDiff,
      race: selRace,
      workshopConfig,
    }));

    const gameUrl = rawMode === 'vs' ? '/vs-game.html'
      : rawMode === 'time_attack' ? '/ta-game.html'
      : '/td-game.html';
    window.location.href = gameUrl;
  };

  const modeLabel = { td:'🏰 Tower Defense', vs:'⚔️ VS', time_attack:'⏱️ Time Attack' };

  return (
    <div style={{ height:'100%', overflow:'auto', padding:'20px 16px' }}>
      <div style={{ maxWidth:560, margin:'0 auto' }}>
        <div style={{ fontFamily:'Cinzel,serif', fontSize:20, fontWeight:900, color:'var(--gold)', marginBottom:4 }}>
          🗡️ Einzelspieler
        </div>
        <div style={{ fontSize:11, color:'var(--text3)', marginBottom:20 }}>Map, Rasse und Schwierigkeit wählen</div>

        {error && <div className="alert alert-error" style={{ marginBottom:12 }}>{error}</div>}

        {/* Map grid */}
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:8 }}>🗺️ Map</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:10, marginBottom:20 }}>
          {maps.map(m => (
            <div key={m.id} onClick={() => setSelMap(m)} style={{
              padding:'12px 10px', borderRadius:10, cursor:'pointer', textAlign:'center',
              border:`2px solid ${selMap?.id===m.id?'var(--gold)':'var(--border2)'}`,
              background:selMap?.id===m.id?'rgba(240,200,60,.08)':'var(--bg2)',
              transition:'all .15s',
            }}>
              <div style={{ fontSize:28, marginBottom:5 }}>{m.icon||'🗺️'}</div>
              <div style={{ fontSize:11, fontWeight:800, color:selMap?.id===m.id?'var(--gold)':'var(--text)', lineHeight:1.2 }}>{m.title||m.name}</div>
              <div style={{ fontSize:9, color:'var(--text3)', marginTop:3 }}>{modeLabel[m.game_mode]||m.game_mode}</div>
              <div style={{ fontSize:8, color:'var(--text3)', marginTop:2 }}>{m.description||m.difficulty||''}</div>
            </div>
          ))}
        </div>

        {/* Race — only for TD */}
        {(selMap?.game_mode==='td'||!selMap?.game_mode) && <>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:8 }}>⚔️ Rasse</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:7, marginBottom:20 }}>
            {Object.entries(RACES).map(([key, r]) => (
              <div key={key} onClick={() => setSelRace(key)} style={{
                padding:'8px 6px', borderRadius:8, cursor:'pointer', textAlign:'center',
                border:`2px solid ${selRace===key?r.color:'var(--border2)'}`,
                background:selRace===key?`${r.color}18`:'var(--bg2)',
                transition:'all .15s',
              }}>
                <div style={{ fontSize:20 }}>{r.icon}</div>
                <div style={{ fontSize:10, fontWeight:700, color:selRace===key?r.color:'var(--text2)', marginTop:2 }}>{r.name}</div>
                <div style={{ fontSize:7, color:'var(--text3)', marginTop:1, lineHeight:1.3 }}>{r.desc}</div>
              </div>
            ))}
          </div>
        </>}

        {/* Difficulty */}
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:8 }}>⚡ Schwierigkeit</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:24 }}>
          {DIFFS.map(d => (
            <button key={d} onClick={() => setSelDiff(d)} style={{
              flex:1, minWidth:60, padding:'7px 5px', borderRadius:6, cursor:'pointer', fontSize:10, fontWeight:700,
              border:`2px solid ${selDiff===d?'var(--gold)':'var(--border2)'}`,
              background:selDiff===d?'rgba(240,200,60,.1)':'var(--bg2)',
              color:selDiff===d?'var(--gold)':'var(--text2)',
            }}>{DIFF_LABELS[d]}</button>
          ))}
        </div>

        <button onClick={start} disabled={!selMap||starting} style={{
          width:'100%', padding:'14px', fontFamily:'Cinzel,serif', fontSize:14, fontWeight:900,
          background:'linear-gradient(180deg,rgba(60,160,20,.5),rgba(30,100,10,.4))',
          border:'2px solid #3a8020', color:'#80ff40', borderRadius:8, cursor:'pointer',
          opacity:(!selMap||starting)?.5:1,
        }}>
          {starting ? '⏳ Starte…' : `▶ Spielen — ${selMap?.title||'Map wählen'}`}
        </button>

        <button onClick={()=>navigate('/')} style={{
          width:'100%', marginTop:8, padding:'8px', background:'none',
          border:'none', color:'var(--text3)', cursor:'pointer', fontSize:12,
        }}>← Zurück</button>
      </div>
    </div>
  );
}
