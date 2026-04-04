import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';

const TOP_MODES = [
  { key:'vs',          icon:'⚔️',  label:'VS' },
  { key:'coop',        icon:'🤝',  label:'TD' },
  { key:'time_attack', icon:'⏱️',  label:'Race' },
];
const SUB_MODES = {
  vs:          [{ key:'vs',          label:'VS (Standard)' }],
  coop:        [{ key:'coop',        label:'Koop' }, { key:'classic', label:'Klassisch' },
                { key:'tournament',  label:'Turnier' }, { key:'chaos', label:'Chaos' }],
  time_attack: [{ key:'time_attack', label:'Time Attack' }],
};
const MODE_MAP_COMPAT = {
  vs:'vs', coop:'td', classic:'td', tournament:'td', chaos:'td', time_attack:'time_attack',
};
const DIFFS = ['easy','normal','hard','expert','horror'];
const DIFF_LABELS = { easy:'Easy 100%', normal:'Normal 150%', hard:'Hard 200%', expert:'Expert 250%', horror:'Horror 300%' };
const BUILTIN_FALLBACK = [
  { id:'builtin_td_default', title:'Grünes Tal',   game_mode:'td',          icon:'🌿', difficulty:'normal' },
  { id:'builtin_td_desert',  title:'Wüstenpfad',   game_mode:'td',          icon:'🏜️', difficulty:'hard'   },
  { id:'builtin_vs_arena',   title:'Zentralarena', game_mode:'vs',          icon:'⚔️', difficulty:'normal' },
  { id:'builtin_ta_spiral',  title:'Spirale',       game_mode:'time_attack', icon:'🌀', difficulty:'normal' },
];

