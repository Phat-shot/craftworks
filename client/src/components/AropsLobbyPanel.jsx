// AR Ops lobby panel: host draws the playfield on an OSM map,
// assigns seeker/hider roles and sets timers. Non-hosts see everything read-only.
import React, { useEffect, useRef, useState } from 'react';

const HIDING_OPTIONS = [
  { label: '1 min', ms: 60_000 },
  { label: '2 min', ms: 120_000 },
  { label: '3 min', ms: 180_000 },
];
const DURATION_OPTIONS = [
  { label: '10 min', ms: 600_000 },
  { label: '15 min', ms: 900_000 },
  { label: '20 min', ms: 1_200_000 },
  { label: '30 min', ms: 1_800_000 },
];
const SUB_MODES = [
  { id: 'hide_and_seek', label: '🫥 Hide & Seek', zones: 0 },
  { id: 'domination',    label: '🎯 Domination',  zones: 2 },
  { id: 'ctf',           label: '🚩 CTF',          zones: 0 },
  { id: 'seek_destroy',  label: '💣 Seek & Destroy', zones: 1 },
];
const ERR_LABELS = {
  too_few_points: 'Mindestens 3 Wegpunkte setzen',
  self_intersecting: 'Fläche überschneidet sich selbst',
  area_too_small: 'Fläche zu klein (min. 2.000 m²)',
  area_too_large: 'Fläche zu groß (max. 3 km²)',
};

