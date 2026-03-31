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
  const socketRef  = useRef(null);

  useEffect(() => {
    // Load lobby
    api.get(`/lobbies/${id}`).then(r => {
      setLobby(r.data); setMembers(r.data.members || []);
    }).catch(() => navigate('/lobby'));

    // Socket
    const socket = getSocket();
    socketRef.current = socket;
    socket.emit('lobby:join', { lobbyId: id });

    socket.on('lobby:state',         ({ members: m }) => setMembers(m));
    socket.on('lobby:player_joined', (p) => setMembers(m => [...m.filter(x=>x.id!==p.userId), { id:p.userId, username:p.username, avatar_color:p.avatar_color, ready:false }]));
    socket.on('lobby:player_left',   ({ userId }) => setMembers(m => m.filter(x=>x.id!==userId)));
    socket.on('lobby:player_ready',  ({ userId, ready: r }) => setMembers(m => m.map(x => x.id===userId ? {...x,ready:r} : x)));
    socket.on('lobby:all_ready',     () => setAllReady(true));
    socket.on('lobby:host_changed',  ({ newHostId }) => setLobby(l => ({ ...l, host_id: newHostId })));
    socket.on('game:start',          ({ sessionId, difficulty }) => navigate(`/game/${sessionId}`, { state: { difficulty: difficulty || 'normal' } }));

    return () => {
      socket.emit('lobby:leave', { lobbyId: id });
      ['lobby:state','lobby:player_joined','lobby:player_left','lobby:player_ready','lobby:all_ready','lobby:host_changed','game:start']
        .forEach(e => socket.off(e));
    };
  }, [id]);

  const toggleReady = () => {
    const newReady = !ready;
    setReady(newReady);
    getSocket().emit('lobby:ready', { lobbyId: id, ready: newReady });
  };

  const startGame = () => {
    getSocket().emit('lobby:start', { lobbyId: id });
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
  const canStart = isHost && members.length >= 2;

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

      {/* Mode description */}
      <div className="card" style={{ marginBottom: 16, padding: '10px 14px', fontSize: 12, color: 'var(--text2)' }}>
        {lobby.game_mode === 'classic'    && '🏛 Klassisch: Alle Spieler starten die nächste Wave zusammen.'}
        {lobby.game_mode === 'tournament' && '🏆 Turnier: Jeder Spieler startet die nächste Wave 15s nach Abschluss seiner eigenen.'}
        {lobby.game_mode === 'chaos'      && '💀 Chaos: Waves starten automatisch – auch wenn die vorherige noch läuft!'}
      </div>

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
            <span className={`player-ready ${m.ready ? 'yes' : 'no'}`}>
              {m.ready ? `✅ ${t('ready')}` : `⬜ ${t('not_ready')}`}
            </span>
          </div>
        ))}
      </div>

      {allReady && members.length >= 2 && (
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
