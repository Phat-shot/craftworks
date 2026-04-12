// src/pages/LobbyRoom.jsx
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../App';
import { api, getSocket } from '../api';

export default function LobbyRoom() {
  const { id }     = useParams();
  const { user }   = useAuth();
  const { t }      = useTranslation();
  const navigate   = useNavigate();
  const [lobby,    setLobby]    = useState(null);
  const [members,  setMembers]  = useState([]);
  const [ready,    setReady]    = useState(false);
  const [allReady, setAllReady] = useState(false);
  const [qr,       setQr]       = useState(null);
  const [error,    setError]    = useState('');
  const [myRace,   setMyRace]   = useState('standard');
  const [builtinMaps, setBuiltinMaps] = useState([]);
  const [selectedMap, setSelectedMap] = useState(null);
  const [taCountdown, setTaCountdown] = useState(60);
  const [taRounds, setTaRounds]       = useState(5);
  const socketRef  = useRef(null);

  const RACES = {
    standard: { name:'Standard',   icon:'⚔️',  color:'#c0a060', desc:'Dart · Gift · Kanone' },
    orcs:     { name:'Orcs',       icon:'💀',  color:'#80c020', desc:'Fleischwolf · Wurfspeer · Kriegstrommel' },
    techies:  { name:'Techies',    icon:'⚙️',  color:'#60a8d0', desc:'Mörser · Elektrozaun · Raketenwerfer' },
    elemente: { name:'Elemente',   icon:'🌊',  color:'#40c0e0', desc:'Magmaquelle · Sturmstrudel · Eisspitze' },
    urwald:   { name:'Urwald',     icon:'🌿',  color:'#40a840', desc:'Rankenfalle · Giftpilz · Mondlichtaltar' },
  };

  useEffect(() => {
    // Load lobby
    api.get(`/lobbies/${id}`).then(r => {
      setLobby(r.data); setMembers(r.data.members || []);
    }).catch(() => navigate('/lobby'));

    // Socket
    const socket = getSocket();
    socketRef.current = socket;
    socket.emit('lobby:join', { lobbyId: id });
    // Load map gallery
    const token = localStorage.getItem('access_token');
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    fetch('/api/workshop/maps/builtin', { headers })
      .then(r=>r.json()).then(maps=>{ if(Array.isArray(maps)) setBuiltinMaps(maps); })
      .catch(()=>{});

    socket.on('lobby:state',         ({ members: m }) => setMembers(m));
    socket.on('lobby:race_changed',  ({ userId: uid, race }) => {
      if (uid === user.id) setMyRace(race);
      setMembers(m => m.map(x => x.id===uid ? {...x, race} : x));
    });
    socket.on('lobby:player_joined', (p) => setMembers(m => [...m.filter(x=>x.id!==p.userId), { id:p.userId, username:p.username, avatar_color:p.avatar_color, ready:false }]));
    socket.on('lobby:player_left',   ({ userId }) => setMembers(m => m.filter(x=>x.id!==userId)));
    socket.on('lobby:player_ready',  ({ userId, ready: r }) => setMembers(m => m.map(x => x.id===userId ? {...x,ready:r} : x)));
    socket.on('lobby:all_ready',     () => setAllReady(true));
    socket.on('lobby:host_changed',  ({ newHostId }) => setLobby(l => ({ ...l, host_id: newHostId })));
    socket.on('game:start', ({ sessionId, difficulty, mode, playerCount, workshopConfig }) => navigate(`/game/${sessionId}`, { state: { difficulty: difficulty || 'normal', mode: mode || 'coop', playerCount: playerCount || 2, workshopConfig: workshopConfig || null } }));
    socket.on('error', ({ code }) => setError(`Server-Fehler: ${code}`));
    socket.on('connect_error', (e) => setError(`Verbindungsfehler: ${e.message}`));

    return () => {
      socket.emit('lobby:leave', { lobbyId: id });
      ['lobby:state','lobby:player_joined','lobby:player_left','lobby:player_ready','lobby:all_ready','lobby:host_changed','game:start','error','connect_error']
        .forEach(e => socket.off(e));
    };
  }, [id]);

  const selectRace = (race) => {
    setMyRace(race);
    socketRef.current?.emit('lobby:set_race', { lobbyId: id, race });
  };

  const toggleReady = () => {
    const newReady = !ready;
    setReady(newReady);
    socketRef.current?.emit('lobby:ready', { lobbyId: id, ready: newReady });
  };

  const startGame = () => {
    const wsConfig = selectedMap?.config || selectedMap || {};
    if (lobby.game_mode === 'time_attack') {
      wsConfig.ta_countdown = taCountdown;
      if (wsConfig.ta_layout) wsConfig.ta_layout.rounds = taRounds;
      else wsConfig.ta_layout = { rounds: taRounds };
    }
    socketRef.current?.emit('lobby:start', { lobbyId: id, workshopMapConfig: wsConfig });
  };

  const loadQr = async () => {
    if (qr) { setQr(null); return; }
    try { const { data } = await api.get(`/lobbies/${id}/qr`); setQr(data); }
    catch { setError('QR konnte nicht geladen werden'); }
  };

  const copyCode = () => {
    if (!lobby?.code) return;
    navigator.clipboard.writeText(lobby.code).then(() => alert(t('code_copied')));
  };

  if (!lobby) return <div className="loading-screen">{t('loading')}</div>;

  const isHost = lobby.host_id === user.id;
  const canStart = isHost && members.length >= 1; // host can start with 1 player

  return (
    <div className="lobby-room">
      {error && <div className="alert alert-error">{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/lobby')}>← {t('back')}</button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{lobby.name}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <span className={`lobby-badge badge-${lobby.game_mode}`}>{t(lobby.game_mode)}</span>
          <span className={`lobby-badge badge-${lobby.difficulty}`}>{t(lobby.difficulty)}</span>
          <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>
            👤 {members.length}/{lobby.max_players} {t('players')}
          </span>
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={copyCode}>📋 {lobby.code} – {t('copy_code')}</button>
          <button className="btn btn-ghost btn-sm" onClick={loadQr}>{qr ? '✕' : '🔲'} {t('invite_qr')}</button>
        </div>
      </div>

      {/* QR Code */}
      {qr && (
        <div className="qr-modal" onClick={() => setQr(null)}>
          <div className="qr-box" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Einladung</div>
            <img src={qr.qr} alt="QR Code" />
            <div className="qr-code-text">{qr.code}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{qr.url}</div>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={copyCode}>
              📋 {t('copy_code')}
            </button>
          </div>
        </div>
      )}

      {/* Race selection */}
      <div className="section-title">⚔️ Deine Rasse</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:16 }}>
        {Object.entries(RACES).map(([key, r]) => (
          <div
            key={key}
            onClick={() => selectRace(key)}
            style={{
              padding:'10px 8px', borderRadius:8, cursor:'pointer', textAlign:'center',
              border:`2px solid ${myRace===key ? r.color : 'var(--border2)'}`,
              background: myRace===key ? `${r.color}22` : 'var(--bg2)',
              transition:'all .15s',
            }}
          >
            <div style={{fontSize:22}}>{r.icon}</div>
            <div style={{fontSize:11,fontWeight:700,color:myRace===key?r.color:'var(--text2)',marginTop:2}}>{r.name}</div>
            <div style={{fontSize:9,color:'var(--text3)',marginTop:2,lineHeight:1.3}}>{r.desc}</div>
          </div>
        ))}
      </div>
      <div style={{fontSize:10,color:'var(--text3)',marginBottom:16}}>
        + Frost (W10) · Blitz (W20) für alle Rassen
      </div>

      {/* TA countdown picker */}
      {lobby.game_mode === 'time_attack' && (
        <div className="card" style={{ marginBottom: 12, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>⏱️ Bauzeit pro Runde</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {[30,60,90,120].map(s=>(
              <button key={s} onClick={()=>setTaCountdown(s)} style={{
                padding:'5px 12px', borderRadius:5, cursor:'pointer', fontSize:11, fontWeight:700,
                border:`2px solid ${taCountdown===s?'var(--gold)':'var(--border2)'}`,
                background:taCountdown===s?'rgba(240,200,60,.1)':'var(--bg2)',
                color:taCountdown===s?'var(--gold)':'var(--text2)',
              }}>{s}s</button>
            ))}
          </div>
        </div>
      )}

      {/* TA rounds picker */}
      {lobby.game_mode === 'time_attack' && (
        <div className="card" style={{ marginBottom: 12, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>🔄 Rundenanzahl</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {[3,5,7,10].map(n=>(
              <button key={n} onClick={()=>setTaRounds(n)} style={{
                padding:'5px 12px', borderRadius:5, cursor:'pointer', fontSize:11, fontWeight:700,
                border:`2px solid ${taRounds===n?'var(--gold)':'var(--border2)'}`,
                background:taRounds===n?'rgba(240,200,60,.1)':'var(--bg2)',
                color:taRounds===n?'var(--gold)':'var(--text2)',
              }}>{n}</button>
            ))}
          </div>
        </div>
      )}

      {/* Mode description */}
      <div className="card" style={{ marginBottom: 16, padding: '10px 14px', fontSize: 12, color: 'var(--text2)' }}>
        {lobby.game_mode === 'coop'       && '🤝 Koop: Alle spielen auf einer Karte – Bounty wird geteilt!'}
        {lobby.game_mode === 'classic'    && '🏛 Klassisch: Alle Spieler starten die nächste Wave zusammen.'}
        {lobby.game_mode === 'tournament' && '🏆 Turnier: Jeder Spieler startet die nächste Wave 15s nach Abschluss seiner eigenen.'}
        {lobby.game_mode === 'chaos'      && '💀 Chaos: Waves starten automatisch – auch wenn die vorherige noch läuft!'}
      </div>

      {/* Map selection (host only) */}
      {isHost && builtinMaps.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div className="section-title">🗺️ Map wählen</div>
          <div style={{ display:'flex', gap:7, overflowX:'auto', paddingBottom:6 }}>
            {builtinMaps.map(m=>(
              <div key={m.id} onClick={()=>setSelectedMap(m)} style={{
                flexShrink:0, width:80, background:'var(--bg2)',
                border:`2px solid ${selectedMap?.id===m.id?'var(--gold)':'var(--border2)'}`,
                borderRadius:8, padding:'7px 5px', cursor:'pointer', textAlign:'center',
                background:selectedMap?.id===m.id?'rgba(240,200,60,.08)':'var(--bg2)',
                transition:'all .15s',
              }}>
                <div style={{ fontSize:18 }}>{m.icon||'🗺️'}</div>
                <div style={{ fontSize:8, fontWeight:700, color:'var(--text2)', lineHeight:1.3, marginTop:2 }}>{(m.title||m.name||'?').slice(0,12)}</div>
                <div style={{ fontSize:7, color:'var(--text3)', marginTop:1 }}>{m.game_mode||'td'}</div>
              </div>
            ))}
          </div>
          {selectedMap && <div style={{ fontSize:10, color:'var(--text3)', marginTop:4 }}>
            Gewählt: {selectedMap.icon} {selectedMap.title||selectedMap.name} — {selectedMap.game_mode}
          </div>}
        </div>
      )}
      {!isHost && selectedMap && (
        <div style={{ marginBottom:12, padding:'8px 12px', background:'rgba(60,60,60,.2)', borderRadius:6, fontSize:11, color:'var(--text3)' }}>
          🗺️ Map: {selectedMap.icon} {selectedMap.title||selectedMap.name}
        </div>
      )}

      {/* Players */}
      <div className="section-title">{t('players')}</div>
      <div className="player-list">
        {members.map(m => (
          <div key={m.id} className="player-row">
            <div className="avatar avatar-md" style={{ background: m.avatar_color || '#4a90e2', flexShrink: 0 }}>
              {m.username?.slice(0,2).toUpperCase()}
            </div>
            <span style={{ flex: 1, fontWeight: 600 }}>{m.username}</span>
            {m.id === lobby.host_id && <span style={{ fontSize: 11, color: 'var(--gold)' }}>👑 Host</span>}
            {m.race && RACES[m.race] && <span style={{ fontSize: 11, color: RACES[m.race].color }}>{RACES[m.race].icon} {RACES[m.race].name}</span>}
            <span className={`player-ready ${m.ready ? 'yes' : 'no'}`}>
              {m.ready ? `✅ ${t('ready')}` : `⬜ ${t('not_ready')}`}
            </span>
          </div>
        ))}
      </div>

      {allReady && members.length >= 1 && (
        <div className="alert alert-success" style={{ marginBottom: 12 }}>{t('all_ready')}</div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button
          className={`btn ${ready ? 'btn-danger' : 'btn-green'}`}
          onClick={toggleReady}
        >
          {ready ? `✅ ${t('ready')}` : t('ready')}
        </button>

        {isHost && (
          <button
            className="btn btn-primary"
            onClick={startGame}
            disabled={!canStart}
          >
            ▶ {t('start_game')}
          </button>
        )}
        {!isHost && (
          <div style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>
            {t('waiting_players')}
          </div>
        )}
      </div>
    </div>
  );
}
