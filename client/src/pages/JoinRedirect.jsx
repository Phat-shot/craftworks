import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { api } from '../api';

export default function JoinRedirect() {
  const { type, code } = useParams();
  const { user }       = useAuth();
  const navigate       = useNavigate();

  useEffect(() => {
    if (!user) { navigate(`/login?redirect=/join/${type}/${code}`); return; }
    const route = type === 'group' ? `/groups/join/${code}` : `/lobbies/join/${code}`;
    api.post(route)
      .then(r => { if (type === 'lobby') navigate(`/lobby/${r.data.lobby.id}`); else navigate('/'); })
      .catch(() => navigate('/'));
  }, []);

  return <div className="loading-screen">🔄 Joining…</div>;
}
