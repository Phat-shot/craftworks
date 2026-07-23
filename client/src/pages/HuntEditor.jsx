// SCHNITZELJAGD scenario editor — build a sequence of POIs (each with an
// action: puzzle, capture, destroy, carry-from/to, or a finishing base),
// placed via a geofence-radius selector on the map, optionally with a 3D
// model per POI. Parallelism is IMPLICIT: any run of consecutive POIs with
// nothing between them is one parallel group (worked in any order). An
// optional "Weg"-block can be inserted between two POIs to force them
// sequential and (when it sits between exactly one POI and exactly one
// POI — the only shape the engine can enforce a single path/deadline for,
// see server/src/game/hunt.js's advanceGroup) additionally carry a route
// mode (fixed path vs. nav-arrow-guided target) and a time limit.
//
// Data model: `items` is a single ordered array mixing {kind:'poi',...}
// and {kind:'route',...} entries — this IS the sequence, top to bottom.
// order_index/hunt_routes rows are a derived save-time projection (see
// buildSavePayload), never edited directly.
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
const TIMEOUT_TYPES = [
  { key: 'skip', label: 'Überspringen' },
  { key: 'fail', label: 'Strecke scheitert' },
  { key: 'time_penalty', label: 'Zeitstrafe' },
];
const PUZZLE_TYPES = [
  { key: 'text', label: 'Text-Antwort' },
  { key: 'choice', label: 'Multiple Choice' },
  { key: 'number', label: 'Zahl' },
];
let tempIdSeq = 0;
const newTempId = () => 'tmp_' + (++tempIdSeq) + '_' + Date.now();
const itemKey = it => it.id ?? it.tempId;

// Groups consecutive (uninterrupted by a route item) poi-items into blocks,
// interleaved with the route items that separate them — mirrors hunt.js's
// own order_index-based grouping (module header there), just computed from
// array adjacency instead of a stored order_index.
function toSequence(items) {
  const seq = [];
  for (const it of items) {
    if (it.kind === 'poi') {
      const last = seq[seq.length - 1];
      if (last && last.type === 'block') last.pois.push(it);
      else seq.push({ type: 'block', pois: [it] });
    } else {
      seq.push({ type: 'route', item: it });
    }
  }
  return seq;
}

// Derives the save payload (flat pois[] with a computed order_index per
// block, flat routes[]) from the items array. A route item only becomes a
// real hunt_routes row when it sits between two single-POI blocks — the
// only shape the engine ever arms a leg deadline / strict-path check for
// (see advanceGroup's own gating in hunt.js); between larger groups it's
// purely a sequencing marker with no enforceable single path.
function buildSavePayload(items) {
  const seq = toSequence(items);
  const blocks = seq.filter(s => s.type === 'block');
  const pois = [];
  blocks.forEach((b, idx) => {
    b.pois.forEach(p => pois.push({
      tempId: p.tempId, id: p.id, order_index: idx, name: p.name, lat: p.lat, lon: p.lon,
      radius_m: p.radius_m, poi_type: p.poi_type, puzzle_config: p.puzzle_config,
      task_time_limit_ms: p.task_time_limit_ms, timeout_action: p.timeout_action,
      visualization: p.visualization, model_asset_url: p.model_asset_url,
      carryPairTempId: p.carryPairTempId || null,
    }));
  });
  const routes = [];
  for (let i = 0; i < seq.length; i++) {
    if (seq[i].type !== 'route') continue;
    const prevBlock = [...seq.slice(0, i)].reverse().find(s => s.type === 'block');
    const nextBlock = seq.slice(i + 1).find(s => s.type === 'block');
    if (!prevBlock || !nextBlock) continue;
    if (prevBlock.pois.length !== 1 || nextBlock.pois.length !== 1) continue;
    const r = seq[i].item;
    routes.push({
      from_tempId: itemKey(prevBlock.pois[0]), to_tempId: itemKey(nextBlock.pois[0]),
      route_type: r.mode === 'fixed' ? 'defined' : 'freeform',
      enforcement: r.mode === 'fixed' ? 'strict' : 'guidance',
      travel_time_limit_ms: r.travel_time_limit_ms ?? null,
      timeout_action: r.timeout_action || {},
      path_geojson: r.mode === 'fixed' && r.path_geojson?.length ? r.path_geojson : null,
    });
  }
  return { pois, routes };
}