export default function LobbyList() {
  const { t }    = useTranslation();
  const navigate = useNavigate();
  const [lobbies, setLobbies]   = useState([]);
  const [creating, setCreating] = useState(false);
  const [joining,  setJoining]  = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [error,    setError]    = useState('');
  const [allMaps,  setAllMaps]  = useState(BUILTIN_FALLBACK);

  // Form state
  const [topMode,  setTopMode]  = useState('coop');
  const [subMode,  setSubMode]  = useState('coop');
  const [selMap,   setSelMap]   = useState(null);
  const [diff,     setDiff]     = useState('normal');
  const [maxP,     setMaxP]     = useState(4);
  const [name,     setName]     = useState('');
  const [pub,      setPub]      = useState(true);

  const load = () => api.get('/lobbies/public').then(r=>setLobbies(r.data)).catch(()=>{});
  useEffect(()=>{ load(); const iv=setInterval(load,8000); return()=>clearInterval(iv); },[]);
  useEffect(()=>{
    api.get('/workshop/maps/builtin')
      .then(r=>{ if(Array.isArray(r.data)&&r.data.length) setAllMaps(r.data); }).catch(()=>{});
  },[]);

  // When top mode changes, reset sub and auto-select first compatible map
  const handleTopMode = (tm) => {
    setTopMode(tm);
    const first = SUB_MODES[tm][0].key;
    setSubMode(first);
    const compat = allMaps.filter(m=>m.game_mode===MODE_MAP_COMPAT[first]||
      (first==='coop'&&m.game_mode==='td'));
    setSelMap(compat[0]||null);
  };

  const compatMaps = allMaps.filter(m=>{
    const want = MODE_MAP_COMPAT[subMode]||'td';
    return m.game_mode===want;
  });

  const create = async () => {
    setError('');
    try {
      const { data } = await api.post('/lobbies', {
        name: name.trim() || `${subMode} – ${selMap?.title||'Map'}`,
        game_mode: subMode,
        difficulty: diff,
        max_players: maxP,
        is_public: pub,
        workshop_map_config: selMap || null,
      });
      navigate(`/lobby/${data.id}`);
    } catch(e) { setError(e.response?.data?.error||'Fehler'); }
  };

  return (
    <div style={{ height:'100%', overflow:'auto' }}>
      <div className="page-header">
        <span className="page-title">🎮 {t('lobby')}</span>
        <button className="btn btn-primary btn-sm" onClick={()=>setCreating(c=>!c)}>
          + {t('create_lobby')}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={()=>setJoining(c=>!c)}>
          🔑 {t('join_by_code')}
        </button>
      </div>

      {error&&<div className="alert alert-error" style={{ margin:'0 16px 8px' }}>{error}</div>}

      {/* JOIN */}
      {joining&&(
        <div className="card" style={{ margin:'8px 16px', display:'flex', gap:8, alignItems:'flex-end' }}>
          <div className="form-group" style={{ flex:1, marginBottom:0 }}>
            <label className="form-label">{t('enter_code')}</label>
            <input className="input" value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} placeholder="ABCD" maxLength={8} />
          </div>
          <button className="btn btn-primary" onClick={async()=>{
            if(!joinCode.trim()) return;
            try{ const{data}=await api.post(`/lobbies/join/${joinCode.trim()}`); navigate(`/lobby/${data.lobby.id}`); }
            catch(e){ setError(t(e.response?.data?.error||'error')); }
          }}>→ {t('join')}</button>
        </div>
      )}

      {/* CREATE */}
      {creating&&(
        <div className="card" style={{ margin:'8px 16px', padding:'12px 14px' }}>
          {/* Top-mode tabs: VS | TD | Race */}
          <div style={{ display:'flex', gap:0, marginBottom:10, borderBottom:'1px solid var(--border2)' }}>
            {TOP_MODES.map(m=>(
              <button key={m.key} onClick={()=>handleTopMode(m.key)} style={{
                flex:1, padding:'8px 4px', border:'none', background:'none', cursor:'pointer',
                fontFamily:'Cinzel,serif', fontWeight:800, fontSize:12,
                color:topMode===m.key?'var(--gold)':'var(--text3)',
                borderBottom:topMode===m.key?'2px solid var(--gold)':'2px solid transparent',
              }}>
                {m.icon} {m.label}
              </button>
            ))}
          </div>

          {/* Sub-mode (only for TD) */}
          {SUB_MODES[topMode].length > 1 && (
            <div className="form-group">
              <label className="form-label">Stil</label>
              <select className="input" value={subMode} onChange={e=>{ setSubMode(e.target.value);
                const compat=allMaps.filter(m=>m.game_mode===(MODE_MAP_COMPAT[e.target.value]||'td'));
                setSelMap(compat[0]||null);
              }}>
                {SUB_MODES[topMode].map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          )}

          {/* Map gallery */}
          {compatMaps.length > 0 && (
            <div className="form-group">
              <label className="form-label">🗺️ Map</label>
              <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:4 }}>
                {compatMaps.map(m=>(
                  <div key={m.id} onClick={()=>setSelMap(m)} style={{
                    flexShrink:0, width:80, textAlign:'center', cursor:'pointer',
                    padding:'7px 5px', borderRadius:8,
                    border:`2px solid ${selMap?.id===m.id?'var(--gold)':'var(--border2)'}`,
                    background:selMap?.id===m.id?'rgba(240,200,60,.1)':'var(--bg2)',
                    transition:'all .15s',
                  }}>
                    <div style={{ fontSize:20 }}>{m.icon||'🗺️'}</div>
                    <div style={{ fontSize:8, fontWeight:700, color:selMap?.id===m.id?'var(--gold)':'var(--text2)', marginTop:2, lineHeight:1.3 }}>
                      {(m.title||m.name||'?').slice(0,14)}
                    </div>
                    <div style={{ fontSize:7, color:'var(--text3)' }}>{m.difficulty||''}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Settings row */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <div className="form-group">
              <label className="form-label">Schwierigkeit</label>
              <select className="input" value={diff} onChange={e=>setDiff(e.target.value)}>
                {DIFFS.map(d=><option key={d} value={d}>{DIFF_LABELS[d]}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Max. Spieler</label>
              <select className="input" value={maxP} onChange={e=>setMaxP(+e.target.value)}>
                {[2,3,4,5,6,8].map(n=><option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Lobby-Name (optional)</label>
            <input className="input" value={name} onChange={e=>setName(e.target.value)}
              placeholder={`${subMode} – ${selMap?.title||'Map'}`} />
          </div>

          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <label style={{ fontSize:11, color:'var(--text3)', display:'flex', gap:6, alignItems:'center', flex:1 }}>
              <input type="checkbox" checked={pub} onChange={e=>setPub(e.target.checked)} />
              Öffentlich sichtbar
            </label>
            <button className="btn btn-primary" onClick={create}>✓ Lobby erstellen</button>
          </div>
        </div>
      )}

      {/* LOBBY LIST */}
      <div style={{ padding:'4px 16px 20px' }}>
        <div className="section-title" style={{ marginBottom:8 }}>Öffentliche Lobbys</div>
        {lobbies.length===0?(
          <div className="empty-state">
            <div className="empty-icon">🏰</div>
            Keine offenen Lobbys — erstelle eine neue!
          </div>
        ):(
          lobbies.map(l=>(
            <div key={l.id} onClick={()=>navigate(`/lobby/${l.id}`)} style={{
              display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
              background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:8,
              marginBottom:8, cursor:'pointer', transition:'border-color .15s',
            }}
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
              <button className="btn btn-ghost btn-sm">→</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
