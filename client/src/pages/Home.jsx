import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../App';
import { api } from '../api';
import Avatar from '../components/Avatar';
import { useServerVersion } from '../hooks/useServerVersion';

const BUILTIN_FALLBACK = [
  { id:'builtin_td_default', title:'Grünes Tal',   icon:'🌿', game_mode:'td',          difficulty:'normal', description:'Klassische TD-Karte' },
  { id:'builtin_td_desert',  title:'Wüstenpfad',   icon:'🏜️', game_mode:'td',          difficulty:'hard',   description:'Schnelle Gegner, Gruppen-Spawn', available_races:['standard','techies'] },
  { id:'builtin_vs_arena',   title:'Zentralarena', icon:'⚔️', game_mode:'vs',          difficulty:'normal', description:'VS: Kommandozentrale zerstören' },
  { id:'builtin_ta_spiral',  title:'Spirale',      icon:'🌀', game_mode:'time_attack', difficulty:'normal', description:'Time Attack: Maze bauen', rounds:10 },
  { id:'builtin_ta_spiral_3d', title:'Spirale 3D', icon:'🌐', game_mode:'time_attack', difficulty:'normal', description:'Time Attack: 3D', rounds:10, available_races:['standard'] },
  { id:'builtin_ar_ops', title:'AR Ops', icon:'🛰️', game_mode:'ar_ops', description:'Hide & Seek im echten Gelände — nur Multiplayer', mp_only:true },
];

const RACES = {
  standard: { name:'Standard', icon:'⚔️', color:'#c0a060', td_towers:['dart','poison','splash','frost','lightning'], ta_blocks:['wall_block','slow_block'] },
  orcs:     { name:'Orcs',     icon:'💀', color:'#80c020', td_towers:['fleischwolf','wurfspeer','kriegstrommel','frost','lightning'], ta_blocks:['wall_block','spike_block'] },
  techies:  { name:'Techies',  icon:'⚙️', color:'#60a8d0', td_towers:['mortar','electrofence','rocket','frost','lightning'], ta_blocks:['wall_block','mine_block'] },
  elemente: { name:'Elemente', icon:'🌊', color:'#40c0e0', td_towers:['magma','storm','icepike','frost','lightning'], ta_blocks:['wall_block','freeze_block'] },
  urwald:   { name:'Urwald',   icon:'🌿', color:'#40a840', td_towers:['vinetrap','poisonshroom','moonaltar','frost','lightning'], ta_blocks:['wall_block','root_block'] },
};
const GEN_FACTIONS = {
  gla:   { name:'GLA',   icon:'☠️', color:'#c09020' },
  usa:   { name:'USA',   icon:'🦅', color:'#4090e0' },
  china: { name:'China', icon:'🐉', color:'#e02010' },
};
const DIFF_LABELS = { easy:'Easy 100%', normal:'Normal 150%', hard:'Hard 200%', expert:'Expert 250%', horror:'Horror 300%' };
const MODE_LABEL  = { td:'🏰 TD', vs:'⚔️ VS', time_attack:'⏱️ TA', pve:'🤖 PvE', ar_ops:'🛰️ AR' };
const MAIN_MAP_IDS = ['builtin_ta_spiral_3d', 'builtin_ar_ops'];

