// SCHNITZELJAGD — minimal web play page: enter/scan a code, join the live
// (DB-backed) run via server/src/socket/hunt.js's hunt:live_* events, drive
// it with the browser Geolocation API. Deliberately minimal (no map) —
// closes the loop so "build it, save it, generate a code, play it
// directly" works end-to-end; a richer play UI (map, etc.) is a follow-up,
// mirrored on mobile by apps/arops-mobile/src/screens/HuntSandboxScreen.tsx
// for the fixed sandbox scenario today.
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSocket } from '../api';

const POI_ICON = { puzzle: '🧩', target: '💣', capture: '🎯', base: '🏆', carry_from: '📦', carry_to: '🏁' };
const EVENT_LABEL = {
  poi_arrived: 'Angekommen', poi_completed: 'Aufgabe erledigt', puzzle_wrong: 'Falsche Antwort',
  timeout: 'Zeitüberschreitung', route_deviation: 'Route verlassen', progress_finished: 'Strecke fertig',
  progress_failed: 'Strecke gescheitert', run_ended: 'Schnitzeljagd beendet',
};

function haversineMeters(a, b) {
  const R = 6371008.8, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export default function HuntPlay() {
  const { code: codeParam } = useParams();
  const [code, setCode] = useState(codeParam || '');
  const [joined, setJoined] = useState(false);
  const [joinErr, setJoinErr] = useState('');
  const [state, setState] = useState(null);
  const [myKey, setMyKey] = useState(null);
  const [pos, setPos] = useState(null);
  const [answerText, setAnswerText] = useState('');
  const runIdRef = useRef(null);
  const watchIdRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    const onJoined = ({ runId, key }) => { runIdRef.current = runId; setMyKey(key); setJoined(true); setJoinErr(''); };
    const onState = s => setState(s);
    const onErr = ({ err }) => setJoinErr(err === 'not_found' ? 'Code nicht gefunden'
      : err === 'expired' ? 'Code abgelaufen' : err === 'session_full' ? 'Session voll' : 'Fehler beim Beitreten');
    socket.on('hunt:live_joined', onJoined);
    socket.on('hunt:live_state', onState);
    socket.on('hunt:live_error', onErr);
    return () => {
      socket.off('hunt:live_joined', onJoined);
      socket.off('hunt:live_state', onState);
      socket.off('hunt:live_error', onErr);
      if (runIdRef.current) socket.emit('hunt:live_leave', { runId: runIdRef.current });
      if (watchIdRef.current != null) navigator.geolocation?.clearWatch(watchIdRef.current);
    };
  }, []);

  const join = () => {
    if (!code.trim()) return;
    getSocket().emit('hunt:join_by_code', { code: code.trim().toUpperCase() });
    if (navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        p => {
          const sample = { lat: p.coords.latitude, lon: p.coords.longitude };
          setPos(sample);
          if (runIdRef.current) getSocket().emit('hunt:live_telemetry', { runId: runIdRef.current, ...sample });
        },
        () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
      );
    }
  };

  const submitAnswer = poiId => {
    if (!answerText.trim() || !runIdRef.current) return;
    getSocket().emit('hunt:live_puzzle_answer', { runId: runIdRef.current, poiId, answer: answerText });
    setAnswerText('');
  };
  const confirmTask = poiId => {
    if (!runIdRef.current) return;
    getSocket().emit('hunt:live_confirm_task', { runId: runIdRef.current, poiId });
  };

  const myTrack = state?.tracks.find(t => t.key === myKey) || null;
  const otherTracks = state?.tracks.filter(t => t.key !== myKey) || [];

  if (!joined) {
    return (
      <div style={{ maxWidth: 360, margin: '40px auto', display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
        <h2 style={{ color: 'var(--text)' }}>Schnitzeljagd beitreten</h2>
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="CODE"
          style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 18, textAlign: 'center' }} />
        <button onClick={join} style={primaryBtnStyle}>Beitreten</button>
        {!!joinErr && <div style={{ color: 'var(--red)', fontSize: 13 }}>{joinErr}</div>}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {state?.endedAt && (
        <div style={{ background: 'var(--green)', color: '#0a2010', borderRadius: 8, padding: 12, fontWeight: 700 }}>
          🏆 Schnitzeljagd beendet!
        </div>
      )}

      <h3 style={{ color: 'var(--text)', margin: 0 }}>Deine Aufgabe(n)</h3>
      {myTrack?.completedAt ? (
        <div style={{ color: 'var(--text2)' }}>Deine Strecke ist fertig.</div>
      ) : (myTrack?.currentPois || []).map(poi => {
        const dist = pos ? Math.round(haversineMeters(pos, poi)) : null;
        const arrived = !!poi.arrivedAt;
        return (
          <div key={poi.id} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
            <div style={{ color: 'var(--text)', fontWeight: 700 }}>{POI_ICON[poi.type] || '📍'} {poi.name}</div>
            <div style={{ color: 'var(--text2)', fontSize: 12 }}>
              {dist !== null ? `${dist}m entfernt` : 'GPS wird gesucht…'}{arrived ? ' · angekommen' : ''}
            </div>
            {poi.type === 'puzzle' && arrived && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input value={answerText} onChange={e => setAnswerText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submitAnswer(poi.id)}
                  placeholder="Antwort…" style={inputStyle} />
                <button onClick={() => submitAnswer(poi.id)} style={secondaryBtnStyle}>✓</button>
              </div>
            )}
            {(poi.type === 'target' || poi.type === 'capture') && arrived && (
              <button onClick={() => confirmTask(poi.id)} style={{ ...secondaryBtnStyle, marginTop: 8 }}>Als erledigt bestätigen</button>
            )}
          </div>
        );
      })}

      {otherTracks.length > 0 && (
        <>
          <h4 style={{ color: 'var(--text)', margin: '8px 0 0' }}>
            {state.progressMode === 'teams' ? 'Anderes Team' : 'Andere Strecken'}
          </h4>
          {otherTracks.map(t => (
            <div key={t.key} style={{ color: 'var(--text2)', fontSize: 12 }}>
              {t.key} — {t.completedAt ? 'fertig' : `Gruppe ${t.groupIdx + 1}/${t.groupCount}`}
            </div>
          ))}
        </>
      )}

      <h4 style={{ color: 'var(--text)', margin: '8px 0 0' }}>Ereignisse</h4>
      {[...(state?.events || [])].reverse().slice(0, 10).map(e => (
        <div key={e.seq} style={{ color: 'var(--text3)', fontSize: 11 }}>{EVENT_LABEL[e.type] || e.type}</div>
      ))}
    </div>
  );
}

const inputStyle = {
  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', padding: '8px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box',
};
const primaryBtnStyle = {
  background: 'var(--gold)', color: '#1a1000', border: 'none', borderRadius: 6,
  padding: '10px 12px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
};
const secondaryBtnStyle = {
  background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '6px 10px', fontSize: 12, cursor: 'pointer',
};