// Reconstructs the items array from a loaded scenario's flat pois/routes —
// the inverse of buildSavePayload. Every boundary between two adjacent
// order_index blocks gets a route item (backed by a real hunt_routes row
// when found, else a bare default) so re-opening a scenario keeps every
// previously-sequential boundary sequential.
function itemsFromLoaded(pois, routes) {
  const sorted = [...pois].sort((a, b) => a.order_index - b.order_index);
  const blocks = [];
  for (const p of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && last.orderIndex === p.order_index) last.pois.push(p);
    else blocks.push({ orderIndex: p.order_index, pois: [p] });
  }
  const items = [];
  blocks.forEach((b, i) => {
    b.pois.forEach(p => items.push({ kind: 'poi', ...p, carryPairTempId: p.carry_pair_poi_id || null }));
    if (i < blocks.length - 1) {
      const next = blocks[i + 1];
      let routeItem = {
        kind: 'route', tempId: newTempId(), mode: 'target',
        travel_time_limit_ms: null, timeout_action: {}, path_geojson: null,
      };
      if (b.pois.length === 1 && next.pois.length === 1) {
        const match = routes.find(r => r.from_poi_id === b.pois[0].id && r.to_poi_id === next.pois[0].id);
        if (match) {
          routeItem = {
            kind: 'route', id: match.id, tempId: newTempId(),
            mode: match.route_type === 'defined' && match.enforcement === 'strict' ? 'fixed' : 'target',
            travel_time_limit_ms: match.travel_time_limit_ms, timeout_action: match.timeout_action || {},
            path_geojson: match.path_geojson || null,
          };
        }
      }
      items.push(routeItem);
    }
  });
  return items;
}

