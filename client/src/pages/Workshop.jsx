import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';

// Default wave previews (approximation — server generates exact values)
const DEFAULT_WAVE_PREVIEWS = [{wave:1,type:'basic',count:7,isAir:false},{wave:2,type:'fast',count:9,isAir:false},{wave:3,type:'armored',count:10,isAir:false},{wave:4,type:'healer',count:12,isAir:false},{wave:5,type:'air_light',count:10,isAir:true},{wave:6,type:'basic',count:15,isAir:false},{wave:7,type:'fast',count:16,isAir:false},{wave:8,type:'armored',count:18,isAir:false},{wave:9,type:'healer',count:19,isAir:false},{wave:10,type:'boss',count:1,isAir:false},{wave:11,type:'armored',count:22,isAir:false},{wave:12,type:'healer',count:24,isAir:false},{wave:13,type:'basic',count:25,isAir:false},{wave:14,type:'fast',count:27,isAir:false},{wave:15,type:'air_heavy',count:20,isAir:true},{wave:16,type:'healer',count:30,isAir:false},{wave:17,type:'basic',count:31,isAir:false},{wave:18,type:'fast',count:33,isAir:false},{wave:19,type:'armored',count:34,isAir:false},{wave:20,type:'boss',count:1,isAir:false},{wave:21,type:'basic',count:37,isAir:false},{wave:22,type:'fast',count:39,isAir:false},{wave:23,type:'armored',count:40,isAir:false},{wave:24,type:'healer',count:42,isAir:false},{wave:25,type:'boss',count:1,isAir:false}];

// Builtin races — always available, mirrored from server towers.js
const BUILTIN_RACES = {
  standard: { name:'Standard',   icon:'⚔️',  color:'#c0a060', desc:'Dart · Gift · Kanone' },
  orcs:     { name:'Orcs',       icon:'💀',  color:'#80c020', desc:'Fleischwolf · Wurfspeer · Kriegstrommel' },
  techies:  { name:'Techies',    icon:'⚙️',  color:'#60a8d0', desc:'Mörser · Elektrozaun · Raketenwerfer' },
  elemente: { name:'Elemente',   icon:'🌊',  color:'#40c0e0', desc:'Magmaquelle · Sturmstrudel · Eisspitze' },
  urwald:   { name:'Urwald',     icon:'🌿',  color:'#40a840', desc:'Rankenfalle · Giftpilz · Mondlichtaltar' },
};
import { useAuth } from '../App';
import { api } from '../api';

// ── Constants ──────────────────────────────────────────────────
const DIFFICULTIES = ['easy','normal','hard','expert','horror'];
const DIFF_LABELS  = { easy:'Easy (100%)', normal:'Normal (150%)', hard:'Hard (200%)', expert:'Expert (250%)', horror:'Horror (300%)' };
const WAVE_TYPES   = ['basic','fast','armored','healer','air_light','air_heavy','boss'];
const TYPE_ICONS   = { basic:'🔴', fast:'🟡', armored:'🔵', healer:'🟢', air_light:'🦅', air_heavy:'🐉', boss:'👑' };

// Default wave override template
const makeWaveOverride = (wave) => ({
  wave, type: null, count: null, hpMult: null, disabled: false
});

// ── Sub-components ─────────────────────────────────────────────
function StarRating({ value, onChange, readonly }) {
  return (
    <div style={{ display:'flex', gap:3 }}>
      {[1,2,3,4,5].map(s => (
        <span key={s}
          onClick={() => !readonly && onChange && onChange(s)}
          style={{ fontSize:16, cursor:readonly?'default':'pointer',
            color: s <= (value||0) ? '#f0c840' : '#302010' }}>
          ★
        </span>
      ))}
    </div>
  );
}

