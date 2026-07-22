import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { useAuth } from '../App';

// Ops/diagnostic panel — read access to live users/lobbies/sessions, plus
// force-end/kill/delete/grant-admin actions. Built specifically to chase
// down "lobby not found" / stale-session reports that were hard to
// reproduce from a single device's logs alone — this makes the server's
// actual live state (not just what one client believes) directly visible.
// Server-side gate is requireAdmin (server/src/routes/admin.js); this page
// itself just surfaces whatever that returns, including a plain 403 if the
// logged-in account isn't an admin. Granting the FIRST admin is automatic
// (see auth.js's /register — the next account registered while zero admins
// exist becomes one); every admin after that is granted from the Users tab
// below.

function relTime(iso) {
  if (!iso) return '–';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'gerade eben';
  if (ms < 3600_000) return `vor ${Math.round(ms / 60_000)}min`;
  if (ms < 86_400_000) return `vor ${Math.round(ms / 3600_000)}h`;
  return `vor ${Math.round(ms / 86_400_000)}d`;
}

function Dot({ on, title }) {
  return (
    <span title={title} style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: 4, marginRight: 6,
      background: on ? 'var(--green, #4caf50)' : 'var(--text3)',
    }} />
  );
}

function StatusBadge({ status }) {
  const color = status === 'in_progress' ? 'var(--yellow, #e0a030)'
    : status === 'waiting' ? 'var(--blue, #4a90e2)'
    : 'var(--text3)';
  return <span style={{ color, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{status}</span>;
}

export default function Admin() {
  const { user } = useAuth();
  const [users, setUsers] = useState(null);
  const [lobbies, setLobbies] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [tab, setTab] = useState('lobbies');

  const load = useCallback(() => {
    Promise.all([api.get('/admin/lobbies'), api.get('/admin/users'), api.get('/admin/sessions')])
      .then(([l, u, s]) => { setLobbies(l.data); setUsers(u.data); setSessions(s.data); setError(''); })
      .catch(e => {
        if (e.response?.status === 403) setForbidden(true);
        else setError(e.response?.data?.error || 'Fehler beim Laden');
      });
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  const forceEnd = async (lobbyId) => {
    setBusyId(lobbyId);
    try { await api.post(`/admin/lobbies/${lobbyId}/force-end`); load(); }
    catch (e) { setError(e.response?.data?.error || 'Fehler beim Beenden'); }
    finally { setBusyId(null); }
  };

  const killSession = async (sessionId) => {
    setBusyId(sessionId);
    try { await api.post(`/admin/sessions/${sessionId}/kill`); load(); }
    catch (e) { setError(e.response?.data?.error || 'Fehler beim Beenden'); }
    finally { setBusyId(null); }
  };

  const deleteUser = async (u) => {
    if (!window.confirm(`${u.username} (${u.email}) wirklich unwiderruflich löschen?`)) return;
    setBusyId(u.id);
    try { await api.delete(`/admin/users/${u.id}`); load(); }
    catch (e) { setError(e.response?.data?.error || 'Fehler beim Löschen'); }
    finally { setBusyId(null); }
  };

  const setAdmin = async (u, isAdmin) => {
    setBusyId(u.id);
    try { await api.post(`/admin/users/${u.id}/set-admin`, { isAdmin }); load(); }
    catch (e) { setError(e.response?.data?.error || 'Fehler beim Ändern'); }
    finally { setBusyId(null); }
  };

  if (forbidden) {
    return (
      <div style={{ padding: 24 }}>
        <div className="page-header"><span className="page-title">🛠️ Admin</span></div>
        <p style={{ color: 'var(--text3)' }}>
          Kein Zugriff — {user?.username} ist kein Admin-Account. Vergeben mit:
        </p>
        <pre style={{ background: 'var(--bg2)', padding: 12, borderRadius: 8, fontSize: 12 }}>
          {"UPDATE users SET is_admin=true WHERE email='...';"}
        </pre>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16 }}>
      <div className="page-header">
        <span className="page-title">🛠️ Admin</span>
      </div>
      {!!error && <div style={{ color: 'var(--red, #e05050)', marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn btn-sm ${tab === 'lobbies' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('lobbies')}>
          Lobbies/Games {lobbies ? `(${lobbies.length})` : ''}
        </button>
        <button className={`btn btn-sm ${tab === 'sessions' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('sessions')}>
          Sessions {sessions ? `(${sessions.active.length})` : ''}
        </button>
        <button className={`btn btn-sm ${tab === 'users' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('users')}>
          Users {users ? `(${users.length})` : ''}
        </button>
      </div>

      {tab === 'lobbies' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lobbies === null && <div style={{ color: 'var(--text3)' }}>Lädt…</div>}
          {lobbies?.length === 0 && <div style={{ color: 'var(--text3)' }}>Keine Lobbies.</div>}
          {lobbies?.map(l => {
            // A DB row that says "there's a live session" but no worker is
            // actually running (or the reverse) is exactly the kind of drift
            // that produces a client-visible "lobby not found"/stuck screen
            // with nothing locally to explain why — flagged in red here so
            // it's impossible to miss while scanning the list live.
            const drift = l.status === 'in_progress' && (!l.activeSession || !l.activeSession.workerRunning);
            return (
              <div key={l.id} style={{
                border: `1px solid ${drift ? 'var(--red, #e05050)' : 'var(--border2)'}`,
                borderRadius: 10, padding: 12, background: 'var(--bg2)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Dot on={l.host_online} title="Host online?" />
                  <strong>{l.name}</strong>
                  <span style={{ color: 'var(--text3)', fontSize: 12 }}>#{l.code} · {l.game_mode}</span>
                  <StatusBadge status={l.status} />
                  {drift && <span style={{ color: 'var(--red, #e05050)', fontSize: 11, fontWeight: 800 }}>⚠ DRIFT: DB sagt aktiv, kein Worker</span>}
                  <span style={{ marginLeft: 'auto', color: 'var(--text3)', fontSize: 11 }}>{relTime(l.created_at)}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                  Host: {l.host_username} · {l.member_count} Mitglieder
                  {l.activeSession && (
                    <> · Session {l.activeSession.id.slice(0, 8)} ({l.activeSession.workerRunning ? 'Worker läuft' : 'KEIN Worker'})</>
                  )}
                </div>
                {l.members?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                    {l.members.map(m => (
                      <span key={m.id} style={{ fontSize: 12 }}>
                        <Dot on={m.online} title="online?" />{m.username}{m.ready ? ' ✓' : ''}
                      </span>
                    ))}
                  </div>
                )}
                {(l.status === 'waiting' || l.status === 'in_progress') && (
                  <button className="btn btn-ghost btn-sm" disabled={busyId === l.id}
                    onClick={() => forceEnd(l.id)} style={{ marginTop: 8 }}>
                    {busyId === l.id ? '⏳' : '⏹ Force-End'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'sessions' && (
        <div>
          {sessions === null && <div style={{ color: 'var(--text3)' }}>Lädt…</div>}
          {sessions && (
            <>
              <div style={{
                display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16,
                padding: 12, borderRadius: 10, border: '1px solid var(--border2)', background: 'var(--bg2)',
              }}>
                <div><strong>{sessions.last24h.total}</strong> <span style={{ color: 'var(--text3)', fontSize: 12 }}>Sessions, letzte 24h</span></div>
                {sessions.last24h.byStatus.map(s => (
                  <div key={s.status} style={{ fontSize: 12, color: 'var(--text3)' }}>{s.status}: <strong style={{ color: 'inherit' }}>{s.count}</strong></div>
                ))}
                {sessions.last24h.byMode.map(m => (
                  <div key={m.game_mode} style={{ fontSize: 12, color: 'var(--text3)' }}>{m.game_mode}: <strong style={{ color: 'inherit' }}>{m.count}</strong></div>
                ))}
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Aktiv ({sessions.active.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
                {sessions.active.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 12 }}>Keine aktiven Sessions.</div>}
                {sessions.active.map(s => (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                    border: `1px solid ${s.workerRunning ? 'var(--border2)' : 'var(--red, #e05050)'}`,
                    borderRadius: 8, background: 'var(--bg2)', fontSize: 13,
                  }}>
                    <span style={{ color: 'var(--text3)', fontSize: 11 }}>{s.id.slice(0, 8)}</span>
                    <strong>{s.lobby_name || '–'}</strong>
                    <span style={{ color: 'var(--text3)', fontSize: 12 }}>#{s.lobby_code} · {s.game_mode}</span>
                    {!s.workerRunning && <span style={{ color: 'var(--red, #e05050)', fontSize: 11, fontWeight: 800 }}>⚠ KEIN Worker</span>}
                    <span style={{ marginLeft: 'auto', color: 'var(--text3)', fontSize: 11 }}>seit {relTime(s.started_at)}</span>
                    <button className="btn btn-ghost btn-sm" disabled={busyId === s.id} onClick={() => killSession(s.id)}>
                      {busyId === s.id ? '⏳' : '⏹ Kill'}
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Zuletzt beendet</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sessions.recent.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 12 }}>Keine.</div>}
                {sessions.recent.map(s => (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
                    border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12, color: 'var(--text3)',
                  }}>
                    <span>{s.id.slice(0, 8)}</span>
                    <span>{s.lobby_name || '–'} #{s.lobby_code}</span>
                    <span>{s.game_mode}</span>
                    <StatusBadge status={s.status} />
                    <span style={{ marginLeft: 'auto' }}>beendet {relTime(s.ended_at)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'users' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {users === null && <div style={{ color: 'var(--text3)' }}>Lädt…</div>}
          {users?.map(u => {
            const isSelf = u.id === user?.id;
            return (
              <div key={u.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                border: '1px solid var(--border2)', borderRadius: 8, background: 'var(--bg2)', fontSize: 13,
              }}>
                <Dot on={u.online} title="online?" />
                <strong>{u.username}</strong>
                <span style={{ color: 'var(--text3)' }}>{u.email}</span>
                {u.is_guest && <span style={{ color: 'var(--text3)', fontSize: 11 }}>Gast</span>}
                {u.is_admin && <span style={{ color: 'var(--yellow, #e0a030)', fontSize: 11, fontWeight: 800 }}>ADMIN</span>}
                <span style={{ marginLeft: 'auto', color: 'var(--text3)', fontSize: 11 }}>zuletzt {relTime(u.last_seen)}</span>
                {!isSelf && (
                  <button className="btn btn-ghost btn-sm" disabled={busyId === u.id}
                    onClick={() => setAdmin(u, !u.is_admin)}>
                    {busyId === u.id ? '⏳' : (u.is_admin ? 'Admin entziehen' : 'Zu Admin machen')}
                  </button>
                )}
                {!isSelf && (
                  <button className="btn btn-ghost btn-sm" disabled={busyId === u.id}
                    onClick={() => deleteUser(u)} style={{ color: 'var(--red, #e05050)' }}>
                    {busyId === u.id ? '⏳' : '🗑 Löschen'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
