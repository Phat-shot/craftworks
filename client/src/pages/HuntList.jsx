// SCHNITZELJAGD — list of the host's own scenarios (GET /hunt/scenarios,
// requireAuth only — the "mine vs everyone's" distinction there is handled
// server-side: admins see everyone's, everyone else sees only their own).
// Entry point into HuntEditor.jsx (edit / new) and, once a scenario has at
// least one generated code, straight into HuntPlay.jsx.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function HuntList() {
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState(null);
  const [err, setErr] = useState('');

  const load = () => {
    api.get('/hunt/scenarios')
      .then(({ data }) => setScenarios(data))
      .catch(() => setErr('Laden fehlgeschlagen'));
  };
  useEffect(load, []);

  const remove = async (id) => {
    if (!confirm('Diese Schnitzeljagd wirklich löschen?')) return;
    await api.delete(`/hunt/scenarios/${id}`).catch(() => {});
    setScenarios(s => s.filter(sc => sc.id !== id));
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ color: 'var(--text)', margin: 0 }}>Schnitzeljagden</h2>
        <button onClick={() => navigate('/hunt/editor')} style={primaryBtnStyle}>+ Neue Schnitzeljagd</button>
      </div>

      {!!err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      {scenarios === null && !err && <div style={{ color: 'var(--text3)' }}>Lädt…</div>}
      {scenarios?.length === 0 && (
        <div style={{ color: 'var(--text3)', fontSize: 13 }}>
          Noch keine Schnitzeljagd gebaut — auf &quot;+ Neue Schnitzeljagd&quot; tippen, um loszulegen.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {scenarios?.map(sc => (
          <div key={sc.id} style={{
            background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10,
            padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{sc.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                {sc.poi_count} POI{sc.poi_count === 1 ? '' : 's'} · zuletzt geändert {new Date(sc.updated_at).toLocaleDateString('de-DE')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link to={`/hunt/editor/${sc.id}`} style={secondaryBtnStyle}>Bearbeiten</Link>
              <button onClick={() => remove(sc.id)} style={{ ...secondaryBtnStyle, color: 'var(--red)', borderColor: 'var(--red)' }}>
                Löschen
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const primaryBtnStyle = {
  background: 'var(--gold)', color: '#1a1000', border: 'none', borderRadius: 6,
  padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const secondaryBtnStyle = {
  background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '6px 12px', fontSize: 12, cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
};