function MapCard({ map, onPlay, onEdit, onDelete, isOwn }) {
  const [rating, setRating] = useState(map.my_rating || 0);

  const handleRate = async (r) => {
    setRating(r);
    await api.post(`/workshop/maps/${map.id}/rate`, { rating: r }).catch(() => {});
  };

  return (
    <div style={{
      background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:10,
      padding:14, display:'flex', flexDirection:'column', gap:8,
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <div style={{ fontWeight:800, fontSize:14, color:'var(--text)' }}>{map.title}</div>
          <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>
            von {map.creator_name} · {map.play_count} Plays
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <StarRating value={map.avg_rating} readonly />
          {map.avg_rating && <div style={{ fontSize:10, color:'var(--text3)' }}>{map.avg_rating} ({map.rating_count})</div>}
        </div>
      </div>

      {map.description && (
        <div style={{ fontSize:11, color:'var(--text2)', lineHeight:1.4 }}>{map.description}</div>
      )}

      <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
        <span className="lobby-badge badge-normal">{map.config?.difficulty || 'normal'}</span>
        {(map.config?.available_races || []).map(r => (
          <span key={r} style={{ fontSize:10, background:'rgba(255,255,255,.06)', padding:'2px 6px', borderRadius:10, color:'var(--text3)' }}>
            {r}
          </span>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, marginTop:4 }}>
        <button className="btn btn-primary btn-sm" style={{ flex:1 }} onClick={() => onPlay(map)}>
          ▶ Spielen
        </button>
        {!isOwn && <StarRating value={rating} onChange={handleRate} />}
        {isOwn && <>
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(map)}>✏️</button>
          <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }} onClick={() => onDelete(map)}>🗑️</button>
        </>}
      </div>
    </div>
  );
}

// ── Wave Editor ────────────────────────────────────────────────
function WaveEditor({ waves, previews, onChange }) {
  const [expanded, setExpanded] = useState(null);

  const update = (waveNum, field, val) => {
    const exists = waves.find(w => w.wave === waveNum);
    const upd = exists
      ? waves.map(w => w.wave === waveNum ? { ...w, [field]: val } : w)
      : [...waves, { ...makeWaveOverride(waveNum), [field]: val }];
    onChange(upd.filter(w => w.disabled || w.type || w.count !== null || w.hpMult !== null));
  };

  const getOverride = (waveNum) => waves.find(w => w.wave === waveNum) || {};

  return (
    <div>
      <div style={{ fontSize:11, color:'var(--text3)', marginBottom:8 }}>
        Klicke auf eine Wave um sie anzupassen. Standard-Wellen werden automatisch berechnet.
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:4 }}>
        {previews.map(p => {
          const ov = getOverride(p.wave);
          const modified = ov.type || ov.count !== null || ov.hpMult !== null;
          const disabled = ov.disabled;
          return (
            <div key={p.wave}
              onClick={() => setExpanded(expanded === p.wave ? null : p.wave)}
              style={{
                background: disabled ? '#1a1006' : modified ? 'rgba(240,200,60,.12)' : 'var(--bg2)',
                border: `1px solid ${disabled ? '#2a1806' : modified ? 'rgba(240,200,60,.4)' : 'var(--border2)'}`,
                borderRadius:6, padding:'6px 4px', cursor:'pointer', textAlign:'center',
                opacity: disabled ? 0.4 : 1,
              }}>
              <div style={{ fontSize:16 }}>{TYPE_ICONS[ov.type || p.type] || '❓'}</div>
              <div style={{ fontSize:9, color:'var(--text3)', fontWeight:700 }}>W{p.wave}</div>
              <div style={{ fontSize:8, color:'var(--text3)' }}>
                {ov.count !== null ? ov.count : p.count}×
              </div>
            </div>
          );
        })}
      </div>

      {expanded && (
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:8, padding:14, marginTop:10 }}>
          <div style={{ fontWeight:700, marginBottom:10, color:'var(--gold)' }}>Wave {expanded} anpassen</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label style={{ fontSize:11, color:'var(--text3)' }}>Typ</label>
              <select className="input" value={getOverride(expanded).type || ''}
                onChange={e => update(expanded, 'type', e.target.value || null)}>
                <option value="">Standard</option>
                {WAVE_TYPES.map(t => <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:11, color:'var(--text3)' }}>Anzahl (leer = Standard)</label>
              <input className="input" type="number" min="1" max="200"
                value={getOverride(expanded).count ?? ''}
                onChange={e => update(expanded, 'count', e.target.value ? +e.target.value : null)}
                placeholder="Standard" />
            </div>
            <div>
              <label style={{ fontSize:11, color:'var(--text3)' }}>HP Multiplikator</label>
              <input className="input" type="number" min="0.1" max="10" step="0.1"
                value={getOverride(expanded).hpMult ?? ''}
                onChange={e => update(expanded, 'hpMult', e.target.value ? +e.target.value : null)}
                placeholder="Standard" />
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, paddingTop:16 }}>
              <input type="checkbox" id={`disable-${expanded}`}
                checked={getOverride(expanded).disabled || false}
                onChange={e => update(expanded, 'disabled', e.target.checked)} />
              <label htmlFor={`disable-${expanded}`} style={{ fontSize:12, color:'var(--text2)' }}>
                Wave deaktivieren
              </label>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop:10 }}
            onClick={() => { setExpanded(null); }}>
            ✓ Fertig
          </button>
        </div>
      )}
    </div>
  );
}

