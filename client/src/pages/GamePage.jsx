// src/pages/GamePage.jsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../App';
import { getSocket } from '../api';

const GAME_URL = import.meta.env.VITE_GAME_URL || '/td-game.html';

export default function GamePage() {
  const { sessionId } = useParams();
  const { user }      = useAuth();
  const { t }         = useTranslation();
  const navigate      = useNavigate();
  const iframeRef     = useRef(null);
  const [players,  setPlayers]  = useState({});
  const [gameOver, setGameOver] = useState(null); // null | { winner, rankings }
  const [mode,     setMode]     = useState('classic');
  const modeRef    = useRef('classic');

  // ── Setup ───────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    socket.emit('game:join', { sessionId });

    // ── Socket handlers ──────────────────
    socket.on('game:player_update', ({ userId, wave, lives, score, kills, status }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], userId, wave, lives, score, kills, status } }));
    });

    socket.on('game:player_wave_done', ({ userId, username, wave }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], wave } }));
    });

    socket.on('game:player_died', ({ userId, username, wave, score }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], status: 'dead', wave, score } }));
    });

    socket.on('game:player_finished', ({ userId, wave, score }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], status: 'finished', wave, score } }));
    });

    // Classic mode: server tells all to start next wave
    socket.on('game:wave_start', ({ wave, auto }) => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'WAVE_START', wave, auto }, '*');
    });

    socket.on('game:over', ({ winner, rankings }) => {
      setGameOver({ winner, rankings });
    });

    // ── Messages from iframe ──────────────
    const onMessage = (e) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const { type, ...data } = e.data || {};
      switch (type) {
        case 'GAME_STATE':
          socket.emit('game:state_update', { sessionId, ...data });
          break;
        case 'WAVE_FINISHED':
          socket.emit('game:wave_finished', { sessionId, wave: data.wave });
          break;
        case 'GAME_OVER':
          // local game over (lives = 0)
          socket.emit('game:died', { sessionId, ...data });
          break;
        case 'GAME_WON':
          // completed all 25 waves
          socket.emit('game:finished', { sessionId, ...data });
          break;
        case 'READY':
          // Iframe loaded — send config
          iframeRef.current?.contentWindow?.postMessage({
            type: 'MULTIPLAYER_INIT',
            sessionId,
            userId: user.id,
            mode: modeRef.current,
          }, '*');
          break;
        default: break;
      }
    };
    window.addEventListener('message', onMessage);

    return () => {
      socket.off('game:player_update');
      socket.off('game:player_wave_done');
      socket.off('game:player_died');
      socket.off('game:player_finished');
      socket.off('game:wave_start');
      socket.off('game:over');
      window.removeEventListener('message', onMessage);
    };
  }, [sessionId, user.id]);

  const sortedPlayers = Object.values(players).sort((a, b) => {
    if (a.status === 'dead' && b.status !== 'dead') return 1;
    if (b.status === 'dead' && a.status !== 'dead') return -1;
    return (b.wave || 0) - (a.wave || 0);
  });

  return (
    <div className="game-page">
      {/* TD Game iframe */}
      <iframe
        ref={iframeRef}
        src={GAME_URL}
        className="game-iframe"
        title="Tower Defense"
        allow="accelerometer; gyroscope"
      />

      {/* Multiplayer overlay (top-right) */}
      {sortedPlayers.length > 0 && !gameOver && (
        <div className="game-overlay">
          <div className="game-overlay-title">Players</div>
          {sortedPlayers.map((p, i) => (
            <div key={p.userId} className={`player-stat-row${p.status === 'dead' ? ' ps-dead' : ''}`}>
              <span style={{ fontSize: 10, color: 'var(--text3)', width: 14 }}>{i+1}</span>
              <span className={`ps-name${p.userId === user.id ? '' : ''}`}>
                {p.username || p.userId?.slice(0,8)}
                {p.userId === user.id && ' 👤'}
              </span>
              <span className="ps-wave">W{p.wave || 0}</span>
              {p.status === 'dead'
                ? <span style={{ fontSize: 10, color: 'var(--red)' }}>💀</span>
                : <span className="ps-lives">❤{p.lives ?? '?'}</span>
              }
            </div>
          ))}
        </div>
      )}

      {/* Game over overlay */}
      {gameOver && (
        <div className="game-over-overlay">
          <div className="go-title">
            {gameOver.winner?.userId === user.id ? t('victory') : t('game_over')}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 8 }}>
            {t('winner')}: {gameOver.winner?.username}
          </div>
          <div className="rankings">
            {gameOver.rankings.map((p, i) => (
              <div key={p.userId} className="ranking-row">
                <span className={`lb-rank${i===0?' top1':i===1?' top2':i===2?' top3':''}`}>
                  {i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`}
                </span>
                <span style={{ flex: 1, fontWeight: p.userId===user.id?700:400 }}>
                  {p.username}{p.userId===user.id?' (Du)':''}
                </span>
                <span style={{ color: 'var(--gold)', fontSize: 12 }}>W{p.wave} · {p.score}pts</span>
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