export default function AropsLobbyPanel({ lobbyId, isHost, members, hostId, socket, initialSettings }) {
  const [ar, setAr] = useState(initialSettings || {});
  const [polyCheck, setPolyCheck] = useState(null);
  const [effective, setEffective] = useState(null);
  const [tapMode, setTapMode] = useState('polygon'); // 'polygon' | 'zones'
  const tapModeRef = useRef('polygon');
  tapModeRef.current = tapMode;
  const mapRef = useRef(null);
  const layersRef = useRef({ markers: [], polygon: null });
  const arRef = useRef(ar);
  arRef.current = ar;

  const polygon = ar.polygon || [];
  const roles = ar.roles || {};

  // Effective role: explicit assignment, else first member defaults to seeker
  const roleOf = (uid) => (ar.roles || {})[uid] || 'hider';

  const emitUpdate = (patch) => {
    socket?.emit('lobby:ar_update', { lobbyId, arSettings: { ...arRef.current, ...patch } });
  };

  // ── Server sync ──────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onUpdated = ({ arSettings, polygonCheck, effective: eff }) => {
      setAr(arSettings || {});
      setPolyCheck(polygonCheck);
      if (eff) setEffective(eff);
    };
    socket.on('lobby:ar_updated', onUpdated);
    return () => socket.off('lobby:ar_updated', onUpdated);
  }, [socket]);

  // ── Leaflet map ──────────────────────────────────────────
  useEffect(() => {
    const L = window.L;
    if (!L || mapRef.current) return;
    const map = L.map('arops-map', { zoomControl: true }).setView([48.1374, 11.5755], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(map);
    mapRef.current = map;

    // Center on device position if permitted
    navigator.geolocation?.getCurrentPosition(
      (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 16),
      () => {}, { timeout: 3000 }
    );

    if (isHost) {
      map.on('click', (e) => {
        const pt = { lat: e.latlng.lat, lon: e.latlng.lng };
        if (tapModeRef.current === 'zones') {
          emitUpdate({ zones: [...(arRef.current.zones || []), pt] });
        } else {
          emitUpdate({ polygon: [...(arRef.current.polygon || []), pt] });
        }
      });
    }
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);

  // Redraw polygon + zone markers whenever they change
  const zones = ar.zones || [];
  useEffect(() => {
    const L = window.L, map = mapRef.current;
    if (!L || !map) return;
    layersRef.current.markers.forEach(m => map.removeLayer(m));
    layersRef.current.markers = [];
    if (layersRef.current.polygon) { map.removeLayer(layersRef.current.polygon); layersRef.current.polygon = null; }

    zones.forEach((z, i) => {
      const c = L.circle([z.lat, z.lon], {
        radius: 18, color: '#40a0e0', fillColor: '#40a0e0', fillOpacity: 0.25,
      }).addTo(map).bindTooltip('Zone ' + (i + 1), { permanent: true, direction: 'center' });
      layersRef.current.markers.push(c);
    });

    polygon.forEach((p, i) => {
      const mk = L.circleMarker([p.lat, p.lon], {
        radius: 6, color: '#f0c840', fillColor: '#f0c840', fillOpacity: 0.9,
      }).addTo(map).bindTooltip(String(i + 1), { permanent: true, direction: 'top', offset: [0, -6] });
      layersRef.current.markers.push(mk);
    });
    if (polygon.length >= 3) {
      const ok = polyCheck ? polyCheck.ok : true;
      layersRef.current.polygon = L.polygon(polygon.map(p => [p.lat, p.lon]), {
        color: ok ? '#50d040' : '#e03020', weight: 2, fillOpacity: 0.12,
      }).addTo(map);
    }
  }, [JSON.stringify(polygon), JSON.stringify(zones), polyCheck?.ok]);

  const subMode = ar.subMode || 'hide_and_seek';
  const isTeamMode = subMode !== 'hide_and_seek';
  const needsZones = subMode === 'domination' || subMode === 'seek_destroy';
  const teamOf = (uid) => effective?.teams?.[uid] || (ar.teams || {})[uid] || 'a';
  const seekerCount = members.filter(m => roleOf(m.id) === 'seeker').length;
  const areaLabel = polyCheck?.areaM2
    ? (polyCheck.areaM2 >= 10_000 ? (polyCheck.areaM2 / 10_000).toFixed(1) + ' ha' : Math.round(polyCheck.areaM2) + ' m²')
    : null;

  return (
    <div className="card" style={{ marginBottom: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--gold)', marginBottom: 8 }}>
        🛰️ AR Ops — Spielfeld{isHost ? ' (auf Karte tippen zum Zeichnen)' : ''}
      </div>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {SUB_MODES.map(m => (
          <button key={m.id} className="btn btn-ghost btn-sm" disabled={!isHost}
            onClick={() => emitUpdate({ subMode: m.id })}
            style={{ borderColor: subMode === m.id ? 'var(--gold)' : undefined,
                     color: subMode === m.id ? 'var(--gold)' : undefined }}>
            {m.label}
          </button>
        ))}
      </div>
      {isHost && needsZones && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>Karten-Tap setzt:</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setTapMode('polygon')}
            style={{ borderColor: tapMode === 'polygon' ? 'var(--gold)' : undefined }}>📐 Feld</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setTapMode('zones')}
            style={{ borderColor: tapMode === 'zones' ? '#40a0e0' : undefined, color: tapMode === 'zones' ? '#40a0e0' : undefined }}>🔵 Zonen ({zones.length})</button>
          {zones.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => emitUpdate({ zones: zones.slice(0, -1) })}>↩</button>
          )}
        </div>
      )}

      <div id="arops-map" style={{ height: 280, borderRadius: 8, border: '1px solid var(--border2)', marginBottom: 8 }} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
          {polygon.length} Wegpunkte{areaLabel ? ` · ${areaLabel}` : ''}
        </span>
        {isHost && polygon.length > 0 && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => emitUpdate({ polygon: polygon.slice(0, -1) })}>↩ Letzter Punkt</button>
            <button className="btn btn-ghost btn-sm" onClick={() => emitUpdate({ polygon: [] })}>🗑 Leeren</button>
          </>
        )}
      </div>

      {polyCheck && !polyCheck.ok && (
        <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 11 }}>
          {polyCheck.errors.map(e => ERR_LABELS[e] || e).join(' · ')}
        </div>
      )}
      {polyCheck?.ok && (
        <div className="alert alert-success" style={{ marginBottom: 10, fontSize: 11 }}>✓ Spielfeld gültig</div>
      )}

      {/* Roles (H&S) or Teams (team modes) */}
      {!isTeamMode ? (<>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>
        Rollen ({seekerCount} Seeker / {members.length - seekerCount} Hider)
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {members.map(m => {
          const role = roleOf(m.id);
          return (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ flex: 1 }}>{m.username}{m.id === hostId ? ' 👑' : ''}</span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!isHost}
                onClick={() => emitUpdate({ roles: { ...members.reduce((a, x) => ({ ...a, [x.id]: roleOf(x.id) }), {}), [m.id]: role === 'seeker' ? 'hider' : 'seeker' } })}
                style={{ minWidth: 92, color: role === 'seeker' ? '#e08040' : '#60c0e0' }}
              >
                {role === 'seeker' ? '🔦 Seeker' : '🫥 Hider'}
              </button>
            </div>
          );
        })}
      </div>
      </>) : (<>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>
        Teams {subMode === 'seek_destroy' ? '(A = Angreifer, B = Verteidiger)' : ''}
        {' · Captain setzt die CTF-Base'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {members.map(m => {
          const tm = teamOf(m.id);
          return (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ flex: 1 }}>{m.username}{m.id === hostId ? ' 👑' : ''}</span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!isHost}
                onClick={() => emitUpdate({ teams: { ...members.reduce((a, x) => ({ ...a, [x.id]: teamOf(x.id) }), {}), [m.id]: tm === 'a' ? 'b' : 'a' } })}
                style={{ minWidth: 92, color: tm === 'a' ? '#e08040' : '#40a0e0' }}
              >
                {tm === 'a' ? '🅰 Team A' : '🅱 Team B'}
              </button>
            </div>
          );
        })}
      </div>
      </>)}

      {/* Timers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 }}>Versteck-Vorsprung</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {HIDING_OPTIONS.map(o => (
              <button key={o.ms} disabled={!isHost}
                className="btn btn-ghost btn-sm"
                onClick={() => emitUpdate({ hidingDurationMs: o.ms })}
                style={{ flex: 1, borderColor: (ar.hidingDurationMs || 120_000) === o.ms ? 'var(--gold)' : undefined,
                         color: (ar.hidingDurationMs || 120_000) === o.ms ? 'var(--gold)' : undefined }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 }}>Spieldauer</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {DURATION_OPTIONS.map(o => (
              <button key={o.ms} disabled={!isHost}
                className="btn btn-ghost btn-sm"
                onClick={() => emitUpdate({ gameDurationMs: o.ms })}
                style={{ flex: 1, borderColor: (ar.gameDurationMs || 1_200_000) === o.ms ? 'var(--gold)' : undefined,
                         color: (ar.gameDurationMs || 1_200_000) === o.ms ? 'var(--gold)' : undefined }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
