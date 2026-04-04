import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';

// ── Constants ──────────────────────────────────────────────────
const MODES = [
  { key:'vs',           icon:'⚔️',  label:'VS',           sub:'RTS: Gebäude bauen, Einheiten schicken, Hauptgebäude zerstören',  styles:['default'] },
  { key:'coop',         icon:'🤝',  label:'TD Koop',      sub:'Bounty & Waves geteilt — gemeinsam eine Karte verteidigen',      styles:['classic','tournament','chaos'] },
  { key:'classic',      icon:'🏛️',  label:'TD Klassisch', sub:'Jeder Spieler startet die Wave zusammen',                        styles:['classic'] },
  { key:'time_attack',  icon:'⏱️',  label:'Race',         sub:'Time Attack: Maze bauen, Minion möglichst verlangsamen',         styles:['default'] },
  { key:'tournament',   icon:'🏆',  label:'TD Turnier',   sub:'Nächste Wave startet 15s nach eigenem Abschluss',               styles:['tournament'] },
  { key:'chaos',        icon:'💀',  label:'TD Chaos',     sub:'Waves starten automatisch — auch wenn die vorherige läuft!',     styles:['chaos'] },
];

const STYLE_LABELS = {
  default:'Standard', classic:'Klassisch', tournament:'Turnier', chaos:'Chaos',
};

const DIFFS = ['easy','normal','hard','expert','horror'];
const DIFF_LABELS = { easy:'Easy 100%', normal:'Normal 150%', hard:'Hard 200%', expert:'Expert 250%', horror:'Horror 300%' };

const BUILTIN_MAPS_FALLBACK = [
  { id:'builtin_td_default', title:'Grünes Tal',   game_mode:'td',          icon:'🌿', difficulty:'normal', description:'Klassische TD-Karte' },
  { id:'builtin_td_desert',  title:'Wüstenpfad',   game_mode:'td',          icon:'🏜️', difficulty:'hard',   description:'Schnelle Gegner' },
  { id:'builtin_vs_arena',   title:'Zentralarena', game_mode:'vs',          icon:'⚔️', difficulty:'normal', description:'4 Spieler, Fog of War' },
  { id:'builtin_ta_spiral',  title:'Spirale',       game_mode:'time_attack', icon:'🌀', difficulty:'normal', description:'5 Runden, steigendes Budget' },
];

// Maps a lobby game_mode to which game modes match
const MODE_MAP_COMPAT = {
  vs: ['vs'], coop: ['td'], classic: ['td'], tournament: ['td'], chaos: ['td'], time_attack: ['time_attack'],
};

