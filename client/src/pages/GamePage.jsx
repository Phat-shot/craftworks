import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { getSocket } from '../api';

export default function GamePage() {
  const { sessionId } = useParams();
  const { user }      = useAuth();
  const navigate      = useNavigate();

  useEffect(() => {
    // Store session info so td-game.html can pick it up
    sessionStorage.setItem('mp_session', JSON.stringify({
      sessionId,
      userId: user.id,
      username: user.username,
    }));

    // Navigate directly to the game — no iframe, full window
    window.location.href = '/td-game.html';
  }, []);

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%' }}>
      <div style={{ color:'var(--text2)', fontSize:14 }}>Lade Spiel…</div>
    </div>
  );
}
