// SCHNITZELJAGD scenario editor — build a sequence of POIs (each with an
// action: puzzle, capture, destroy, carry-from/to, or a finishing base),
// connected top-to-bottom by routes, place them via a geofence-radius
// selector on the map, optionally attach a 3D model per POI, save the
// whole thing, then generate a scan code to play it directly.
//
// Leaflet-via-window.L + click-to-place + whole-document save mirror the
// existing precedents in this codebase (AropsLobbyPanel.jsx for the map
// pattern, MapEditor.jsx for the save/CRUD shape) rather than inventing a
// new one — see server/src/routes/hunt.js's header comment for the other
// half of this convention.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

const POI_TYPES = [
  { key: 'puzzle', label: 'Rätsel lösen', icon: '🧩' },
  { key: 'capture', label: 'Capture', icon: '🎯' },
  { key: 'target', label: 'Zerstören', icon: '💣' },
  { key: 'carry_from', label: 'Tragen: Abholpunkt', icon: '📦' },
  { key: 'carry_to', label: 'Tragen: Zielpunkt', icon: '🏁' },
  { key: 'base', label: 'Basis (Ziel erreichen)', icon: '🏆' },
];
const POI_TYPE_LABEL = Object.fromEntries(POI_TYPES.map(t => [t.key, t.label + ' ' + t.icon]));
const TIMEOUT_TYPES = [
  { key: 'skip', label: 'Überspringen' },
  { key: 'fail', label: 'Strecke scheitert' },
  { key: 'time_penalty', label: 'Zeitstrafe' },
];
let tempIdSeq = 0;
const newTempId = () => 'tmp_' + (++tempIdSeq) + '_' + Date.now();

