import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../App';
import { getSocket } from '../api';

// GamePage opens the TD game in a new full tab and shows
// the multiplayer overlay in that same tab via BroadcastChannel.
// The iframe approach was abandoned because window.innerWidth=0
// at load time inside an iframe prevented canvas sizing.

export default function GamePage() {
  const { sessionId }  = useParams();
  const { user }       = useAuth();
  const { t }          = useTranslation();
  const navigate       = useNavigate();
  const location       = useLocation();
  const difficulty     = location.state?.difficulty || 'normal';
  const channelRef     = useRef(null);
  const winRef         = useRef(null);

  const [players,  setPlayers]  = useState({});
  const [gameOver, setGameOver] = useState(null);
  const [launched, setLaunched] = useState(false);

  // ── Open game in new tab & bridge socket ↔ BroadcastChannel ──
  useEffect(() => {
    const channel = new BroadcastChannel(`td_game_${sessionId}`);
    channelRef.current = channel;

    // Open game tab
    const gameUrl = `/td-game.html?difficulty=${difficulty}&bc=${sessionId}`;
    const win = window.open(gameUrl, `game_${sessionId}`);
    winRef.current = win;
    setLaunched(true);

    const socket = getSocket();
    socket.emit('game:join', { sessionId });

    // Socket → BroadcastChannel (server tells all players)
    socket.on('game:player_update', (data) => {
      setPlayers(p => ({ ...p, [data.userId]: { ...p[data.userId], ...data } }));
    });
    socket.on('game:player_wave_done', ({ userId, wave }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], wave } }));
    });
    socket.on('game:player_died', ({ userId, wave, score }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], status: 'dead', wave, score } }));
      channel.postMessage({ type: 'PLAYER_DIED', userId });
    });
    socket.on('game:player_finished', ({ userId, wave, score }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], status: 'finished', wave, score } }));
    });
    socket.on('game:wave_start', (data) => {
      channel.postMessage({ type: 'WAVE_START', ...data });
    });
    socket.on('game:over', ({ winner, rankings }) => {
      setGameOver({ winner, rankings });
      channel.postMessage({ type: 'GAME_OVER' });
    });

    // BroadcastChannel → Socket (game tab sends events here)
    channel.onmessage = (e) => {
      const { type, ...data } = e.data;
      switch (type) {
        case 'GAME_STATE':
          socket.emit('game:state_update', { sessionId, ...data }); break;
        case 'WAVE_FINISHED':
          socket.emit('game:wave_finished', { sessionId, wave: data.wave }); break;
        case 'GAME_OVER':
          socket.emit('game:died', { sessionId, ...data }); break;
        case 'GAME_WON':
          socket.emit('game:finished', { sessionId, ...data }); break;
        default: break;
      }
    };

    return () => {
      ['game:player_update','game:player_wave_done','game:player_died',
       'game:player_finished','game:wave_start','game:over']
        .forEach(e => socket.off(e));
      channel.close();
    };
  }, [sessionId, difficulty]);

  const sorted = Object.values(players).sort((a, b) =>
    (b.wave || 0) - (a.wave || 0)
  );

  // ── Waiting / overlay page ────────────────────────────────────
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 24, padding: 24,
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--gold)', marginBottom: 6 }}>
          ⚔ Wave Defense
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>
          {launched
            ? '🎮 Spiel läuft in einem neuen Tab'
            : 'Starte Spiel…'}
        </div>
      </div>

      {/* Reopen button if tab was closed */}
      {launched && (
        <button className="btn btn-primary" onClick={() => {
          const url = `/td-game.html?difficulty=${difficulty}&bc=${sessionId}`;
          window.open(url, `game_${sessionId}`);
        }}>
          🎮 Spiel-Tab öffnen / wiederherstellen
        </button>
      )}

      {/* Live leaderboard */}
      {sorted.length > 0 && (
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--border2)',
          borderRadius: 8, padding: 16, minWidth: 280,
        }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' }}>
            Live Standings
          </div>
          {sorted.map((p, i) => (
            <div key={p.userId} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 0', borderBottom: '1px solid var(--border)',
              opacity: p.status === 'dead' ? 0.45 : 1,
            }}>
              <span style={{ width: 20, color: 'var(--text3)', fontSize: 11 }}>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`}
              </span>
              <span style={{
                flex: 1, fontWeight: p.userId === user.id ? 700 : 400,
                textDecoration: p.status === 'dead' ? 'line-through' : 'none',
              }}>
                {p.username || '?'} {p.userId === user.id ? '(Du)' : ''}
              </span>
              <span style={{ color: 'var(--gold)', fontWeight: 700 }}>W{p.wave || 0}</span>
              <span style={{ color: 'var(--red)', width: 32, textAlign: 'right' }}>
                {p.status === 'dead' ? '💀' : `❤${p.lives ?? '?'}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Game over */}
      {gameOver && (
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--border2)',
          borderRadius: 8, padding: 20, textAlign: 'center', minWidth: 280,
        }}>
          <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--gold)', marginBottom: 8 }}>
            {gameOver.winner?.userId === user.id ? t('victory') : t('game_over')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
            {t('winner')}: <b>{gameOver.winner?.username}</b>
          </div>
          {gameOver.rankings.map((p, i) => (
            <div key={p.userId} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'var(--bg3)', borderRadius: 6, padding: '8px 12px', marginBottom: 6,
            }}>
              <span style={{ fontSize: 18, width: 28 }}>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`}
              </span>
              <span style={{ flex: 1, fontWeight: p.userId === user.id ? 700 : 400 }}>
                {p.username}{p.userId === user.id ? ' (Du)' : ''}
              </span>
              <span style={{ color: 'var(--gold)', fontSize: 12 }}>
                W{p.wave} · {p.score}pts
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => navigate('/lobby')}>🎮 Neue Lobby</button>
            <button className="btn btn-ghost"   onClick={() => navigate('/')}>🏠 Home</button>
          </div>
        </div>
      )}

      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
        ← Verlassen
      </button>
    </div>
  );
}
