import React, { useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../App';
import { getSocket } from '../api';

export default function GamePage() {
  const { sessionId } = useParams();
  const { user }      = useAuth();
  const location      = useLocation();
  const difficulty    = location.state?.difficulty || 'normal';
  const mode         = location.state?.mode || 'coop';
  const playerCount   = location.state?.playerCount || 1;

  useEffect(() => {
    // Store full session info for td-game.html
    sessionStorage.setItem('mp_session', JSON.stringify({
      sessionId,
      userId: user.id,
      username: user.username,
      difficulty,
      mode,
      playerCount,
      solo: false,
    }));

    // Join game socket room before navigating
    const socket = getSocket();
    socket.emit('game:join', { sessionId });

    window.location.href = '/td-game.html';
  }, []);

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%' }}>
      <div style={{ color:'var(--text2)', fontSize:14 }}>Lade Spiel…</div>
    </div>
  );
}