export default function LobbyList() {
  const { t }       = useTranslation();
  const navigate    = useNavigate();
  const [lobbies, setLobbies]     = useState([]);
  const [creating, setCreating]   = useState(false);
  const [joining,  setJoining]    = useState(false);
  const [joinCode, setJoinCode]   = useState('');
  const [error, setError]         = useState('');

  // Create form state
  const [step, setStep]           = useState(0); // 0=mode, 1=map, 2=settings
  const [selMode, setSelMode]     = useState(MODES[0]);
  const [selStyle, setSelStyle]   = useState('default');
  const [selMap, setSelMap]       = useState(null);
  const [allMaps, setAllMaps]     = useState(BUILTIN_MAPS_FALLBACK);
  const [form, setForm]           = useState({ name:'', difficulty:'normal', max_players:4, is_public:true });

  const load = () => api.get('/lobbies/public').then(r=>setLobbies(r.data)).catch(()=>{});

  useEffect(()=>{
    load();
    const iv=setInterval(load,8000);
    return()=>clearInterval(iv);
  },[]);

  useEffect(()=>{
    api.get('/workshop/maps/builtin')
      .then(r=>{ if(Array.isArray(r.data)&&r.data.length) setAllMaps(r.data); })
      .catch(()=>{});
  },[]);

  // Auto-select first compatible map when mode changes
  useEffect(()=>{
    const compat = MODE_MAP_COMPAT[selMode.key]||['td'];
    const first = allMaps.find(m=>compat.includes(m.game_mode));
    setSelMap(first||null);
    setSelStyle(selMode.styles[0]);
  },[selMode, allMaps]);

  const compatMaps = allMaps.filter(m=>(MODE_MAP_COMPAT[selMode.key]||['td']).includes(m.game_mode));

  const create = async () => {
    setError('');
    try {
      const payload = {
        name: form.name.trim() || `${selMode.label} – ${selMap?.title||'Map'}`,
        game_mode: selMode.key,
        difficulty: form.difficulty,
        max_players: form.max_players,
        is_public: form.is_public,
        workshop_map_config: selMap?.config || selMap || null,
      };
      const { data } = await api.post('/lobbies', payload);
      navigate(`/lobby/${data.id}`);
    } catch(e) { setError(e.response?.data?.error||'Fehler'); }
  };

  const joinByCode = async () => {
    if (!joinCode.trim()) return;
    try {
      const { data } = await api.post(`/lobbies/join/${joinCode.trim().toUpperCase()}`);
      navigate(`/lobby/${data.lobby.id}`);
    } catch(e) { setError(t(e.response?.data?.error||'error')); }
  };

  const ModeCard = ({ mode }) => (
    <div onClick={()=>setSelMode(mode)} style={{
      padding:'10px 12px', borderRadius:9, cursor:'pointer',
      border:`2px solid ${selMode.key===mode.key?'var(--gold)':'var(--border2)'}`,
      background:selMode.key===mode.key?'rgba(240,200,60,.08)':'var(--bg2)',
      transition:'all .15s',
    }}>
      <div style={{ fontSize:22, marginBottom:3 }}>{mode.icon}</div>
      <div style={{ fontSize:12, fontWeight:800, color:selMode.key===mode.key?'var(--gold)':'var(--text)' }}>{mode.label}</div>
      <div style={{ fontSize:9, color:'var(--text3)', marginTop:3, lineHeight:1.4 }}>{mode.sub}</div>
    </div>
  );

  const MapCard = ({ map }) => {
    const sel = selMap?.id===map.id;
    return (
      <div onClick={()=>setSelMap(map)} style={{
        flexShrink:0, width:90, textAlign:'center', cursor:'pointer',
        padding:'8px 5px', borderRadius:8,
        border:`2px solid ${sel?'var(--gold)':'var(--border2)'}`,
        background:sel?'rgba(240,200,60,.1)':'var(--bg2)',
        transition:'all .15s',
      }}>
        <div style={{ fontSize:22 }}>{map.icon||'🗺️'}</div>
        <div style={{ fontSize:9, fontWeight:700, color:sel?'var(--gold)':'var(--text2)', marginTop:2, lineHeight:1.3 }}>
          {(map.title||map.name||'?').slice(0,14)}
        </div>
        <div style={{ fontSize:7, color:'var(--text3)', marginTop:1 }}>{map.difficulty||''}</div>
      </div>
    );
  };

  return (
    <div style={{ height:'100%', overflow:'auto' }}>
      <div className="page-header">
        <span className="page-title">🎮 {t('lobby')}</span>
        <button className="btn btn-primary btn-sm" onClick={()=>{setCreating(c=>!c);setStep(0);}}>
          + {t('create_lobby')}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={()=>setJoining(c=>!c)}>🔑 {t('join_by_code')}</button>
      </div>

      {error&&<div className="alert alert-error" style={{ margin:'0 16px' }}>{error}</div>}

      {/* ── JOIN BY CODE ── */}
      {joining&&(
        <div className="card" style={{ margin:'10px 16px', display:'flex', gap:8, alignItems:'flex-end' }}>
          <div className="form-group" style={{ flex:1, marginBottom:0 }}>
            <label className="form-label">{t('enter_code')}</label>
            <input className="input" value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABCD" maxLength={8} />
          </div>
          <button className="btn btn-primary" onClick={joinByCode}>→ {t('join')}</button>
        </div>
      )}

      {/* ── CREATE FLOW ── */}
      {creating&&(
        <div className="card" style={{ margin:'10px 16px', padding:'14px 16px' }}>
          {/* Step indicator */}
          <div style={{ display:'flex', gap:0, marginBottom:16, borderBottom:'1px solid var(--border2)' }}>
            {[['Modus','0'],['Map','1'],['Einstellungen','2']].map(([l,s],i)=>(
              <button key={i} onClick={()=>setStep(i)} style={{
                flex:1, padding:'6px', border:'none', background:'none', cursor:'pointer',
                fontFamily:'Cinzel,serif', fontSize:10, fontWeight:700,
                color:step===i?'var(--gold)':'var(--text3)',
                borderBottom:step===i?'2px solid var(--gold)':'2px solid transparent',
              }}>
                {i+1}. {l}
              </button>
            ))}
          </div>

          {/* Step 0: Mode */}
          {step===0&&(
            <div>
              <div style={{ fontSize:11, color:'var(--text3)', marginBottom:10 }}>Spielmodus wählen</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:14 }}>
                {MODES.map(m=><ModeCard key={m.key} mode={m} />)}
              </div>
              <button className="btn btn-primary" style={{ width:'100%' }} onClick={()=>setStep(1)}>
                Weiter: Map wählen →
              </button>
            </div>
          )}

          {/* Step 1: Map */}
          {step===1&&(
            <div>
              <div style={{ fontSize:11, color:'var(--text3)', marginBottom:8 }}>
                {selMode.icon} {selMode.label} — Map wählen
              </div>
              {compatMaps.length===0?(
                <div style={{ fontSize:11, color:'var(--text3)', padding:'12px 0' }}>
                  Keine kompatiblen Maps für diesen Modus.
                </div>
              ):(
                <div style={{ display:'flex', gap:8, overflowX:'auto', paddingBottom:8, marginBottom:12 }}>
                  {compatMaps.map(m=><MapCard key={m.id} map={m} />)}
                </div>
              )}
              {selMap&&(
                <div style={{ fontSize:10, color:'var(--text3)', marginBottom:12, padding:'6px 10px', background:'rgba(240,200,60,.06)', borderRadius:5 }}>
                  🗺️ {selMap.icon} <strong style={{ color:'var(--gold)' }}>{selMap.title||selMap.name}</strong>
                  {selMap.description&&<span> — {selMap.description}</span>}
                </div>
              )}
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn btn-ghost" onClick={()=>setStep(0)}>← Zurück</button>
                <button className="btn btn-primary" style={{ flex:1 }} onClick={()=>setStep(2)} disabled={!selMap}>
                  Weiter: Einstellungen →
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Settings */}
          {step===2&&(
            <div>
              <div style={{ fontSize:11, color:'var(--text3)', marginBottom:10 }}>
                {selMode.icon} {selMode.label} · {selMap?.icon} {selMap?.title||selMap?.name}
              </div>
              <div className="form-group">
                <label className="form-label">Lobby-Name</label>
                <input className="input" value={form.name}
                  onChange={e=>setForm(f=>({...f,name:e.target.value}))}
                  placeholder={`${selMode.label} – ${selMap?.title||'Map'}`} />
              </div>

              {/* Style picker (only if mode has multiple styles) */}
              {selMode.styles.length>1&&(
                <div className="form-group">
                  <label className="form-label">Stil</label>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {selMode.styles.map(s=>(
                      <button key={s} onClick={()=>setSelStyle(s)} style={{
                        padding:'5px 12px', borderRadius:5, cursor:'pointer', fontSize:11, fontWeight:700,
                        border:`2px solid ${selStyle===s?'var(--gold)':'var(--border2)'}`,
                        background:selStyle===s?'rgba(240,200,60,.1)':'var(--bg2)',
                        color:selStyle===s?'var(--gold)':'var(--text2)',
                      }}>{STYLE_LABELS[s]||s}</button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <div className="form-group">
                  <label className="form-label">Schwierigkeit</label>
                  <select className="input" value={form.difficulty} onChange={e=>setForm(f=>({...f,difficulty:e.target.value}))}>
                    {DIFFS.map(d=><option key={d} value={d}>{DIFF_LABELS[d]||d}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Max. Spieler</label>
                  <select className="input" value={form.max_players} onChange={e=>setForm(f=>({...f,max_players:+e.target.value}))}>
                    {[2,3,4,5,6,8].map(n=><option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Sichtbarkeit</label>
                  <select className="input" value={form.is_public} onChange={e=>setForm(f=>({...f,is_public:e.target.value==='true'}))}>
                    <option value="true">Öffentlich</option>
                    <option value="false">Privat</option>
                  </select>
                </div>
              </div>

              <div style={{ display:'flex', gap:8, marginTop:4 }}>
                <button className="btn btn-ghost" onClick={()=>setStep(1)}>← Zurück</button>
                <button className="btn btn-primary" style={{ flex:1 }} onClick={create}>
                  ✓ Lobby erstellen
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PUBLIC LOBBY LIST ── */}
      <div style={{ padding:'6px 16px 20px' }}>
        <div className="section-title" style={{ marginBottom:8 }}>Öffentliche Lobbys</div>
        {lobbies.length===0?(
          <div className="empty-state">
            <div className="empty-icon">🏰</div>
            Keine offenen Lobbys — erstelle eine neue!
          </div>
        ):(
          lobbies.map(l=>(
            <div key={l.id} className="lobby-item" onClick={()=>navigate(`/lobby/${l.id}`)}
              style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
                background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:8,
                marginBottom:8, cursor:'pointer', transition:'border-color .15s' }}
              onMouseEnter={e=>e.currentTarget.style.borderColor='var(--gold)'}
              onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border2)'}>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, fontSize:13, color:'var(--text)' }}>{l.name}</div>
                <div style={{ display:'flex', gap:5, marginTop:3, flexWrap:'wrap' }}>
                  <span className={`lobby-badge badge-${l.game_mode}`}>{t(l.game_mode)}</span>
                  <span className={`lobby-badge badge-${l.difficulty}`}>{t(l.difficulty)}</span>
                  <span style={{ fontSize:10, color:'var(--text3)', alignSelf:'center' }}>
                    👤 {l.member_count||1}/{l.max_players}
                  </span>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm">Beitreten →</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
