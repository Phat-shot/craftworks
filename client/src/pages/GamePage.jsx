import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../App';
import { getSocket } from '../api';

export default function GamePage() {
  const { sessionId } = useParams();
  const { user }      = useAuth();
  const { t }         = useTranslation();
  const navigate      = useNavigate();
  const iframeRef     = useRef(null);
  const [players,  setPlayers]  = useState({});
  const [gameOver, setGameOver] = useState(null);

  useEffect(() => {
    const socket = getSocket();
    socket.emit('game:join', { sessionId });

    socket.on('game:player_update', ({ userId, wave, lives, score, kills, status }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], userId, wave, lives, score, kills, status } }));
    });
    socket.on('game:player_wave_done', ({ userId, wave }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], wave } }));
    });
    socket.on('game:player_died', ({ userId, wave, score }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], status: 'dead', wave, score } }));
    });
    socket.on('game:player_finished', ({ userId, wave, score }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], status: 'finished', wave, score } }));
    });
    socket.on('game:wave_start', ({ wave, auto }) => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'WAVE_START', wave, auto }, '*');
    });
    socket.on('game:over', ({ winner, rankings }) => {
      setGameOver({ winner, rankings });
    });

    const onMessage = (e) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const { type, ...data } = e.data || {};
      switch (type) {
        case 'GAME_STATE':
          socket.emit('game:state_update', { sessionId, ...data }); break;
        case 'WAVE_FINISHED':
          socket.emit('game:wave_finished', { sessionId, wave: data.wave }); break;
        case 'GAME_OVER':
          socket.emit('game:died', { sessionId, ...data }); break;
        case 'GAME_WON':
          socket.emit('game:finished', { sessionId, ...data }); break;
        case 'READY':
          iframeRef.current?.contentWindow?.postMessage({
            type: 'MULTIPLAYER_INIT', sessionId, userId: user.id,
          }, '*');
          break;
        default: break;
      }
    };
    window.addEventListener('message', onMessage);

    return () => {
      ['game:player_update','game:player_wave_done','game:player_died',
       'game:player_finished','game:wave_start','game:over']
        .forEach(e => socket.off(e));
      window.removeEventListener('message', onMessage);
    };
  }, [sessionId, user.id]);

  const sorted = Object.values(players).sort((a, b) => {
    if (a.status === 'dead' && b.status !== 'dead') return 1;
    if (b.status === 'dead' && a.status !== 'dead') return -1;
    return (b.wave || 0) - (a.wave || 0);
  });

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000', zIndex: 100,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Game iframe — full screen */}
      <iframe
        ref={iframeRef}
        src="/td-game.html"
        title="Tower Defense"
        style={{
          flex: 1, width: '100%', border: 'none',
          display: 'block', minHeight: 0,
        }}
        allow="accelerometer; gyroscope"
      />

      {/* Multiplayer overlay top-right */}
      {sorted.length > 1 && !gameOver && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: 'rgba(10,8,20,.88)', border: '1px solid #2a2438',
          borderRadius: 8, padding: '8px 12px', minWidth: 170,
          backdropFilter: 'blur(8px)', zIndex: 200, fontSize: 12,
        }}>
          <div style={{ fontSize: 9, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
            Players
          </div>
          {sorted.map((p, i) => (
            <div key={p.userId} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 0', borderBottom: '1px solid #1a1828',
              opacity: p.status === 'dead' ? 0.45 : 1,
            }}>
              <span style={{ fontSize: 10, color: '#504860', width: 14 }}>{i + 1}</span>
              <span style={{
                flex: 1, fontWeight: p.userId === user.id ? 700 : 400,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                textDecoration: p.status === 'dead' ? 'line-through' : 'none',
                color: p.status === 'dead' ? '#504860' : '#e0d8f0',
              }}>
                {p.username || '?'}{p.userId === user.id ? ' 👤' : ''}
              </span>
              <span style={{ color: '#f0c840', fontWeight: 700, width: 38, textAlign: 'right' }}>
                W{p.wave || 0}
              </span>
              {p.status === 'dead'
                ? <span style={{ color: '#e04040', width: 28, textAlign: 'right' }}>💀</span>
                : <span style={{ color: '#e04040', width: 28, textAlign: 'right' }}>❤{p.lives ?? '?'}</span>
              }
            </div>
          ))}
        </div>
      )}

      {/* Game over */}
      {gameOver && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 14, zIndex: 300,
          backdropFilter: 'blur(6px)',
        }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: '#f0c840' }}>
            {gameOver.winner?.userId === user.id ? t('victory') : t('game_over')}
          </div>
          <div style={{ fontSize: 13, color: '#8880a0' }}>
            {t('winner')}: {gameOver.winner?.username}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 240 }}>
            {gameOver.rankings.map((p, i) => (
              <div key={p.userId} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: '#1c1828', borderRadius: 8, padding: '10px 14px',
              }}>
                <span style={{ fontSize: 18, width: 28 }}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                </span>
                <span style={{ flex: 1, fontWeight: p.userId === user.id ? 700 : 400 }}>
                  {p.username}{p.userId === user.id ? ' (Du)' : ''}
                </span>
                <span style={{ color: '#f0c840', fontSize: 12 }}>
                  W{p.wave} · {p.score}pts
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button className="btn btn-primary" onClick={() => navigate('/lobby')}>🎮 Neue Lobby</button>
            <button className="btn btn-ghost"   onClick={() => navigate('/')}>🏠 Home</button>
          </div>
        </div>
      )}
    </div>
  );
}
