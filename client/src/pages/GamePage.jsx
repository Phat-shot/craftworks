import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../App';
import { getSocket } from '../api';

export default function GamePage() {
  const { sessionId }  = useParams();
  const { user }       = useAuth();
  const { t }          = useTranslation();
  const navigate       = useNavigate();
  const location       = useLocation();
  const difficulty     = location.state?.difficulty || 'normal';
  const iframeRef      = useRef(null);
  const [players,  setPlayers]  = useState({});
  const [gameOver, setGameOver] = useState(null);

  useEffect(() => {
    const socket = getSocket();
    socket.emit('game:join', { sessionId });

    socket.on('game:player_update', (data) => {
      setPlayers(p => ({ ...p, [data.userId]: { ...p[data.userId], ...data } }));
    });
    socket.on('game:player_wave_done', ({ userId, wave }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], wave } }));
    });
    socket.on('game:player_died', ({ userId, wave, score }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], status:'dead', wave, score } }));
    });
    socket.on('game:player_finished', ({ userId, wave, score }) => {
      setPlayers(p => ({ ...p, [userId]: { ...p[userId], status:'finished', wave, score } }));
    });
    socket.on('game:wave_start', ({ wave, auto }) => {
      iframeRef.current?.contentWindow?.postMessage({ type:'WAVE_START', wave, auto }, '*');
    });
    socket.on('game:over', ({ winner, rankings }) => {
      setGameOver({ winner, rankings });
    });

    const onMsg = (e) => {
      if(e.source !== iframeRef.current?.contentWindow) return;
      const { type, ...data } = e.data || {};
      if(type === 'GAME_STATE')    socket.emit('game:state_update',  { sessionId, ...data });
      if(type === 'WAVE_FINISHED') socket.emit('game:wave_finished', { sessionId, wave: data.wave });
      if(type === 'GAME_OVER')     socket.emit('game:died',          { sessionId, ...data });
      if(type === 'GAME_WON')      socket.emit('game:finished',      { sessionId, ...data });
    };
    window.addEventListener('message', onMsg);

    return () => {
      ['game:player_update','game:player_wave_done','game:player_died',
       'game:player_finished','game:wave_start','game:over'].forEach(e=>socket.off(e));
      window.removeEventListener('message', onMsg);
    };
  }, [sessionId]);

  const sorted = Object.values(players).sort((a,b) => (b.wave||0)-(a.wave||0));

  return (
    <div style={{ position:'fixed', inset:0, background:'#000', zIndex:100 }}>
      <iframe
        ref={iframeRef}
        src={`/td-game.html?difficulty=${difficulty}`}
        title="Tower Defense"
        style={{ width:'100%', height:'100%', border:'none', display:'block' }}
      />

      {/* Multiplayer overlay */}
      {sorted.length > 1 && !gameOver && (
        <div style={{
          position:'absolute', top:8, right:8,
          background:'rgba(6,4,12,.9)', border:'1px solid #2a2438',
          borderRadius:8, padding:'8px 12px', minWidth:160,
          backdropFilter:'blur(6px)', zIndex:200, fontSize:12,
          pointerEvents:'none',
        }}>
          <div style={{ fontSize:9, color:'#504860', letterSpacing:1, textTransform:'uppercase', marginBottom:5 }}>
            Players
          </div>
          {sorted.map((p,i) => (
            <div key={p.userId} style={{
              display:'flex', alignItems:'center', gap:6,
              padding:'3px 0', borderBottom:'1px solid #1a1828',
              opacity: p.status==='dead' ? 0.4 : 1,
            }}>
              <span style={{ width:14, color:'#504860', fontSize:10 }}>{i+1}.</span>
              <span style={{
                flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                fontWeight: p.userId===user.id ? 700 : 400,
                color: p.status==='dead' ? '#504860' : '#e0d8f0',
              }}>
                {p.username||'?'}{p.userId===user.id ? ' 👤' : ''}
              </span>
              <span style={{ color:'#f0c840', fontWeight:700, width:36, textAlign:'right' }}>
                W{p.wave||0}
              </span>
              <span style={{ color:'#e04040', width:28, textAlign:'right' }}>
                {p.status==='dead' ? '💀' : `❤${p.lives??'?'}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Game over */}
      {gameOver && (
        <div style={{
          position:'absolute', inset:0,
          background:'rgba(0,0,0,.85)', backdropFilter:'blur(6px)',
          display:'flex', alignItems:'center', justifyContent:'center',
          flexDirection:'column', gap:14, zIndex:300,
        }}>
          <div style={{ fontSize:36, fontWeight:900, color:'#f0c840' }}>
            {gameOver.winner?.userId===user.id ? t('victory') : t('game_over')}
          </div>
          <div style={{ fontSize:13, color:'#8880a0' }}>
            {t('winner')}: <b style={{color:'#e0d8f0'}}>{gameOver.winner?.username}</b>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8, minWidth:240 }}>
            {gameOver.rankings.map((p,i) => (
              <div key={p.userId} style={{
                display:'flex', alignItems:'center', gap:10,
                background:'#1c1828', borderRadius:8, padding:'10px 14px',
              }}>
                <span style={{ fontSize:18, width:28 }}>
                  {i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`}
                </span>
                <span style={{ flex:1, fontWeight:p.userId===user.id?700:400 }}>
                  {p.username}{p.userId===user.id?' (Du)':''}
                </span>
                <span style={{ color:'#f0c840', fontSize:12 }}>W{p.wave} · {p.score}pts</span>
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap:10, marginTop:8 }}>
            <button className="btn btn-primary" onClick={()=>navigate('/lobby')}>🎮 Neue Lobby</button>
            <button className="btn btn-ghost"   onClick={()=>navigate('/')}>🏠 Home</button>
          </div>
        </div>
      )}
    </div>
  );
}
