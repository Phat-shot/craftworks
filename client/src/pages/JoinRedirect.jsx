import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { api } from '../api';

export default function JoinRedirect() {
  const { type, code } = useParams();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [name, setName]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [ready, setReady]   = useState(false); // true once we know user state

  // If already logged in, join immediately
  useEffect(() => {
    if (user) {
      doJoin();
    } else {
      setReady(true); // show name form
    }
  }, [user]);

  async function doJoin(overrideUser) {
    setLoading(true);
    setError('');
    try {
      const route = type === 'group'
        ? `/groups/join/${code}`
        : `/lobbies/join/${code}`;
      const r = await api.post(route);
      if (type === 'lobby') navigate(`/lobby/${r.data.lobby.id}`);
      else navigate('/');
    } catch (e) {
      setError('Beitritt fehlgeschlagen. Code ungültig oder abgelaufen.');
      setLoading(false);
    }
  }

  async function handleGuestJoin(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Bitte gib einen Namen ein.'); return; }
    setLoading(true);
    setError('');
    try {
      // Create guest account with chosen name
      const r = await api.post('/auth/guest', { username: trimmed });
      // Store tokens
      localStorage.setItem('access_token', r.data.access_token);
      localStorage.setItem('refresh_token', r.data.refresh_token);
      setUser(r.data.user);
      // Join happens via useEffect once user is set
    } catch (e) {
      setError('Fehler beim Erstellen des Gast-Accounts.');
      setLoading(false);
    }
  }

  if (!ready && !user) return <div className="loading-screen">🔄 Lade…</div>;
  if (loading)          return <div className="loading-screen">🔄 Joining…</div>;

  // Not logged in → show name form
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 24, gap: 20,
    }}>
      <div style={{ fontSize: 32 }}>🎮</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--gold)', textAlign: 'center' }}>
        Lobby beitreten
      </div>
      <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>
        Gib deinen Namen ein um direkt beizutreten.
      </div>

      <form onSubmit={handleGuestJoin} style={{ width: '100%', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          className="input"
          placeholder="Dein Name"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={24}
          autoFocus
          style={{ textAlign: 'center', fontSize: 16 }}
        />
        {error && <div style={{ color: 'var(--red)', fontSize: 12, textAlign: 'center' }}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={loading}>
          ▶ Beitreten
        </button>
      </form>

      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
        Bereits registriert?{' '}
        <span
          style={{ color: 'var(--gold)', cursor: 'pointer' }}
          onClick={() => navigate(`/login?redirect=/join/${type}/${code}`)}
        >
          Einloggen
        </span>
      </div>
    </div>
  );
}