export default function HuntEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [title, setTitle] = useState('Neue Schnitzeljagd');
  const [progressMode, setProgressMode] = useState('individual');
  const [pois, setPois] = useState([]); // [{tempId|id, order_index, name, lat, lon, radius_m, poi_type, puzzle_config, task_time_limit_ms, timeout_action, visualization, model_asset_url}]
  const [routes, setRoutes] = useState([]); // [{from_tempId|from_poi_id, to_tempId|to_poi_id, route_type, enforcement, travel_time_limit_ms, timeout_action}]
  const [selectedId, setSelectedId] = useState(null);
  const [scenarioId, setScenarioId] = useState(id || null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [sessions, setSessions] = useState([]);
  const [genCodeErr, setGenCodeErr] = useState('');
  const [uploadingId, setUploadingId] = useState(null);

  const mapRef = useRef(null);
  const layersRef = useRef({ markers: [], radius: null, lines: [] });
  const poisRef = useRef(pois);
  poisRef.current = pois;

  const poiKey = p => p.id ?? p.tempId;

  // ── Load existing scenario ──────────────────────────────────
  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const { data } = await api.get(`/hunt/scenarios/${id}`);
        setTitle(data.title);
        setProgressMode(data.config?.progressMode || 'individual');
        setPois((data.pois || []).map(p => ({ ...p })));
        setRoutes((data.routes || []).map(r => ({ ...r })));
        setScenarioId(data.id);
      } catch (e) {
        setSaveErr('Laden fehlgeschlagen');
      }
      setLoading(false);
    })();
  }, [id, isNew]);

  useEffect(() => {
    if (!scenarioId) return;
    api.get(`/hunt/scenarios/${scenarioId}/sessions`).then(({ data }) => setSessions(data)).catch(() => {});
  }, [scenarioId]);

  // ── Leaflet map ──────────────────────────────────────────────
  const [placing, setPlacing] = useState(true);
  const placingRef = useRef(true);
  placingRef.current = placing;

  useEffect(() => {
    const L = window.L;
    if (!L || mapRef.current) return;
    const map = L.map('hunt-editor-map', { zoomControl: true }).setView([48.1374, 11.5755], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(map);
    mapRef.current = map;
    navigator.geolocation?.getCurrentPosition(
      pos => map.setView([pos.coords.latitude, pos.coords.longitude], 16),
      () => {}, { timeout: 3000 }
    );
    map.on('click', e => {
      if (!placingRef.current) return;
      const cur = poisRef.current;
      const nextOrder = cur.length ? Math.max(...cur.map(p => p.order_index)) + 1 : 0;
      const tempId = newTempId();
      const poi = {
        tempId, order_index: nextOrder, name: `POI ${cur.length + 1}`,
        lat: e.latlng.lat, lon: e.latlng.lng, radius_m: 15, poi_type: 'target',
        puzzle_config: {}, task_time_limit_ms: null, timeout_action: {},
        visualization: 'satellite', model_asset_url: null,
      };
      setPois(p => [...p, poi]);
      if (cur.length) {
        const prev = cur[cur.length - 1];
        setRoutes(r => [...r, {
          from_tempId: poiKey(prev), to_tempId: tempId,
          route_type: 'freeform', enforcement: 'guidance', travel_time_limit_ms: null, timeout_action: {},
        }]);
      }
      setSelectedId(tempId);
    });
    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Redraw markers/radius/route-lines whenever pois/routes/selection change
  useEffect(() => {
    const L = window.L, map = mapRef.current;
    if (!L || !map) return;
    layersRef.current.markers.forEach(m => map.removeLayer(m));
    layersRef.current.markers = [];
    layersRef.current.lines.forEach(l => map.removeLayer(l));
    layersRef.current.lines = [];
    if (layersRef.current.radius) { map.removeLayer(layersRef.current.radius); layersRef.current.radius = null; }

    const sorted = [...pois].sort((a, b) => a.order_index - b.order_index);
    sorted.forEach((p, i) => {
      const isSelected = poiKey(p) === selectedId;
      const typeInfo = POI_TYPES.find(t => t.key === p.poi_type);
      const mk = L.circleMarker([p.lat, p.lon], {
        radius: isSelected ? 10 : 7,
        color: isSelected ? '#f0c840' : '#4090e0',
        fillColor: isSelected ? '#f0c840' : '#4090e0', fillOpacity: 0.85, weight: 2,
      }).addTo(map)
        .bindTooltip(`${i + 1}. ${p.name} (${typeInfo?.icon || ''})`, { permanent: false, direction: 'top' })
        .on('click', () => setSelectedId(poiKey(p)));
      layersRef.current.markers.push(mk);
    });

    // Geofence-radius preview for the selected POI only — keeps the map
    // readable once there are many POIs.
    const selected = pois.find(p => poiKey(p) === selectedId);
    if (selected) {
      layersRef.current.radius = L.circle([selected.lat, selected.lon], {
        radius: selected.radius_m, color: '#f0c840', fillColor: '#f0c840', fillOpacity: 0.12, weight: 1, dashArray: '4 4',
      }).addTo(map);
    }

    // Route lines between consecutive (by array order, matching order_index)
    // POIs — dashed for a parallel-group boundary (no enforceable single
    // path there, see hunt.js's advanceGroup), solid otherwise.
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      const sameGroup = a.order_index === b.order_index;
      layersRef.current.lines.push(
        L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
          color: sameGroup ? '#9050e0' : '#8880a0', weight: sameGroup ? 3 : 2,
          dashArray: sameGroup ? '2 6' : null, opacity: 0.7,
        }).addTo(map)
      );
    }
  }, [JSON.stringify(pois.map(p => ({ k: poiKey(p), lat: p.lat, lon: p.lon, r: p.radius_m, o: p.order_index, n: p.name, t: p.poi_type }))), selectedId]);

  const sortedPois = useMemo(() => [...pois].sort((a, b) => a.order_index - b.order_index), [pois]);
  const selected = pois.find(p => poiKey(p) === selectedId) || null;

  const updateSelected = patch => {
    setPois(ps => ps.map(p => (poiKey(p) === selectedId ? { ...p, ...patch } : p)));
  };
  const removeSelected = () => {
    if (!selected) return;
    const key = poiKey(selected);
    setPois(ps => ps.filter(p => poiKey(p) !== key));
    setRoutes(rs => rs.filter(r => r.from_tempId !== key && r.to_tempId !== key && r.from_poi_id !== key && r.to_poi_id !== key));
    setSelectedId(null);
  };
  const moveSelected = dir => {
    if (!selected) return;
    const idx = sortedPois.findIndex(p => poiKey(p) === selectedId);
    const swapWith = sortedPois[idx + dir];
    if (!swapWith) return;
    // Swap order_index values — simplest correct reorder that also keeps
    // parallel-group membership (equal order_index) intact when swapping
    // past a group boundary rather than within one.
    setPois(ps => ps.map(p => {
      const k = poiKey(p);
      if (k === selectedId) return { ...p, order_index: swapWith.order_index };
      if (k === poiKey(swapWith)) return { ...p, order_index: selected.order_index };
      return p;
    }));
  };
  const makeParallelWithPrevious = () => {
    if (!selected) return;
    const idx = sortedPois.findIndex(p => poiKey(p) === selectedId);
    const prev = sortedPois[idx - 1];
    if (!prev) return;
    updateSelected({ order_index: prev.order_index });
  };
  const makeSequentialAgain = () => {
    if (!selected) return;
    const idx = sortedPois.findIndex(p => poiKey(p) === selectedId);
    updateSelected({ order_index: (sortedPois[idx - 1]?.order_index ?? -1) + 1 });
  };

  const routeAfter = poi => {
    const idx = sortedPois.findIndex(p => poiKey(p) === poiKey(poi));
    const next = sortedPois[idx + 1];
    if (!next) return null;
    return routes.find(r => (r.from_tempId ?? r.from_poi_id) === poiKey(poi) && (r.to_tempId ?? r.to_poi_id) === poiKey(next)) || null;
  };
  const updateRouteAfter = (poi, patch) => {
    const idx = sortedPois.findIndex(p => poiKey(p) === poiKey(poi));
    const next = sortedPois[idx + 1];
    if (!next) return;
    const fromKey = poiKey(poi), toKey = poiKey(next);
    setRoutes(rs => {
      const exists = rs.some(r => (r.from_tempId ?? r.from_poi_id) === fromKey && (r.to_tempId ?? r.to_poi_id) === toKey);
      if (exists) {
        return rs.map(r => ((r.from_tempId ?? r.from_poi_id) === fromKey && (r.to_tempId ?? r.to_poi_id) === toKey) ? { ...r, ...patch } : r);
      }
      return [...rs, { from_tempId: fromKey, to_tempId: toKey, route_type: 'freeform', enforcement: 'guidance', travel_time_limit_ms: null, timeout_action: {}, ...patch }];
    });
  };

  const uploadModel = async file => {
    if (!selected) return;
    const key = poiKey(selected);
    setUploadingId(key);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/hunt/pois/upload-model', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPois(ps => ps.map(p => (poiKey(p) === key ? { ...p, model_asset_url: data.url } : p)));
    } catch (e) { /* best-effort — leave model_asset_url unset on failure */ }
    setUploadingId(null);
  };

  const save = async () => {
    if (!title.trim() || pois.length === 0) { setSaveErr('Titel und mindestens 1 POI nötig'); return; }
    setSaving(true);
    setSaveErr('');
    try {
      const payload = { title: title.trim(), config: { progressMode }, pois, routes };
      const { data } = scenarioId
        ? await api.put(`/hunt/scenarios/${scenarioId}`, payload)
        : await api.post('/hunt/scenarios', payload);
      setScenarioId(data.id);
      setPois((data.pois || []).map(p => ({ ...p })));
      setRoutes((data.routes || []).map(r => ({ ...r })));
      if (isNew) navigate(`/hunt/editor/${data.id}`, { replace: true });
    } catch (e) {
      setSaveErr(e.response?.data?.error || 'Speichern fehlgeschlagen');
    }
    setSaving(false);
  };

  const generateCode = async () => {
    if (!scenarioId) return;
    setGenCodeErr('');
    try {
      const { data } = await api.post(`/hunt/scenarios/${scenarioId}/sessions`, {});
      setSessions(s => [data, ...s]);
    } catch (e) {
      setGenCodeErr('Konnte keinen Code erzeugen — erst speichern?');
    }
  };

  if (loading) return <div className="loading-screen">⏳ Lädt…</div>;

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: '80vh', gap: 12, padding: 12 }}>
      {/* ── Left: sequence list ── */}
      <div style={{ width: 260, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Titel der Schnitzeljagd"
          style={inputStyle} />
        <div style={{ display: 'flex', gap: 4 }}>
          {['individual', 'teams', 'shared'].map(m => (
            <button key={m} onClick={() => setProgressMode(m)}
              style={toggleBtnStyle(progressMode === m)}>
              {m === 'individual' ? 'Einzeln' : m === 'teams' ? 'Teams' : 'Gemeinsam'}
            </button>
          ))}
        </div>
        <button onClick={() => setPlacing(v => !v)} style={toggleBtnStyle(placing)}>
          {placing ? '📍 Klicke auf die Karte, um POIs zu setzen' : '📍 POI-Platzierung pausiert'}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text2)' }}>
          Reihenfolge von oben nach unten. &quot;Parallel&quot; macht ein POI zusammen mit dem vorherigen zu einer Gruppe,
          die in beliebiger Reihenfolge erledigt werden kann.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {sortedPois.map((p, i) => {
            const prev = sortedPois[i - 1];
            const isParallel = prev && prev.order_index === p.order_index;
            const typeInfo = POI_TYPES.find(t => t.key === p.poi_type);
            return (
              <div key={poiKey(p)} onClick={() => setSelectedId(poiKey(p))}
                style={{
                  padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
                  background: poiKey(p) === selectedId ? 'var(--bg3)' : 'var(--bg2)',
                  border: `1px solid ${poiKey(p) === selectedId ? 'var(--gold)' : 'var(--border)'}`,
                  marginLeft: isParallel ? 14 : 0,
                }}>
                <div style={{ fontSize: 12, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {isParallel && <span title="Parallel zum vorherigen POI">⇄</span>}
                  {i + 1}. {p.name} {typeInfo?.icon}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text2)' }}>{typeInfo?.label}</div>
              </div>
            );
          })}
          {!sortedPois.length && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Noch keine POIs — auf die Karte klicken.</div>}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!!saveErr && <div style={{ color: 'var(--red)', fontSize: 12 }}>{saveErr}</div>}
          <button onClick={save} disabled={saving} style={primaryBtnStyle}>
            {saving ? 'Speichere…' : '💾 Speichern'}
          </button>
          <button onClick={generateCode} disabled={!scenarioId} style={secondaryBtnStyle}>
            🔑 Code erzeugen
          </button>
          {!!genCodeErr && <div style={{ color: 'var(--red)', fontSize: 12 }}>{genCodeErr}</div>}
          {sessions.map(s => (
            <div key={s.id} style={{ fontSize: 13, color: 'var(--gold)', fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between' }}>
              <span>{s.code}</span>
              <a href={`/hunt/play/${s.code}`} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontSize: 11 }}>Spielen ↗</a>
            </div>
          ))}
        </div>
      </div>

      {/* ── Middle: map ── */}
      <div style={{ flex: 1, minWidth: 300, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div id="hunt-editor-map" style={{ width: '100%', height: '100%', minHeight: 400 }} />
      </div>

      {/* ── Right: selected POI settings ── */}
      <div style={{ width: 300, overflowY: 'auto' }}>
        {!selected && <div style={{ color: 'var(--text3)', fontSize: 12, padding: 12 }}>Kein POI ausgewählt.</div>}
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 4 }}>
            <input value={selected.name} onChange={e => updateSelected({ name: e.target.value })} style={inputStyle} placeholder="Name" />

            <label style={labelStyle}>Aktion</label>
            <select value={selected.poi_type} onChange={e => updateSelected({ poi_type: e.target.value })} style={inputStyle}>
              {POI_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>

            {selected.poi_type === 'puzzle' && (
              <>
                <label style={labelStyle}>Antwort (Groß/Kleinschreibung egal)</label>
                <input value={selected.puzzle_config?.answer || ''}
                  onChange={e => updateSelected({ puzzle_config: { ...selected.puzzle_config, answer: e.target.value } })}
                  style={inputStyle} placeholder="Antwort" />
              </>
            )}

            <label style={labelStyle}>Geofence-Radius: {selected.radius_m}m</label>
            <input type="range" min={5} max={100} value={selected.radius_m}
              onChange={e => updateSelected({ radius_m: +e.target.value })} />

            <label style={labelStyle}>Visualisierung</label>
            <select value={selected.visualization} onChange={e => updateSelected({ visualization: e.target.value })} style={inputStyle}>
              <option value="satellite">Satellit</option>
              <option value="comic">Comic-Karte</option>
              <option value="model3d">3D-Objekt einblenden</option>
            </select>
            {selected.visualization === 'model3d' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <input type="file" accept=".glb,.gltf,image/*"
                  onChange={e => e.target.files[0] && uploadModel(e.target.files[0])} />
                {uploadingId === poiKey(selected) && <span style={{ fontSize: 11, color: 'var(--text2)' }}>Lädt hoch…</span>}
                {selected.model_asset_url && (
                  <span style={{ fontSize: 11, color: 'var(--green)', wordBreak: 'break-all' }}>✓ {selected.model_asset_url}</span>
                )}
              </div>
            )}

            <label style={labelStyle}>Zeitlimit für die Aufgabe (s, leer = kein Limit)</label>
            <input type="number" min={0} value={selected.task_time_limit_ms ? Math.round(selected.task_time_limit_ms / 1000) : ''}
              onChange={e => updateSelected({ task_time_limit_ms: e.target.value ? +e.target.value * 1000 : null })}
              style={inputStyle} placeholder="z.B. 60" />
            {!!selected.task_time_limit_ms && (
              <select value={selected.timeout_action?.type || 'skip'}
                onChange={e => updateSelected({ timeout_action: { ...selected.timeout_action, type: e.target.value } })}
                style={inputStyle}>
                {TIMEOUT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            )}

            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => moveSelected(-1)} style={secondaryBtnStyle}>↑ Nach oben</button>
              <button onClick={() => moveSelected(1)} style={secondaryBtnStyle}>↓ Nach unten</button>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={makeParallelWithPrevious} style={secondaryBtnStyle}>⇄ Parallel zum vorherigen</button>
              <button onClick={makeSequentialAgain} style={secondaryBtnStyle}>Wieder sequentiell</button>
            </div>

            {routeAfter(selected) && (
              <>
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8, fontSize: 12, color: 'var(--text2)' }}>
                  Route zum nächsten POI
                </div>
                <label style={labelStyle}>Erzwingung</label>
                <select value={routeAfter(selected).enforcement} onChange={e => updateRouteAfter(selected, { enforcement: e.target.value })} style={inputStyle}>
                  <option value="guidance">Nur Hinweis (frei begehbar)</option>
                  <option value="strict">Strikt (Route einhalten)</option>
                </select>
                <label style={labelStyle}>Zeitlimit für die Route (s, leer = kein Limit)</label>
                <input type="number" min={0} value={routeAfter(selected).travel_time_limit_ms ? Math.round(routeAfter(selected).travel_time_limit_ms / 1000) : ''}
                  onChange={e => updateRouteAfter(selected, { travel_time_limit_ms: e.target.value ? +e.target.value * 1000 : null })}
                  style={inputStyle} placeholder="z.B. 180" />
              </>
            )}

            <button onClick={removeSelected} style={{ ...secondaryBtnStyle, color: 'var(--red)', borderColor: 'var(--red)', marginTop: 8 }}>
              🗑 POI löschen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', padding: '6px 8px', fontSize: 13, width: '100%', boxSizing: 'border-box',
};
const labelStyle = { fontSize: 11, color: 'var(--text2)', marginBottom: -4 };
const primaryBtnStyle = {
  background: 'var(--gold)', color: '#1a1000', border: 'none', borderRadius: 6,
  padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const secondaryBtnStyle = {
  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '6px 10px', fontSize: 12, cursor: 'pointer', flex: 1,
};
const toggleBtnStyle = active => ({
  ...secondaryBtnStyle,
  background: active ? 'var(--gold)' : 'var(--bg2)',
  color: active ? '#1a1000' : 'var(--text)',
  borderColor: active ? 'var(--gold)' : 'var(--border)',
  fontWeight: active ? 700 : 400,
});