// ── Map Editor Modal ───────────────────────────────────────────
function MapEditor({ map, meta, onSave, onClose }) {
  const isNew = !map?.id;
  const [title, setTitle]       = useState(map?.title || '');
  const [mapIcon, setMapIcon]   = useState(map?.icon || '🗺️');
  const [desc, setDesc]         = useState(map?.description || '');
  const [isPublic, setPublic]   = useState(map?.is_public ?? true);
  const [difficulty, setDiff]   = useState(map?.config?.difficulty || 'normal');
  const [races, setRaces]       = useState(map?.config?.available_races || Object.keys(BUILTIN_RACES));
  const [waveOverrides, setWaveOverrides] = useState(map?.config?.wave_overrides || []);
  const [bgStyle,   setBgStyle]   = useState(map?.config?.bg_style   || 'grass');
  const [pathStyle, setPathStyle] = useState(map?.config?.path_style || 'dirt');
  const [startIcon, setStartIcon] = useState(map?.config?.start_icon || '▼');
  const [goalIcon,  setGoalIcon]  = useState(map?.config?.goal_icon  || '🏰');
  const [saving, setSaving]     = useState(false);
  const [tab, setTab]           = useState('general'); // general | waves | races

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const payload = {
      title: title.trim(),
      icon: mapIcon,
      description: desc.trim(),
      game_mode: 'td',
      is_public: isPublic,
      config: { difficulty, available_races: races, wave_overrides: waveOverrides, bg_style: bgStyle, path_style: pathStyle, start_icon: startIcon, goal_icon: goalIcon },
    };
    try {
      const r = isNew
        ? await api.post('/workshop/maps', payload)
        : await api.put(`/workshop/maps/${map.id}`, payload);
      onSave(r.data);
    } catch {}
    setSaving(false);
  };

  const tabStyle = (t) => ({
    padding:'8px 14px', border:'none', background:'none', cursor:'pointer',
    fontFamily:'Cinzel,serif', fontSize:11, fontWeight:700,
    color: tab===t ? 'var(--gold)' : 'var(--text3)',
    borderBottom: tab===t ? '2px solid var(--gold)' : '2px solid transparent',
  });

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.7)', backdropFilter:'blur(4px)',
      zIndex:500, display:'flex', alignItems:'center', justifyContent:'center', padding:16,
    }} onClick={onClose}>
      <div style={{
        background:'var(--bg)', border:'1px solid var(--border2)', borderRadius:12,
        width:'100%', maxWidth:560, maxHeight:'90vh', overflow:'hidden',
        display:'flex', flexDirection:'column',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border2)', display:'flex', justifyContent:'space-between' }}>
          <div style={{ fontWeight:900, fontSize:16, color:'var(--gold)' }}>
            {isNew ? '+ Neue Map' : '✏️ Map bearbeiten'}
          </div>
          <span onClick={onClose} style={{ cursor:'pointer', color:'var(--text3)', fontSize:20 }}>✕</span>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border2)' }}>
          <button style={tabStyle('general')} onClick={() => setTab('general')}>⚙️ Allgemein</button>
          <button style={tabStyle('races')}   onClick={() => setTab('races')}>⚔️ Rassen</button>
          <button style={tabStyle('waves')}   onClick={() => setTab('waves')}>🌊 Waves</button>
        </div>

        {/* Content */}
        <div style={{ flex:1, overflow:'auto', padding:'14px 18px' }}>

          {tab === 'general' && (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div>
                <label style={{ fontSize:11, color:'var(--text3)' }}>Titel *</label>
                <div style={{ display:'flex',gap:8,marginBottom:8,alignItems:'center' }}>
                <select value={mapIcon} onChange={e=>setMapIcon(e.target.value)}
                  style={{ width:52,fontSize:22,background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:6,color:'var(--text)',cursor:'pointer' }}>
                  {['🗺️','🌿','🏜️','❄️','🌋','🌑','🌲','⚔️','🏰','🌊','🔥','🌀','💀','🎯','⛩️','🏕️'].map(i=><option key={i} value={i}>{i}</option>)}
                </select>
                <input className="input" value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="Map Name" maxLength={64} />
              </div>
              <div>
                <label style={{ fontSize:11, color:'var(--text3)' }}>Beschreibung</label>
                <textarea className="input" value={desc} onChange={e => setDesc(e.target.value)}
                  placeholder="Optionale Beschreibung…" maxLength={256}
                  style={{ resize:'vertical', minHeight:60 }} />
              </div>
              <div>
                <label style={{ fontSize:11, color:'var(--text3)' }}>Schwierigkeit</label>
                <select className="input" value={difficulty} onChange={e => setDiff(e.target.value)}>
                  {DIFFICULTIES.map(d => <option key={d} value={d}>{DIFF_LABELS[d]}</option>)}
                </select>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <input type="checkbox" id="pub" checked={isPublic} onChange={e => setPublic(e.target.checked)} />
                <label htmlFor="pub" style={{ fontSize:13, color:'var(--text2)' }}>Öffentlich in der Galerie</label>
              </div>
              <div style={{ borderTop:'1px solid var(--border2)', paddingTop:10, marginTop:4 }}>
                <div style={{ fontSize:11, color:'var(--text3)', fontWeight:700, marginBottom:8 }}>🎨 Aussehen</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div><label style={{ fontSize:10, color:'var(--text3)' }}>Hintergrund</label>
                    <select className="input" value={bgStyle} onChange={e=>setBgStyle(e.target.value)}>
                      <option value="grass">🌿 Gras</option><option value="snow">❄️ Schnee</option>
                      <option value="desert">🏜️ Wüste</option><option value="lava">🌋 Lava</option>
                      <option value="dark">🌑 Dunkel</option><option value="forest">🌲 Wald</option>
                    </select></div>
                  <div><label style={{ fontSize:10, color:'var(--text3)' }}>Pfad-Textur</label>
                    <select className="input" value={pathStyle} onChange={e=>setPathStyle(e.target.value)}>
                      <option value="dirt">🟫 Erde</option><option value="stone">🪨 Stein</option>
                      <option value="ice">🧊 Eis</option><option value="sand">🏜️ Sand</option>
                    </select></div>
                  <div><label style={{ fontSize:10, color:'var(--text3)' }}>Start-Icon</label>
                    <select className="input" value={startIcon} onChange={e=>setStartIcon(e.target.value)}>
                      {['▼','⬇️','🚪','⛩️','🏕️','🌀'].map(i=><option key={i} value={i}>{i}</option>)}
                    </select></div>
                  <div><label style={{ fontSize:10, color:'var(--text3)' }}>Ziel-Icon</label>
                    <select className="input" value={goalIcon} onChange={e=>setGoalIcon(e.target.value)}>
                      {['🏰','⬆️','👑','🔮','⭐','💀'].map(i=><option key={i} value={i}>{i}</option>)}
                    </select></div>
                </div>
              </div>
            </div>
          )}

          {tab === 'races' && (
            <div>
              <div style={{ fontSize:11, color:'var(--text3)', marginBottom:10 }}>
                Wähle welche Rassen in dieser Map spielbar sind.
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {Object.entries({ ...BUILTIN_RACES, ...(meta.races || {}) }).map(([key, r]) => (
                  <div key={key}
                    onClick={() => setRaces(prev =>
                      prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]
                    )}
                    style={{
                      padding:'10px 12px', borderRadius:8, cursor:'pointer',
                      border:`2px solid ${races.includes(key) ? r.color : 'var(--border2)'}`,
                      background: races.includes(key) ? `${r.color}18` : 'var(--bg2)',
                      display:'flex', alignItems:'center', gap:10,
                    }}>
                    <span style={{ fontSize:20 }}>{r.icon}</span>
                    <div>
                      <div style={{ fontSize:12, fontWeight:700, color: races.includes(key) ? r.color : 'var(--text2)' }}>{r.name}</div>
                      <div style={{ fontSize:9, color:'var(--text3)' }}>
                        {races.includes(key) ? '✓ Aktiviert' : '○ Deaktiviert'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {races.length === 0 && (
                <div style={{ color:'var(--red)', fontSize:12, marginTop:8 }}>Mindestens eine Rasse muss aktiv sein.</div>
              )}
            </div>
          )}

          {tab === 'waves' && (
            <WaveEditor
              waves={waveOverrides}
              previews={meta.wavePreviews?.length ? meta.wavePreviews : DEFAULT_WAVE_PREVIEWS}
              onChange={setWaveOverrides}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 18px', borderTop:'1px solid var(--border2)', display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!title.trim() || races.length===0 || saving}>
            {saving ? '⏳ Speichern…' : '💾 Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Workshop Page ─────────────────────────────────────────
export default function Workshop() {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  const [tab, setTab]         = useState('gallery'); // gallery | mine
  const [sort, setSort]       = useState('newest');
  const [search, setSearch]   = useState('');
  const [maps, setMaps]       = useState([]);
  const [mine, setMine]       = useState([]);
  const [meta, setMeta]       = useState({ races:{}, towers:{}, wavePreviews:[] });
  const [loading, setLoading] = useState(true);
  const [editor, setEditor]   = useState(null); // null | 'new' | map object
  const [expBuiltin, setExpBuiltin] = useState(null);
  const [builtinMaps, setBuiltinMaps] = useState(BUILTIN_MAPS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const metaR = await api.get('/workshop/meta').catch(()=>({data:{races:{},towers:{},wavePreviews:[]}}));
      api.get('/workshop/maps/builtin').then(r=>{ if(Array.isArray(r.data)) setBuiltinMaps(r.data); }).catch(()=>{});
      const mapsR = await api.get(`/workshop/maps?sort=${sort}&search=${search}`).catch(()=>({data:[]}));
      const mineR = user ? await api.get('/workshop/maps/mine').catch(()=>({data:[]})) : {data:[]};
      setMeta(metaR.data || {races:{},towers:{},wavePreviews:[]});
      setMaps(Array.isArray(mapsR.data) ? mapsR.data : []);
      setMine(Array.isArray(mineR.data) ? mineR.data : []);
    } catch (e) { console.error('Workshop load:', e); }
    setLoading(false);
  }, [sort, search]);

  useEffect(() => { load(); }, [load]);

  const handlePlay = async (map) => {
    try {
      const { data } = await api.post(`/workshop/maps/${map.id}/play`);
      // Start solo game with this map's config
      sessionStorage.setItem('mp_session', JSON.stringify({
        solo: true,
        userId: user.id,
        username: user.username,
        mode: 'solo',
        workshopMapId: map.id,
        workshopConfig: data.config,
      }));
      window.location.href = '/td-game.html';
    } catch (e) {
      alert('Fehler beim Starten der Map');
    }
  };

  const handleSave = (savedMap) => {
    setEditor(null);
    load();
  };

  const handleDelete = async (map) => {
    if (!confirm(`"${map.title}" wirklich löschen?`)) return;
    await api.delete(`/workshop/maps/${map.id}`).catch(() => {});
    load();
  };

  const tabBtn = (key, label) => (
    <button onClick={() => setTab(key)} style={{
      padding:'8px 16px', border:'none', background:'none', cursor:'pointer',
      fontFamily:'Cinzel,serif', fontWeight:700, fontSize:12,
      color: tab===key ? 'var(--gold)' : 'var(--text3)',
      borderBottom: tab===key ? '2px solid var(--gold)' : '2px solid transparent',
    }}>{label}</button>
  );

  return (
    <div style={{ height:'100%', overflow:'auto' }}>
      {/* Header */}
      <div className="page-header">
        <span className="page-title">🔧 Workshop</span>
        <div style={{ display:'flex', gap:8 }}>
          <Link to="/workshop/content" className="btn btn-ghost btn-sm">🔨 Gebäude &amp; Rassen</Link>
          <button className="btn btn-primary btn-sm" onClick={() => setEditor('new')}>+ Neue Map</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--border2)', paddingLeft:16 }}>
        {tabBtn('gallery', '🌍 Galerie')}
        {tabBtn('mine',    '📁 Meine Maps')}
      </div>

      {/* Gallery controls */}
      {tab === 'gallery' && (
        <div style={{ display:'flex', gap:10, padding:'10px 16px', alignItems:'center' }}>
          <input className="input" placeholder="🔍 Suchen…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex:1, maxWidth:260 }} />
          <select className="input" value={sort} onChange={e => setSort(e.target.value)}
            style={{ width:140 }}>
            <option value="newest">Neueste</option>
            <option value="popular">Beliebteste</option>
            <option value="rated">Beste Bewertung</option>
          </select>
        </div>
      )}

      {/* Builtin gallery */}
      <div style={{ padding:'10px 14px 0', borderBottom:'1px solid var(--border2)', marginBottom:4 }}>
        <div style={{ fontSize:10,color:'var(--text3)',fontWeight:700,marginBottom:6 }}>📚 EINGEBAUTE MAPS</div>
        <div style={{ display:'flex',gap:7,overflowX:'auto',paddingBottom:8 }}>
          {builtinMaps.map(m=>(
            <div key={m.id} style={{ flexShrink:0,width:130,background:'var(--bg2)',
              border:`1px solid ${expBuiltin===m.id?'var(--gold)':'var(--border2)'}`,borderRadius:8,padding:'8px 9px',cursor:'pointer' }}
              onClick={()=>setExpBuiltin(expBuiltin===m.id?null:m.id)}>
              <div style={{ fontSize:20,marginBottom:3 }}>{m.icon||'🗺️'}</div>
              <div style={{ fontSize:10,fontWeight:700,color:'var(--text)',lineHeight:1.2 }}>{m.title}</div>
              <div style={{ fontSize:8,color:'var(--text3)',marginTop:2 }}>{MODE_LABELS[m.game_mode]||m.game_mode} · {m.difficulty}</div>
            </div>
          ))}
        </div>
        {expBuiltin && (() => {
          const m=builtinMaps.find(x=>x.id===expBuiltin);
          if(!m) return null;
          return (
            <div style={{ background:'rgba(240,200,60,.06)',border:'1px solid rgba(240,200,60,.2)',borderRadius:8,padding:'10px 12px',marginBottom:8,display:'flex',gap:12,alignItems:'flex-start' }}>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:900,color:'var(--gold)',fontSize:13 }}>{m.icon} {m.title}</div>
                <div style={{ fontSize:10,color:'var(--text3)',margin:'3px 0 6px',lineHeight:1.4 }}>{m.description}</div>
                <div style={{ display:'flex',gap:5,flexWrap:'wrap' }}>
                  <span style={{ fontSize:9,padding:'2px 7px',background:'rgba(60,120,60,.3)',borderRadius:8,color:'#80e060' }}>{MODE_LABELS[m.game_mode]||m.game_mode}</span>
                  <span style={{ fontSize:9,padding:'2px 7px',background:'rgba(60,60,120,.3)',borderRadius:8,color:'#8080ff' }}>{m.difficulty}</span>
                </div>
              </div>
              <div style={{ display:'flex',flexDirection:'column',gap:5,flexShrink:0 }}>
                <button className="btn btn-primary btn-sm" onClick={()=>{handlePlay(m);setExpBuiltin(null);}}>▶ Spielen</button>
                <button className="btn btn-ghost btn-sm" onClick={()=>{setEditor({...m,id:null,title:m.title+' (Kopie)',is_builtin:false});setExpBuiltin(null);}}>📋 Kopieren</button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Map grid */}
      <div style={{ padding:'0 16px 24px' }}>
        {loading ? (
          <div className="loading-screen">⏳ Lädt…</div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:12, marginTop:12 }}>
            {(tab === 'gallery' ? maps : mine).map(m => (
              <MapCard key={m.id} map={m}
                isOwn={user && m.creator_id === user.id}
                onPlay={handlePlay}
                onEdit={(map) => setEditor(map)}
                onDelete={handleDelete}
              />
            ))}
            {(tab === 'gallery' ? maps : mine).length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">🗺️</div>
                {tab === 'mine' ? 'Noch keine eigenen Maps. Erstelle deine erste Map!' : 'Keine Maps gefunden.'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Editor modal */}
      {editor && (
        <MapEditor
          map={editor === 'new' ? null : editor}
          meta={meta}
          onSave={handleSave}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
