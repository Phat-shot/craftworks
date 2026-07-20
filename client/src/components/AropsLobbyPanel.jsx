// AR Ops lobby panel: host draws the playfield on an OSM map,
// assigns seeker/hider roles and sets timers. Non-hosts see everything read-only.
import React, { useEffect, useRef, useState } from 'react';
import { GAME_MODE_PROFILES, PLAYER_TYPE_PROFILES } from '@craftworks/arops-shared';

// Minimal reusable tooltip (Phase 6 of the AR-Ops modes plan: "Tooltip-System") —
// shows a Steckbrief's shortDescription on hover, no extra dependency. Icons/
// short labels stay local UI config (not game data), but the actual
// descriptive text comes from the single source of truth in
// packages/arops-shared/src/profiles.ts, not a second hardcoded copy here.
function Tip({ text, children }) {
  const [show, setShow] = useState(false);
  if (!text) return children;
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: 6, background: '#141020', border: '1px solid var(--border2)',
          borderRadius: 6, padding: '6px 10px', fontSize: 11, color: 'var(--text2)',
          width: 220, zIndex: 50, pointerEvents: 'none', lineHeight: 1.4,
          boxShadow: '0 4px 12px rgba(0,0,0,.4)',
        }}>
          {text}
        </span>
      )}
    </span>
  );
}

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
// Short labels — 5 modes need to fit on one line.
const SUB_MODES = [
  { id: 'hide_and_seek', label: '🫥 H&S', zones: 0 },
  { id: 'domination',    label: '🎯 DOM', zones: 2 },
  { id: 'ctf',           label: '🚩 CtF', zones: 0 },
  { id: 'seek_destroy',  label: '💣 Bomb', zones: 1 },
  { id: 'deathmatch',    label: '💀 DM',   zones: 0 },
];
// Modes with real team assignment — hide_and_seek (all 3 variants: classic,
// ffa "Jeder gegen jeden", the_ship) has no teams at all (usesTeams: false
// server-side, see server/src/game/arops.js's MODES table).
const TEAM_MODES = ['domination', 'ctf', 'seek_destroy', 'deathmatch'];
// Modes with a captain-driven base_setup phase (see arops.js) — only these
// two actually place a base; domination/seek_destroy never did despite the
// old caption implying otherwise for every team mode.
const HAS_CAPTAIN_BASE = ['ctf', 'deathmatch'];
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

  // Debounced: rapidly clicking through several mode/settings buttons in a
  // row previously fired one full lobby:ar_update round-trip PER CLICK —
  // each its own DB read (effectiveArSettings) + write + broadcast to
  // everyone in the lobby (mirrors the same fix in the mobile app's
  // LobbyScreen — see its comment for the reported symptom this addresses).
  const pendingPatchRef = useRef({});
  const emitTimerRef = useRef(null);
  useEffect(() => () => { if (emitTimerRef.current) clearTimeout(emitTimerRef.current); }, []);
  const emitUpdate = (patch) => {
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    emitTimerRef.current = setTimeout(() => {
      const merged = { ...arRef.current, ...pendingPatchRef.current };
      pendingPatchRef.current = {};
      emitTimerRef.current = null;
      socket?.emit('lobby:ar_update', { lobbyId, arSettings: merged });
    }, 150);
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
  const isTeamMode = TEAM_MODES.includes(subMode);
  const needsZones = subMode === 'domination' || subMode === 'seek_destroy';
  const hasCaptainBase = HAS_CAPTAIN_BASE.includes(subMode);
  const hsVariant = ['ffa', 'the_ship'].includes(ar.hsVariant) ? ar.hsVariant : 'classic';
  // ffa/The Ship have no roles at all (not seeker/hider, not team) — the
  // per-player role toggle only makes sense for the classic variant.
  const rolesApply = subMode === 'hide_and_seek' && hsVariant === 'classic';
  const foundMode = ar.foundMode || 'spectator';
  const destroyVariant = ar.destroyVariant === 'defuse' ? 'defuse' : 'instant';
  const deathmatchOnHit = ar.deathmatchOnHit === 'freeze' ? 'freeze' : 'respawn';
  const livesPerPlayer = ar.livesPerPlayer || 3;
  const teamOf = (uid) => effective?.teams?.[uid] || (ar.teams || {})[uid] || 'a';
  const seekerCount = members.filter(m => roleOf(m.id) === 'seeker').length;
  // Player classes (scout/sniper/bomber) — additive to role/team, every
  // mode, no host obligation to assign one (null = classless, unchanged
  // combat stats). Tap-to-cycle: none -> scout -> sniper -> bomber -> none.
  const CLASS_CYCLE = ['scout', 'sniper', 'bomber'];
  const classOf = (uid) => (ar.classes || {})[uid] || null;
  const cycleClass = (uid) => {
    if (!isHost) return;
    const cur = classOf(uid);
    const idx = cur ? CLASS_CYCLE.indexOf(cur) : -1;
    const next = idx === CLASS_CYCLE.length - 1 ? null : CLASS_CYCLE[idx + 1];
    const classes = { ...(ar.classes || {}) };
    if (next) classes[uid] = next; else delete classes[uid];
    emitUpdate({ classes });
  };
  const CLASS_ICON = { scout: '🔭', sniper: '🎯', bomber: '💣' };
  const areaLabel = polyCheck?.areaM2
    ? (polyCheck.areaM2 >= 10_000 ? (polyCheck.areaM2 / 10_000).toFixed(1) + ' ha' : Math.round(polyCheck.areaM2) + ' m²')
    : null;

  return (
    <div className="card" style={{ marginBottom: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--gold)', marginBottom: 8 }}>
        🛰️ AR Ops — Spielfeld{isHost ? ' (auf Karte tippen zum Zeichnen)' : ''}
      </div>

      {/* Mode selector — short labels/icons are local UI config, the
          descriptive tooltip text comes straight from the Steckbrief
          (GAME_MODE_PROFILES), not a second hardcoded copy. */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {SUB_MODES.map(m => (
          <Tip key={m.id} text={GAME_MODE_PROFILES[m.id]?.shortDescription}>
            <button className="btn btn-ghost btn-sm" disabled={!isHost}
              onClick={() => emitUpdate({ subMode: m.id })}
              style={{ borderColor: subMode === m.id ? 'var(--gold)' : undefined,
                       color: subMode === m.id ? 'var(--gold)' : undefined }}>
              {m.label}
            </button>
          </Tip>
        ))}
      </div>
      {/* Alle Modus-spezifischen Einstellungen konsistent direkt unter dem
          Modus-Umschalter, für jeden Modus gleich positioniert (vorher lagen
          sie erst nach Karte + Rollen/Teams/Klassen — uneinheitlich mit der
          Mobile-App, wo nur hsVariant oben war). */}
      {subMode === 'hide_and_seek' && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          <button className="btn btn-ghost btn-sm" disabled={!isHost}
            onClick={() => emitUpdate({ hsVariant: 'classic' })}
            style={{ borderColor: hsVariant === 'classic' ? 'var(--gold)' : undefined,
                     color: hsVariant === 'classic' ? 'var(--gold)' : undefined }}>
            🫥 Team
          </button>
          <Tip text={GAME_MODE_PROFILES.hide_and_seek?.submodes.find(sm => sm.id === 'ffa')?.shortDescription}>
            <button className="btn btn-ghost btn-sm" disabled={!isHost}
              onClick={() => emitUpdate({ hsVariant: 'ffa' })}
              style={{ borderColor: hsVariant === 'ffa' ? 'var(--gold)' : undefined,
                       color: hsVariant === 'ffa' ? 'var(--gold)' : undefined }}>
              🎯 Jeder gegen jeden
            </button>
          </Tip>
          <Tip text={GAME_MODE_PROFILES.hide_and_seek?.submodes.find(sm => sm.id === 'the_ship')?.shortDescription}>
            <button className="btn btn-ghost btn-sm" disabled={!isHost}
              onClick={() => emitUpdate({ hsVariant: 'the_ship' })}
              style={{ borderColor: hsVariant === 'the_ship' ? 'var(--gold)' : undefined,
                       color: hsVariant === 'the_ship' ? 'var(--gold)' : undefined }}>
              🎭 The Ship
            </button>
          </Tip>
        </div>
      )}
      {/* Domination/CTF haben keine echte Variante zum Umschalten, zeigen
          aber trotzdem eine Zeile in derselben Position wie jeder andere
          Modus — sonst wirkt die Lobby inkonsistent (leere Lücke bei genau
          diesen Modi). Zerstören/Deathmatch haben zwar schon eigene Zeilen
          weiter unten, aber auch dort fehlte bisher die Team-Kennzeichnung. */}
      {TEAM_MODES.includes(subMode) && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
            👥 Team-Modus (A vs. B){hasCaptainBase ? ' · Captain platziert die Basis' : ''}
          </span>
        </div>
      )}
      {rolesApply && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>Gefunden:</span>
          {[['spectator', '👻 Zuschauer'], ['seeker', '🔁 Weiterspielen'], ['freeze', '❄️ Einfrieren']].map(([id, label]) => (
            <button key={id} className="btn btn-ghost btn-sm" disabled={!isHost}
              onClick={() => emitUpdate({ foundMode: id })}
              style={{ borderColor: foundMode === id ? 'var(--gold)' : undefined,
                       color: foundMode === id ? 'var(--gold)' : undefined }}>
              {label}
            </button>
          ))}
        </div>
      )}
      {subMode === 'seek_destroy' && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>Zerstören:</span>
          {[['instant', 'Symmetrisch'], ['defuse', 'Entschärfen']].map(([id, label]) => (
            <button key={id} className="btn btn-ghost btn-sm" disabled={!isHost}
              onClick={() => emitUpdate({ destroyVariant: id })}
              style={{ borderColor: destroyVariant === id ? 'var(--gold)' : undefined,
                       color: destroyVariant === id ? 'var(--gold)' : undefined }}>
              {label}
            </button>
          ))}
          <button className="btn btn-ghost btn-sm" disabled={!isHost}
            onClick={() => emitUpdate({ destroyReactivate: !ar.destroyReactivate })}
            style={{ borderColor: ar.destroyReactivate ? 'var(--gold)' : undefined,
                     color: ar.destroyReactivate ? 'var(--gold)' : undefined }}>
            🔁 Ziele reaktivieren
          </button>
        </div>
      )}
      {subMode === 'deathmatch' && (<>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>Treffer:</span>
          {[['respawn', 'Leben verlieren'], ['freeze', '❄️ Einfrieren']].map(([id, label]) => (
            <button key={id} className="btn btn-ghost btn-sm" disabled={!isHost}
              onClick={() => emitUpdate({ deathmatchOnHit: id })}
              style={{ borderColor: deathmatchOnHit === id ? 'var(--gold)' : undefined,
                       color: deathmatchOnHit === id ? 'var(--gold)' : undefined }}>
              {label}
            </button>
          ))}
        </div>
        {deathmatchOnHit === 'respawn' && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>Leben:</span>
            {[1, 3, 5].map(n => (
              <button key={n} className="btn btn-ghost btn-sm" disabled={!isHost}
                onClick={() => emitUpdate({ livesPerPlayer: n })}
                style={{ borderColor: livesPerPlayer === n ? 'var(--gold)' : undefined,
                         color: livesPerPlayer === n ? 'var(--gold)' : undefined }}>
                {n}
              </button>
            ))}
          </div>
        )}
      </>)}

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

      {/* Roles (H&S classic) / Teams (team modes) / neither (The Ship, Battle Royale) */}
      {rolesApply ? (<>
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
      </>) : isTeamMode ? (<>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>
        Teams {subMode === 'seek_destroy' ? '(A = Angreifer, B = Verteidiger)' : ''}
        {hasCaptainBase ? ' · Captain setzt die Basis' : ''}
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
      </>) : (
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>
        {hsVariant === 'the_ship'
          ? '🎭 The Ship: jeder bekommt beim Start ein geheimes Ziel zugewiesen — keine Rollen/Teams in der Lobby.'
          : '🎯 Jeder gegen jeden — keine Rollen/Teams in der Lobby.'}
      </div>
      )}

      {/* Spielerklassen (scout/sniper/bomber) — additiv zu Rolle/Team, in
          jedem Modus wählbar, kein Zwang. Tooltip zeigt die Steckbrief-
          Beschreibung der aktuell gewählten Klasse. */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>
        Klassen (optional, zusätzlich zu Rolle/Team)
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {members.map(m => {
          const cls = classOf(m.id);
          const profile = cls ? PLAYER_TYPE_PROFILES[cls] : null;
          return (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ flex: 1 }}>{m.username}{m.id === hostId ? ' 👑' : ''}</span>
              <Tip text={profile ? profile.shortDescription : 'Keine Klasse — Standard-Schusswerte.'}>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!isHost}
                  onClick={() => cycleClass(m.id)}
                  style={{ minWidth: 92, color: cls ? 'var(--gold)' : undefined }}
                >
                  {cls ? `${CLASS_ICON[cls]} ${profile.name}` : '– Klasse'}
                </button>
              </Tip>
            </div>
          );
        })}
      </div>

      {/* Timers */}
      <div style={{ display: 'grid', gridTemplateColumns: rolesApply ? '1fr 1fr' : '1fr', gap: 10 }}>
        {rolesApply && (
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
        )}
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