export function Home() {
  const { user } = useAuth();
  const { t }    = useTranslation();
  const navigate = useNavigate();
  const version  = useServerVersion();
  const [maps, setMaps]       = useState(BUILTIN_FALLBACK);
  const [lobbies, setLobbies] = useState([]);
  const [search, setSearch]   = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showJoin, setShowJoin] = useState(false);
  const [selectedMap, setSelectedMap] = useState(null);
  const [error, setError] = useState('');

  // Settings
  const [selRace, setSelRace]     = useState('standard');
  const [selDiff, setSelDiff]     = useState('normal');
  const [selRounds, setSelRounds] = useState(10);
  const [maxP, setMaxP]           = useState(4);
  const [lobbyName, setLobbyName] = useState('');
  const [pub, setPub]             = useState(true);
  const [starting, setStarting]   = useState(false);

  useEffect(() => {
    api.get('/workshop/maps/builtin')
      .then(r => { if (Array.isArray(r.data) && r.data.length) {
        const builtinIds = new Set(r.data.map(m=>m.id));
        const merged = [...r.data, ...BUILTIN_FALLBACK.filter(m=>!builtinIds.has(m.id))];
        setMaps(merged);
      }})
      .catch(()=>{});
    api.get('/workshop/maps/mine')
      .then(r => { if (Array.isArray(r.data) && r.data.length) {
        setMaps(prev => {
          const ids = new Set(prev.map(m=>m.id));
          return [...prev, ...r.data.filter(m=>!ids.has(m.id))];
        });
      }})
      .catch(()=>{});
  }, []);

  const loadLobbies = () => api.get('/lobbies/public').then(r=>setLobbies(r.data||[])).catch(()=>{});
  useEffect(() => {
    loadLobbies();
    const iv = setInterval(loadLobbies, 8000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!selectedMap) return;
    const isVS = selectedMap.game_mode === 'vs';
    const pool = isVS
      ? Object.keys(GEN_FACTIONS)
      : (selectedMap.available_races?.filter(r => RACES[r]) || Object.keys(RACES));
    const defaultRace = pool[0] || (isVS ? 'gla' : 'standard');
    setSelRace(defaultRace);
    if (selectedMap.difficulty) setSelDiff(selectedMap.difficulty);
    if (selectedMap.rounds) setSelRounds(selectedMap.rounds);
    setLobbyName(`${selectedMap.title || selectedMap.name} — ${user?.username || 'Spiel'}`);
  }, [selectedMap?.id, user?.username]);

  const isVS = selectedMap?.game_mode === 'vs';
  const isTA = selectedMap?.game_mode === 'time_attack';
  const isAR = selectedMap?.game_mode === 'ar_ops';
  const isTD = selectedMap && !isVS && !isTA && !isAR;
  const racePool = isVS ? GEN_FACTIONS : RACES;
  const allowedRaces = isVS
    ? Object.keys(GEN_FACTIONS)
    : (selectedMap?.available_races?.filter(r => RACES[r]) || Object.keys(RACES));

  const buildWorkshopConfig = (map) => {
    const baseCfg = map?.config || {};
    const srcLayout = baseCfg.ta_layout || {};
    return {
      ...baseCfg,
      id: map.id, title: map.title, game_mode: map.game_mode,
      bg_style: map.bg_style || baseCfg.bg_style || 'grass',
      ta_layout: map.game_mode === 'time_attack' ? {
        cols: map.cols || srcLayout.cols || 35,
        rows: map.rows || srcLayout.rows || 50,
        rounds: selRounds,
        gold_per_round: srcLayout.gold_per_round ?? 15,
        wood_per_round: srcLayout.wood_per_round ?? 2,
        round_selection: srcLayout.round_selection || 'random',
        prebuilt_towers: srcLayout.prebuilt_towers || [],
        prebuilt_sequences: [],
      } : undefined,
      available_races: map.available_races || Object.keys(isVS ? GEN_FACTIONS : RACES),
      td_towers: RACES[selRace]?.td_towers || ['dart','poison','splash','frost','lightning'],
      ta_blocks: RACES[selRace]?.ta_blocks || ['wall_block','slow_block'],
      renderer: map?.config?.renderer || undefined,
    };
  };

  const startSolo = () => {
    if (!selectedMap) return;
    setStarting(true);
    const rawMode = selectedMap.game_mode || 'td';
    const mode2 = rawMode === 'td' ? 'solo' : rawMode;
    const workshopConfig = buildWorkshopConfig(selectedMap);
    sessionStorage.setItem('mp_session', JSON.stringify({
      solo: true, userId: user.id, username: user.username,
      mode: mode2, difficulty: selDiff, race: selRace, workshopConfig,
    }));
    const is3D = workshopConfig?.renderer === 'threejs' || selectedMap?.id?.endsWith('_3d');
    const gameUrl = rawMode === 'vs' ? '/vs-game.html'
      : rawMode === 'time_attack' ? (is3D ? '/ta-game-3d.html' : '/ta-game.html')
      : '/td-game.html';
    window.location.href = gameUrl;
  };

  const startMP = async () => {
    if (!selectedMap) return;
    setStarting(true);
    setError('');
    try {
      const subMode = selectedMap.game_mode === 'ar_ops' ? 'ar_ops'
        : selectedMap.game_mode === 'td' ? 'coop'
        : selectedMap.game_mode === 'vs' ? 'vs'
        : 'time_attack';
      const { data } = await api.post('/lobbies', {
        name: (lobbyName || `${selectedMap.title} — ${user?.username || 'Spiel'}`).trim(),
        game_mode: subMode,
        difficulty: selDiff,
        max_players: maxP,
        is_public: pub,
        workshop_map_config: selectedMap,
      });
      navigate(`/lobby/${data.id}`);
    } catch (e) {
      setError(e.response?.data?.error || 'Fehler');
      setStarting(false);
    }
  };

  const joinByCode = async () => {
    if (!joinCode.trim()) return;
    try {
      const { data } = await api.post(`/lobbies/join/${joinCode.trim()}`);
      navigate(`/lobby/${data.lobby.id}`);
    } catch (e) { setError(t(e.response?.data?.error || 'error')); }
  };

  const filteredLobbies = lobbies.filter(l => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (l.name || '').toLowerCase().includes(s)
      || (l.game_mode || '').toLowerCase().includes(s)
      || (l.difficulty || '').toLowerCase().includes(s);
  });

  return (
    <div style={{ height:'100%', overflow:'auto' }}>
      <div style={{ maxWidth:680, margin:'0 auto', padding:'20px 16px 32px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:8 }}>
          <Avatar user={user} size="lg" />
          <div style={{ flex:1 }}>
            <div style={{ fontSize:18, fontWeight:800, color:'var(--text)' }}>{user?.username}</div>
            <div style={{ color:'var(--text3)', fontSize:11 }}>● {t('online')}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={()=>navigate('/friends')}>👥</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>navigate('/leaderboard')}>🏆</button>
        </div>
        {version && <div style={{ textAlign:'right', color:'var(--text3)', fontSize:9, marginBottom:16 }}>v{version}</div>}

        {error && <div className="alert alert-error" style={{ marginBottom:12 }}>{error}</div>}

        {/* MAP GALLERY — main: Spirale 3D + AR Ops; everything else lives in the dev area */}
        <div style={{ fontFamily:'Cinzel,serif', fontSize:14, fontWeight:800, color:'var(--gold)', marginBottom:8 }}>
          🗺️ Karte wählen
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:10, marginBottom:16 }}>
          {maps.filter(m => MAIN_MAP_IDS.includes(m.id)).map(m => (
            <div key={m.id} onClick={()=>setSelectedMap(m)} style={{
              padding:'12px 10px', borderRadius:10, cursor:'pointer', textAlign:'center',
              border:`2px solid ${selectedMap?.id===m.id?'var(--gold)':'var(--border2)'}`,
              background:selectedMap?.id===m.id?'rgba(240,200,60,.08)':'var(--bg2)',
              transition:'all .15s',
            }}>
              <div style={{ fontSize:26, marginBottom:4 }}>{m.icon||'🗺️'}</div>
              <div style={{ fontSize:11, fontWeight:800, color:selectedMap?.id===m.id?'var(--gold)':'var(--text)' }}>{m.title||m.name}</div>
              <div style={{ fontSize:9, color:'var(--text3)', marginTop:3 }}>{MODE_LABEL[m.game_mode]||m.game_mode}</div>
              <div style={{ fontSize:8, color:'var(--text3)', marginTop:2, lineHeight:1.3 }}>{m.description||''}</div>
            </div>
          ))}
        </div>

        {/* DEV AREA — collapsed by default, visually muted */}
        <details style={{ marginBottom:24 }}>
          <summary style={{ fontSize:11, color:'var(--text3)', cursor:'pointer', userSelect:'none', padding:'4px 0' }}>
            🧪 Dev-Bereich ({maps.filter(m => !MAIN_MAP_IDS.includes(m.id)).length} weitere Spiele)
          </summary>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))', gap:8, marginTop:8, opacity:.75 }}>
            {maps.filter(m => !MAIN_MAP_IDS.includes(m.id)).map(m => (
              <div key={m.id} onClick={()=>setSelectedMap(m)} style={{
                padding:'8px 8px', borderRadius:8, cursor:'pointer', textAlign:'center',
                border:`1.5px solid ${selectedMap?.id===m.id?'var(--gold)':'var(--border2)'}`,
                background:selectedMap?.id===m.id?'rgba(240,200,60,.08)':'var(--bg2)',
              }}>
                <div style={{ fontSize:20, marginBottom:2 }}>{m.icon||'🗺️'}</div>
                <div style={{ fontSize:10, fontWeight:700, color:selectedMap?.id===m.id?'var(--gold)':'var(--text2)' }}>{m.title||m.name}</div>
                <div style={{ fontSize:8, color:'var(--text3)', marginTop:2 }}>{MODE_LABEL[m.game_mode]||m.game_mode}</div>
              </div>
            ))}
          </div>
        </details>

        {/* SETTINGS PANEL */}
        {selectedMap && (
          <div style={{
            background:'linear-gradient(135deg,#1a1a14,#0e0e08)',
            border:'2px solid var(--gold)', borderRadius:12, padding:16,
            marginBottom:24, boxShadow:'0 4px 20px rgba(0,0,0,.4)',
          }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div style={{ fontFamily:'Cinzel,serif', fontSize:15, fontWeight:900, color:'var(--gold)' }}>
                {selectedMap.icon} {selectedMap.title}
              </div>
              <button onClick={()=>setSelectedMap(null)} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>

            {/* Race (not for AR Ops) */}
            {!isAR && (<>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:6 }}>{isVS ? '🎖️ Fraktion' : '⚔️ Rasse'}</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, marginBottom:14 }}>
              {allowedRaces.map(key => {
                const r = racePool[key]; if (!r) return null;
                const sel = selRace === key;
                return (
                  <div key={key} onClick={()=>setSelRace(key)} style={{
                    padding:'8px 6px', borderRadius:7, cursor:'pointer', textAlign:'center',
                    border:`2px solid ${sel?r.color:'var(--border2)'}`,
                    background:sel?`${r.color}18`:'var(--bg2)',
                  }}>
                    <div style={{ fontSize:18 }}>{r.icon}</div>
                    <div style={{ fontSize:10, fontWeight:700, color:sel?r.color:'var(--text2)', marginTop:2 }}>{r.name}</div>
                  </div>
                );
              })}
            </div>
            </>)}

            {isTA && (
              <>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:6 }}>🔄 Runden</div>
                <div style={{ display:'flex', gap:5, marginBottom:12 }}>
                  {[3,5,7,10].map(n=>(
                    <button key={n} onClick={()=>setSelRounds(n)} style={{
                      flex:1, padding:'6px 4px', borderRadius:5, cursor:'pointer', fontSize:12, fontWeight:700,
                      border:`2px solid ${selRounds===n?'var(--gold)':'var(--border2)'}`,
                      background:selRounds===n?'rgba(240,200,60,.1)':'var(--bg2)',
                      color:selRounds===n?'var(--gold)':'var(--text2)',
                    }}>{n}</button>
                  ))}
                </div>
              </>
            )}

            {isTD && (
              <>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:6 }}>⚡ Schwierigkeit</div>
                <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:12 }}>
                  {Object.entries(DIFF_LABELS).map(([d,l])=>(
                    <button key={d} onClick={()=>setSelDiff(d)} style={{
                      flex:1, minWidth:54, padding:'6px 4px', borderRadius:5, cursor:'pointer', fontSize:9, fontWeight:700,
                      border:`2px solid ${selDiff===d?'var(--gold)':'var(--border2)'}`,
                      background:selDiff===d?'rgba(240,200,60,.1)':'var(--bg2)',
                      color:selDiff===d?'var(--gold)':'var(--text2)',
                    }}>{l}</button>
                  ))}
                </div>
              </>
            )}

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--text2)', marginBottom:4 }}>Max. Spieler (MP)</div>
                <select className="input" value={maxP} onChange={e=>setMaxP(+e.target.value)} style={{padding:'6px 8px', fontSize:12}}>
                  {[2,3,4,5,6,8].map(n=><option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--text2)', marginBottom:4 }}>Sichtbar (MP)</div>
                <label style={{ display:'flex', gap:6, alignItems:'center', padding:'7px 8px', background:'var(--bg2)', borderRadius:6, fontSize:11, cursor:'pointer' }}>
                  <input type="checkbox" checked={pub} onChange={e=>setPub(e.target.checked)} />
                  Öffentlich
                </label>
              </div>
            </div>

            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--text2)', marginBottom:4 }}>Lobby-Name (MP, optional)</div>
              <input className="input" value={lobbyName} onChange={e=>setLobbyName(e.target.value)}
                placeholder={`${selectedMap.title} — ${user?.username || 'Spiel'}`}
                style={{padding:'7px 9px', fontSize:12}} />
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <button onClick={startSolo} disabled={starting || isAR} title={isAR ? 'AR Ops ist nur im Multiplayer spielbar' : undefined} style={{
                padding:'12px', fontFamily:'Cinzel,serif', fontSize:13, fontWeight:900,
                background:'linear-gradient(180deg,rgba(60,160,20,.6),rgba(30,100,10,.5))',
                border:'2px solid #3a8020', color:'#80ff40', borderRadius:8, cursor:'pointer',
                opacity:(starting||isAR)?0.4:1, cursor:(starting||isAR)?'default':'pointer',
              }}>
                🗡️ Solo starten
              </button>
              <button onClick={startMP} disabled={starting} style={{
                padding:'12px', fontFamily:'Cinzel,serif', fontSize:13, fontWeight:900,
                background:'linear-gradient(180deg,rgba(160,60,200,.6),rgba(100,30,140,.5))',
                border:'2px solid #803aa0', color:'#e060ff', borderRadius:8, cursor:'pointer',
                opacity:starting?0.5:1,
              }}>
                ⚔️ Lobby (MP)
              </button>
            </div>
          </div>
        )}

        {/* JOIN BY CODE */}
        <div style={{ marginBottom:14 }}>
          {!showJoin ? (
            <button onClick={()=>setShowJoin(true)} style={{
              width:'100%', padding:'10px', background:'var(--bg2)', border:'1px solid var(--border2)',
              borderRadius:8, color:'var(--text2)', fontSize:12, fontWeight:700, cursor:'pointer',
            }}>🔑 Lobby-Code eingeben</button>
          ) : (
            <div style={{ display:'flex', gap:6 }}>
              <input className="input" value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())}
                placeholder="ABCD" maxLength={8}
                style={{ flex:1, padding:'8px 10px', fontSize:13, textAlign:'center', fontFamily:'monospace', letterSpacing:'0.2em' }} />
              <button className="btn btn-primary" onClick={joinByCode}>→ {t('join')}</button>
              <button className="btn btn-ghost btn-sm" onClick={()=>{setShowJoin(false); setJoinCode('');}}>✕</button>
            </div>
          )}
        </div>

        {/* LOBBY LIST WITH SEARCH */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <div style={{ fontFamily:'Cinzel,serif', fontSize:13, fontWeight:800, color:'var(--text2)' }}>
            🏰 Offene Lobbys
            {lobbies.length > 0 && <span style={{color:'var(--text3)', fontSize:11, fontWeight:400, marginLeft:6}}>({filteredLobbies.length}/{lobbies.length})</span>}
          </div>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="🔍 Suchen…"
            style={{ width:120, padding:'5px 8px', fontSize:11, background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:6, color:'var(--text)' }} />
        </div>

        {filteredLobbies.length === 0 ? (
          <div style={{ padding:'18px', textAlign:'center', background:'var(--bg2)', borderRadius:8, border:'1px dashed var(--border2)' }}>
            <div style={{ fontSize:28, marginBottom:6 }}>🏰</div>
            <div style={{ fontSize:11, color:'var(--text3)' }}>
              {lobbies.length === 0
                ? 'Keine offenen Lobbys — wähle eine Karte zum Erstellen!'
                : 'Keine Lobbys passen zur Suche.'}
            </div>
          </div>
        ) : (
          filteredLobbies.map(l => (
            <div key={l.id} onClick={()=>navigate(`/lobby/${l.id}`)} style={{
              display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
              background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:8,
              marginBottom:6, cursor:'pointer', transition:'border-color .15s',
            }}
              onMouseEnter={e=>e.currentTarget.style.borderColor='var(--gold)'}
              onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border2)'}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:700, fontSize:13, color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{l.name}</div>
                <div style={{ display:'flex', gap:5, marginTop:3, flexWrap:'wrap' }}>
                  <span className={`lobby-badge badge-${l.game_mode}`}>{t(l.game_mode)}</span>
                  <span className={`lobby-badge badge-${l.difficulty}`}>{t(l.difficulty)}</span>
                  <span style={{ fontSize:10, color:'var(--text3)', alignSelf:'center' }}>👤 {l.member_count||1}/{l.max_players}</span>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm">→</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
export default Home;
