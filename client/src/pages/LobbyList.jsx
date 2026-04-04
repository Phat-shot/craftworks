// src/pages/LobbyList.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';

const MODES = ['coop','classic','tournament','chaos'];
const DIFFS = ['easy','normal','hard','expert','horror'];

export function LobbyList() {
  const { t }      = useTranslation();
  const navigate   = useNavigate();
  const [lobbies,  setLobbies]  = useState([]);
  const [creating, setCreating] = useState(false);
  const [joining,  setJoining]  = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [form, setForm] = useState({ name: '', game_mode: 'coop', difficulty: 'normal', max_players: 4, is_public: true });
  const [error, setError] = useState('');
  const [builtinMaps, setBuiltinMaps] = useState([]);
  const [selectedMap, setSelectedMap] = useState(null);

  const load = () => api.get('/lobbies/public').then(r => setLobbies(r.data)).catch(()=>{});
  useEffect(() => {
    api.get('/workshop/maps/builtin')
      .then(r => { if(Array.isArray(r.data)) setBuiltinMaps(r.data); })
      .catch(() => setBuiltinMaps([
        {id:'builtin_td_default',title:'Grünes Tal',  icon:'🌿',game_mode:'td',difficulty:'normal'},
        {id:'builtin_td_desert', title:'Wüstenpfad',  icon:'🏜️',game_mode:'td',difficulty:'hard'},
        {id:'builtin_vs_arena',  title:'Zentralarena',icon:'⚔️',game_mode:'vs',difficulty:'normal'},
        {id:'builtin_ta_spiral', title:'Spirale',      icon:'🌀',game_mode:'time_attack',difficulty:'normal'},
      ]));
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv); }, []);

  const create = async () => {
    setError('');
    try {
      const { data } = await api.post('/lobbies', { ...form, workshop_map_config: selectedMap?.config || selectedMap || null });
      navigate(`/lobby/${data.id}`);
    } catch (e) { setError(e.response?.data?.error || 'error'); }
  };

  const joinByCode = async () => {
    if (!joinCode.trim()) return;
    try {
      const { data } = await api.post(`/lobbies/join/${joinCode.trim().toUpperCase()}`);
      navigate(`/lobby/${data.lobby.id}`);
    } catch (e) { setError(t(e.response?.data?.error || 'error')); }
  };

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-header">
        <span className="page-title">🎮 {t('lobby')}</span>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(c => !c)}>+ {t('create_lobby')}</button>
        <button className="btn btn-ghost btn-sm"   onClick={() => setJoining(c => !c)}>🔑 {t('join_by_code')}</button>
      </div>

      {error && <div className="alert alert-error" style={{ margin: '0 20px' }}>{error}</div>}

      {creating && (
        <div className="card" style={{ margin: '12px 20px' }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>{t('create_lobby')}</div>
          <div className="form-group">
            <label className="form-label">{t('lobby_name')}</label>
            <input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder={t('lobby_name')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="form-group">
              <label className="form-label">{t('game_mode')}</label>
              <select className="input" value={form.game_mode} onChange={e=>setForm(f=>({...f,game_mode:e.target.value}))}>
                {MODES.map(m => <option key={m} value={m}>{t(m)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('difficulty')}</label>
              <select className="input" value={form.difficulty} onChange={e=>setForm(f=>({...f,difficulty:e.target.value}))}>
                {DIFFS.map(d => <option key={d} value={d}>{t(d)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('max_players')}</label>
              <select className="input" value={form.max_players} onChange={e=>setForm(f=>({...f,max_players:+e.target.value}))}>
                {[2,3,4,5,6,8].map(n => <option key={n} value={n}>{n}</option>)}
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
          {/* Map gallery */}
          {builtinMaps.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">🗺️ Map</label>
              <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:4 }}>
                {builtinMaps.map(m => (
                  <div key={m.id} onClick={() => setSelectedMap(m)} style={{
                    flexShrink:0, width:76, padding:'6px 4px', textAlign:'center', cursor:'pointer',
                    borderRadius:7, border:`2px solid ${selectedMap?.id===m.id?'var(--gold)':'var(--border2)'}`,
                    background: selectedMap?.id===m.id?'rgba(240,200,60,.1)':'var(--bg2)',
                    transition:'all .15s',
                  }}>
                    <div style={{ fontSize:18 }}>{m.icon||'🗺️'}</div>
                    <div style={{ fontSize:8, fontWeight:700, color:'var(--text2)', lineHeight:1.3, marginTop:2 }}>{(m.title||m.name||'?').slice(0,12)}</div>
                    <div style={{ fontSize:7, color:'var(--text3)', marginTop:1 }}>{m.game_mode}</div>
                  </div>
                ))}
              </div>
              {selectedMap && (
                <div style={{ fontSize:10, color:'var(--text3)', marginTop:4 }}>
                  Gewählt: {selectedMap.icon} {selectedMap.title||selectedMap.name} — {selectedMap.game_mode}
                  {selectedMap.game_mode !== form.game_mode && (
                    <span style={{ color:'var(--gold)', marginLeft:6 }}>
                      ⚠️ Map-Modus ({selectedMap.game_mode}) weicht von Lobby-Modus ({form.game_mode}) ab
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          <button className="btn btn-primary" onClick={create} disabled={!form.name}>{t('create_lobby')}</button>
        </div>
      )}

      {joining && (
        <div className="card" style={{ margin: '12px 20px', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">{t('enter_code')}</label>
            <input className="input" placeholder="XXXXXXXX" value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0,8))}
              style={{ letterSpacing: 4, fontWeight: 700, textTransform: 'uppercase' }} />
          </div>
          <button className="btn btn-primary" onClick={joinByCode}>{t('join_group')}</button>
        </div>
      )}

      <div className="section-title">{t('public_lobbies')} ({lobbies.length})</div>
      {lobbies.length === 0 && (
        <div className="empty-state"><div className="empty-icon">🎮</div>Keine öffentlichen Lobbys. Erstelle eine!</div>
      )}
      <div className="lobby-grid">
        {lobbies.map(l => (
          <div key={l.id} className="lobby-card" onClick={() => {
            api.post(`/lobbies/join/${l.code}`).then(() => navigate(`/lobby/${l.id}`)).catch(() => navigate(`/lobby/${l.id}`));
          }}>
            <div className="lobby-card-name">{l.name}</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <span className={`lobby-badge badge-${l.game_mode}`}>{t(l.game_mode)}</span>
              <span className={`lobby-badge badge-${l.difficulty}`}>{t(l.difficulty)}</span>
            </div>
            <div className="lobby-meta">
              <span>👤 {l.host_name}</span>
              <span>👥 {l.player_count}/{l.max_players}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
export default LobbyList;