export default function HuntEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [title, setTitle] = useState('Neue Schnitzeljagd');
  const [progressMode, setProgressMode] = useState('individual');
  const [items, setItems] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [scenarioId, setScenarioId] = useState(id || null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [sessions, setSessions] = useState([]);
  const [genCodeErr, setGenCodeErr] = useState('');
  const [uploadingId, setUploadingId] = useState(null);
  const [drawingRouteKey, setDrawingRouteKey] = useState(null);

  const mapRef = useRef(null);
  const layersRef = useRef({ markers: [], radius: null, lines: [], path: [] });
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const drawingRouteKeyRef = useRef(drawingRouteKey);
  drawingRouteKeyRef.current = drawingRouteKey;

  // ── Load existing scenario ──────────────────────────────────
  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const { data } = await api.get(`/hunt/scenarios/${id}`);
        setTitle(data.title);
        setProgressMode(data.config?.progressMode || 'individual');
        setItems(itemsFromLoaded(data.pois || [], data.routes || []));
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
      const drKey = drawingRouteKeyRef.current;
      if (drKey) {
        setItems(its => its.map(it => (it.kind === 'route' && itemKey(it) === drKey)
          ? { ...it, path_geojson: [...(it.path_geojson || []), { lat: e.latlng.lat, lon: e.latlng.lng }] }
          : it));
        return;
      }
      if (!placingRef.current) return;
      const cur = itemsRef.current;
      const tempId = newTempId();
      const poi = {
        kind: 'poi', tempId, name: `POI ${cur.filter(it => it.kind === 'poi').length + 1}`,
        lat: e.latlng.lat, lon: e.latlng.lng, radius_m: 15, poi_type: 'target',
        puzzle_config: {}, task_time_limit_ms: null, timeout_action: {},
        visualization: 'satellite', model_asset_url: null, carryPairTempId: null,
      };
      setItems(it => [...it, poi]);
      setSelectedKey(tempId);
    });
    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const poiItems = useMemo(() => items.filter(it => it.kind === 'poi'), [items]);
  const selected = items.find(it => itemKey(it) === selectedKey) || null;

  // Redraw markers/radius/route-lines/drawn-path whenever items/selection change
  useEffect(() => {
    const L = window.L, map = mapRef.current;
    if (!L || !map) return;
    layersRef.current.markers.forEach(m => map.removeLayer(m));
    layersRef.current.markers = [];
    layersRef.current.lines.forEach(l => map.removeLayer(l));
    layersRef.current.lines = [];
    layersRef.current.path.forEach(l => map.removeLayer(l));
    layersRef.current.path = [];
    if (layersRef.current.radius) { map.removeLayer(layersRef.current.radius); layersRef.current.radius = null; }

    poiItems.forEach((p, i) => {
      const isSelected = itemKey(p) === selectedKey;
      const typeInfo = POI_TYPES.find(t => t.key === p.poi_type);
      const mk = L.circleMarker([p.lat, p.lon], {
        radius: isSelected ? 10 : 7,
        color: isSelected ? '#f0c840' : '#4090e0',
        fillColor: isSelected ? '#f0c840' : '#4090e0', fillOpacity: 0.85, weight: 2,
      }).addTo(map)
        .bindTooltip(`${i + 1}. ${p.name} (${typeInfo?.icon || ''})`, { permanent: false, direction: 'top' })
        .on('click', () => setSelectedKey(itemKey(p)));
      layersRef.current.markers.push(mk);
    });

    // Geofence-radius preview for the selected POI only — keeps the map
    // readable once there are many POIs.
    if (selected?.kind === 'poi') {
      layersRef.current.radius = L.circle([selected.lat, selected.lon], {
        radius: selected.radius_m, color: '#f0c840', fillColor: '#f0c840', fillOpacity: 0.12, weight: 1, dashArray: '4 4',
      }).addTo(map);
    }

    // Connector lines between consecutive POIs — dashed purple with no
    // route item between them (implicit parallel group), styled by mode
    // otherwise (blue solid = fixe Route, gray dashed = Ziel-Navigation).
    let lastPoi = null, pendingRoute = null;
    for (const it of items) {
      if (it.kind === 'route') { pendingRoute = it; continue; }
      if (lastPoi) {
        const sameGroup = !pendingRoute;
        const color = sameGroup ? '#9050e0' : (pendingRoute.mode === 'fixed' ? '#4090e0' : '#8880a0');
        layersRef.current.lines.push(
          L.polyline([[lastPoi.lat, lastPoi.lon], [it.lat, it.lon]], {
            color, weight: sameGroup ? 3 : 2,
            dashArray: sameGroup ? '2 6' : (pendingRoute.mode === 'fixed' ? null : '6 6'), opacity: 0.7,
          }).addTo(map)
        );
      }
      lastPoi = it; pendingRoute = null;
    }

    // Hand-drawn fixed-route path for the selected route item.
    if (selected?.kind === 'route' && selected.path_geojson?.length) {
      layersRef.current.path.push(
        L.polyline(selected.path_geojson.map(pt => [pt.lat, pt.lon]), {
          color: '#f0c840', weight: 3, opacity: 0.9,
        }).addTo(map)
      );
      selected.path_geojson.forEach(pt => {
        layersRef.current.path.push(
          L.circleMarker([pt.lat, pt.lon], { radius: 4, color: '#f0c840', fillColor: '#f0c840', fillOpacity: 1 }).addTo(map)
        );
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(items.map(it => it.kind === 'poi'
    ? { k: itemKey(it), lat: it.lat, lon: it.lon, r: it.radius_m, n: it.name, t: it.poi_type }
    : { k: itemKey(it), route: true, m: it.mode, path: it.path_geojson }))
  , selectedKey]);

  const updateSelected = patch => {
    setItems(its => its.map(it => (itemKey(it) === selectedKey ? { ...it, ...patch } : it)));
  };

  const removeItem = key => {
    setItems(its => its
      .filter(it => itemKey(it) !== key)
      .map(it => (it.kind === 'poi' && it.carryPairTempId === key) ? { ...it, carryPairTempId: null } : it));
    if (drawingRouteKey === key) setDrawingRouteKey(null);
    if (selectedKey === key) setSelectedKey(null);
  };

  const moveSelected = dir => {
    const idx = items.findIndex(it => itemKey(it) === selectedKey);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= items.length) return;
    setItems(its => {
      const copy = [...its];
      [copy[idx], copy[swapIdx]] = [copy[swapIdx], copy[idx]];
      return copy;
    });
  };

  const insertRouteAfter = idx => {
    const routeItem = {
      kind: 'route', tempId: newTempId(), mode: 'target',
      travel_time_limit_ms: null, timeout_action: {}, path_geojson: null,
    };
    setItems(its => [...its.slice(0, idx + 1), routeItem, ...its.slice(idx + 1)]);
    setSelectedKey(routeItem.tempId);
  };

  // Reciprocal carry-pairing — setting A's partner to B always also sets
  // B's partner to A, and clears whichever stale partner either side had
  // before (an end can only ever be paired with one other end at a time).
  const setCarryPair = (aKey, bKey) => {
    setItems(its => its.map(it => {
      if (it.kind !== 'poi') return it;
      const k = itemKey(it);
      if (k === aKey) return { ...it, carryPairTempId: bKey };
      if (k === bKey) return { ...it, carryPairTempId: aKey };
      if (it.carryPairTempId === aKey || it.carryPairTempId === bKey) return { ...it, carryPairTempId: null };
      return it;
    }));
  };
  const clearCarryPair = key => {
    setItems(its => its.map(it => {
      if (it.kind !== 'poi') return it;
      const k = itemKey(it);
      if (k === key) return { ...it, carryPairTempId: null };
      if (it.carryPairTempId === key) return { ...it, carryPairTempId: null };
      return it;
    }));
  };

  const legCounts = key => {
    const idx = items.findIndex(it => itemKey(it) === key);
    let prevCount = 0;
    for (let i = idx - 1; i >= 0 && items[i].kind === 'poi'; i--) prevCount++;
    let nextCount = 0;
    for (let i = idx + 1; i < items.length && items[i].kind === 'poi'; i++) nextCount++;
    return { prevCount, nextCount };
  };

  const uploadModel = async file => {
    if (!selected || selected.kind !== 'poi') return;
    const key = itemKey(selected);
    setUploadingId(key);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/hunt/pois/upload-model', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setItems(its => its.map(it => (itemKey(it) === key ? { ...it, model_asset_url: data.url } : it)));
    } catch (e) { /* best-effort — leave model_asset_url unset on failure */ }
    setUploadingId(null);
  };

  const save = async () => {
    if (!title.trim() || poiItems.length === 0) { setSaveErr('Titel und mindestens 1 POI nötig'); return; }
    setSaving(true);
    setSaveErr('');
    try {
      const { pois, routes } = buildSavePayload(items);
      const payload = { title: title.trim(), config: { progressMode }, pois, routes };
      const { data } = scenarioId
        ? await api.put(`/hunt/scenarios/${scenarioId}`, payload)
        : await api.post('/hunt/scenarios', payload);
      setScenarioId(data.id);
      setItems(itemsFromLoaded(data.pois || [], data.routes || []));
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

  const carryPartnerLabel = poi => {
    if (!poi.carryPairTempId) return null;
    const p = items.find(it => it.kind === 'poi' && itemKey(it) === poi.carryPairTempId);
    return p?.name || null;
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: '80vh', gap: 12, padding: 12 }}>
      {/* ── Left: sequence list ── */}
      <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Titel der Schnitzeljagd"
          style={inputStyle} />
        <div style={{ display: 'flex', gap: 4 }}>
          {['individual', 'teams', 'shared'].map(m => (
            <button key={m} onClick={() => setProgressMode(m)}
              style={{ ...toggleBtnStyle(progressMode === m), flex: 1 }}>
              {m === 'individual' ? 'Einzeln' : m === 'teams' ? 'Teams' : 'Gemeinsam'}
            </button>
          ))}
        </div>
        <button onClick={() => setPlacing(v => !v)} style={toggleBtnStyle(placing)}>
          {placing ? '📍 Klicke auf die Karte, um POIs zu setzen' : '📍 POI-Platzierung pausiert'}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text2)' }}>
          Reihenfolge von oben nach unten. Aufeinanderfolgende POIs ohne Weg-Block dazwischen
          sind automatisch parallel (beliebige Reihenfolge). Ein Weg-Block macht sie sequentiell.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map((it, i) => {
            if (it.kind === 'poi') {
              const typeInfo = POI_TYPES.find(t => t.key === it.poi_type);
              const nextIsPoiAdjacent = items[i + 1]?.kind === 'poi';
              const seqIdx = poiItems.findIndex(p => itemKey(p) === itemKey(it));
              return (
                <React.Fragment key={itemKey(it)}>
                  <div onClick={() => setSelectedKey(itemKey(it))}
                    style={{
                      padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
                      background: itemKey(it) === selectedKey ? 'var(--bg3)' : 'var(--bg2)',
                      border: `1px solid ${itemKey(it) === selectedKey ? 'var(--gold)' : 'var(--border)'}`,
                    }}>
                    <div style={{ fontSize: 12, color: 'var(--text)' }}>
                      {seqIdx + 1}. {it.name} {typeInfo?.icon}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text2)' }}>{typeInfo?.label}</div>
                  </div>
                  {nextIsPoiAdjacent && (
                    <button onClick={() => insertRouteAfter(i)} style={connectorBtnStyle}>
                      ⇄ parallel — ＋ Weg-Block einfügen
                    </button>
                  )}
                </React.Fragment>
              );
            }
            // route item
            return (
              <div key={itemKey(it)} onClick={() => setSelectedKey(itemKey(it))}
                style={{
                  padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: itemKey(it) === selectedKey ? 'var(--bg3)' : 'transparent',
                  border: `1px dashed ${itemKey(it) === selectedKey ? 'var(--gold)' : 'var(--border)'}`,
                  color: 'var(--text2)',
                }}>
                <span>
                  {it.mode === 'fixed' ? '🛤 Fixe Route' : '🧭 Ziel-Navigation'}
                  {!!it.travel_time_limit_ms && ` · ⏱ ${Math.round(it.travel_time_limit_ms / 1000)}s`}
                </span>
                <button onClick={e => { e.stopPropagation(); removeItem(itemKey(it)); }}
                  style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 12 }}>
                  ✕
                </button>
              </div>
            );
          })}
          {!items.length && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Noch keine POIs — auf die Karte klicken.</div>}
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

      {/* ── Right: selected item settings ── */}
      <div style={{ width: 300, overflowY: 'auto' }}>
        {!selected && <div style={{ color: 'var(--text3)', fontSize: 12, padding: 12 }}>Nichts ausgewählt.</div>}

        {selected?.kind === 'poi' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 4 }}>
            <input value={selected.name} onChange={e => updateSelected({ name: e.target.value })} style={inputStyle} placeholder="Name" />

            <label style={labelStyle}>Aktion</label>
            <select value={selected.poi_type} onChange={e => updateSelected({ poi_type: e.target.value })} style={inputStyle}>
              {POI_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>

            {selected.poi_type === 'puzzle' && (
              <PuzzleSubEditor selected={selected} updateSelected={updateSelected} />
            )}

            {(selected.poi_type === 'carry_from' || selected.poi_type === 'carry_to') && (
              <>
                <label style={labelStyle}>
                  {selected.poi_type === 'carry_from' ? 'Zielpunkt (Abgabe)' : 'Abholpunkt'}
                </label>
                <select value={selected.carryPairTempId || ''}
                  onChange={e => e.target.value ? setCarryPair(itemKey(selected), e.target.value) : clearCarryPair(itemKey(selected))}
                  style={inputStyle}>
                  <option value="">— keiner —</option>
                  {poiItems
                    .filter(p => p.poi_type === (selected.poi_type === 'carry_from' ? 'carry_to' : 'carry_from'))
                    .map(p => <option key={itemKey(p)} value={itemKey(p)}>{p.name}</option>)}
                </select>
                {!!carryPartnerLabel(selected) && (
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                    ↔ verknüpft mit &quot;{carryPartnerLabel(selected)}&quot;
                  </div>
                )}
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
                {uploadingId === itemKey(selected) && <span style={{ fontSize: 11, color: 'var(--text2)' }}>Lädt hoch…</span>}
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
              <button onClick={() => moveSelected(-1)} style={{ ...secondaryBtnStyle, flex: 1 }}>↑ Nach oben</button>
              <button onClick={() => moveSelected(1)} style={{ ...secondaryBtnStyle, flex: 1 }}>↓ Nach unten</button>
            </div>

            <button onClick={() => removeItem(itemKey(selected))} style={{ ...secondaryBtnStyle, color: 'var(--red)', borderColor: 'var(--red)', marginTop: 8 }}>
              🗑 POI löschen
            </button>
          </div>
        )}

        {selected?.kind === 'route' && (() => {
          const { prevCount, nextCount } = legCounts(itemKey(selected));
          const canFixed = prevCount === 1 && nextCount === 1;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Weg-Block</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button disabled={!canFixed} onClick={() => updateSelected({ mode: 'fixed' })}
                  style={{ ...toggleBtnStyle(selected.mode === 'fixed'), flex: 1, opacity: canFixed ? 1 : 0.4 }}>
                  🛤 Fixe Route
                </button>
                <button onClick={() => updateSelected({ mode: 'target' })} style={{ ...toggleBtnStyle(selected.mode === 'target'), flex: 1 }}>
                  🧭 Ziel-Navigation
                </button>
              </div>
              {!canFixed && (
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                  Fixe Route und Zeitlimit nur möglich, wenn davor und danach genau 1 POI liegt
                  (aktuell {prevCount} → {nextCount}). Der Block trennt die Gruppen trotzdem.
                </div>
              )}
              {canFixed && (
                <>
                  <label style={labelStyle}>Zeitlimit für die Route (s, leer = kein Limit)</label>
                  <input type="number" min={0}
                    value={selected.travel_time_limit_ms ? Math.round(selected.travel_time_limit_ms / 1000) : ''}
                    onChange={e => updateSelected({ travel_time_limit_ms: e.target.value ? +e.target.value * 1000 : null })}
                    style={inputStyle} placeholder="z.B. 180" />
                  {!!selected.travel_time_limit_ms && (
                    <select value={selected.timeout_action?.type || 'skip'}
                      onChange={e => updateSelected({ timeout_action: { ...selected.timeout_action, type: e.target.value } })}
                      style={inputStyle}>
                      {TIMEOUT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                  )}
                  {selected.mode === 'fixed' && (
                    <>
                      <button onClick={() => setDrawingRouteKey(k => (k === itemKey(selected) ? null : itemKey(selected)))}
                        style={toggleBtnStyle(drawingRouteKey === itemKey(selected))}>
                        {drawingRouteKey === itemKey(selected) ? '✏️ Pfad zeichnen (aktiv — Karte klicken)' : '✏️ Pfad zeichnen'}
                      </button>
                      {!!selected.path_geojson?.length && (
                        <div style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', justifyContent: 'space-between' }}>
                          <span>{selected.path_geojson.length} Punkte gesetzt</span>
                          <button onClick={() => updateSelected({ path_geojson: [] })} style={{ ...secondaryBtnStyle, flex: 'none', padding: '2px 8px' }}>
                            Zurücksetzen
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
              <button onClick={() => removeItem(itemKey(selected))} style={{ ...secondaryBtnStyle, color: 'var(--red)', borderColor: 'var(--red)', marginTop: 8 }}>
                🗑 Weg-Block entfernen (macht Nachbarn wieder parallel)
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// Rätsel-Editor — 3 Typen: Text (Groß/Kleinschreibung egal), Multiple
// Choice (Index-Vergleich), Zahl (mit Toleranz) — siehe hunt.js's
// checkPuzzleAnswer für die Server-seitige Gegenstelle dieser Config-Form.
function PuzzleSubEditor({ selected, updateSelected }) {
  const cfg = selected.puzzle_config || {};
  const setCfg = patch => updateSelected({ puzzle_config: { ...cfg, ...patch } });
  const type = cfg.type || 'text';
  const choices = cfg.choices || [];

  return (
    <>
      <label style={labelStyle}>Rätsel-Typ</label>
      <select value={type} onChange={e => setCfg({ type: e.target.value })} style={inputStyle}>
        {PUZZLE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>

      {type === 'text' && (
        <>
          <label style={labelStyle}>Antwort (Groß/Kleinschreibung egal)</label>
          <input value={cfg.answer || ''} onChange={e => setCfg({ answer: e.target.value })} style={inputStyle} placeholder="Antwort" />
        </>
      )}

      {type === 'number' && (
        <>
          <label style={labelStyle}>Antwort (Zahl)</label>
          <input type="number" value={cfg.answer ?? ''} onChange={e => setCfg({ answer: e.target.value === '' ? null : +e.target.value })} style={inputStyle} />
          <label style={labelStyle}>Toleranz (+/-, optional)</label>
          <input type="number" min={0} value={cfg.tolerance ?? ''} onChange={e => setCfg({ tolerance: e.target.value === '' ? null : +e.target.value })} style={inputStyle} placeholder="0" />
        </>
      )}

      {type === 'choice' && (
        <>
          <label style={labelStyle}>Antwortmöglichkeiten</label>
          {choices.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="radio" name="correctChoice" checked={cfg.correctIndex === i}
                onChange={() => setCfg({ correctIndex: i })} title="Richtige Antwort" />
              <input value={c} onChange={e => setCfg({ choices: choices.map((x, xi) => xi === i ? e.target.value : x) })}
                style={{ ...inputStyle, flex: 1 }} placeholder={`Option ${i + 1}`} />
              <button onClick={() => setCfg({
                choices: choices.filter((_, xi) => xi !== i),
                correctIndex: cfg.correctIndex === i ? null : cfg.correctIndex > i ? cfg.correctIndex - 1 : cfg.correctIndex,
              })} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer' }}>✕</button>
            </div>
          ))}
          <button onClick={() => setCfg({ choices: [...choices, ''] })} style={secondaryBtnStyle}>+ Option hinzufügen</button>
        </>
      )}
    </>
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
// No `flex` here on purpose — this was `flex: 1` before, which is only
// correct for buttons living in a horizontal `display:flex` row (equal
// width split). Reused standalone in the vertical column layout (e.g. the
// "POI-Platzierung"-Toggle, "Speichern"), `flex:1` instead means "grow to
// fill remaining vertical space" in that flex-column context — the button
// visibly ballooned to fill whatever empty space was below it, only
// "shrinking" once enough POIs were listed to consume that space. Row
// usages opt back in explicitly via `flex: 1` on their own style spread.
const secondaryBtnStyle = {
  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '6px 10px', fontSize: 12, cursor: 'pointer',
};
const toggleBtnStyle = active => ({
  ...secondaryBtnStyle,
  background: active ? 'var(--gold)' : 'var(--bg2)',
  color: active ? '#1a1000' : 'var(--text)',
  borderColor: active ? 'var(--gold)' : 'var(--border)',
  fontWeight: active ? 700 : 400,
});
const connectorBtnStyle = {
  background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer',
  fontSize: 10, textAlign: 'left', padding: '2px 4px',
};
