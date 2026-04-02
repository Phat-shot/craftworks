import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { api } from '../api';

// ── Shared helpers ─────────────────────────────────────────────
const DMG_TYPES  = ['phys','magic','expl'];
const DMG_ICONS  = { phys:'⚔️', magic:'🔮', expl:'💥' };
const SHAPES     = ['circle','square','diamond'];
const UNIT_ICONS = ['👾','🔴','🟡','🔵','🟢','👑','🐉','🦅','🐗','🦎','💀','🧟'];
const BLDG_ICONS = ['🏰','🗼','⚔️','🔧','💣','❄️','🌋','⚡','🌿','☠️','🥁','🎯'];
const RACE_ICONS = ['⚔️','💀','⚙️','🌊','🌿','🔥','❄️','⚡','🌑','🌞','🐲','🦁'];

const EFFECT_KEYS = [
  { key:'dmg',        label:'Schaden',       type:'int',   hint:'+X Dmg' },
  { key:'rangeDelta', label:'Reichweite',    type:'float', hint:'+X Tiles' },
  { key:'cdDelta',    label:'CD Reduktion',  type:'float', hint:'0.1 = −10%' },
  { key:'pierce',     label:'Durchschlag',   type:'int',   hint:'+X Ziele' },
  { key:'splashR',    label:'Splash Radius', type:'float', hint:'+X Tiles' },
  { key:'slowFrac',   label:'Slow %',        type:'float', hint:'0.5 = 50%' },
  { key:'slowDur',    label:'Slow Dauer ms', type:'int',   hint:'2000' },
  { key:'dotMult',    label:'DoT Mult',      type:'float', hint:'1.5' },
  { key:'armorShred', label:'Rüstungsriss',  type:'float', hint:'0.1 = 10%' },
  { key:'fireDur',    label:'Feuer Dauer ms',type:'int',   hint:'3000' },
  { key:'fireDmg',    label:'Feuer Dmg/tick',type:'int',   hint:'8' },
  { key:'chains',     label:'Ketten +',      type:'int',   hint:'+1 Kette' },
  { key:'shatBonus',  label:'Splitter %',    type:'float', hint:'0.2 = +20%' },
  { key:'spreadChance',label:'Spread %',     type:'float', hint:'0.5 = 50%' },
  { key:'clusterN',   label:'Cluster Bomben',type:'int',   hint:'3' },
  { key:'healMult',   label:'Heilung Mult',  type:'float', hint:'2.0' },
  { key:'pullStrength',label:'Zugkraft',     type:'float', hint:'0.5' },
  { key:'rootDurDelta',label:'Root +ms',     type:'int',   hint:'1000' },
  { key:'auraSpeed',  label:'Aura Speed %',  type:'float', hint:'0.1' },
  { key:'auraDmg',    label:'Aura Dmg %',    type:'float', hint:'0.1' },
];

const FLAG_KEYS = [
  { key:'isSpinAoe',  label:'Spin AoE (Melee)',  hint:'Fleischwolf-Stil' },
  { key:'isRingAoe',  label:'Ring AoE (alle)',    hint:'Elektrozaun-Stil' },
  { key:'isAura',     label:'Aura (Buff nearby)', hint:'Kriegstrommel-Stil' },
  { key:'isHealAura', label:'Heilaura',            hint:'Mondlichtaltar-Stil' },
  { key:'isPull',     label:'Sog (Pull)',          hint:'Sturmstrudel-Stil' },
  { key:'blindSpot',  label:'Blind Spot (T)',      hint:'Mörser: Mindestreichtweite' },
];

// ── Upgrade Path Builder ───────────────────────────────────────
function UpgradePathBuilder({ paths, onChange }) {
  const addPath = () => {
    if (paths.length >= 3) return;
    onChange([...paths, { id:`p${Date.now()}`, name:'Neuer Pfad', icon:'⬆️', upgrades: Array(5).fill(null).map((_,i)=>({ desc:`Stufe ${i+1}`, cost:50+i*30, effects:{} })) }]);
  };
  const updatePath = (pi, field, val) => {
    const p = paths.map((p,i) => i===pi ? {...p,[field]:val} : p);
    onChange(p);
  };
  const updateUpgrade = (pi, ui, field, val) => {
    const p = paths.map((p,i) => i===pi ? {...p, upgrades: p.upgrades.map((u,j)=>j===ui?{...u,[field]:field==='effects'?val:{...u,[field]:val}}:u)} : p);
    onChange(p);
  };
  const addEffect = (pi, ui, key) => {
    const eff = paths[pi].upgrades[ui].effects;
    if (eff[key] !== undefined) return;
    updateUpgrade(pi, ui, 'effects', {...eff, [key]: key.includes('Delta')||key.includes('Mult')||key.includes('Frac')||key.includes('Chance')||key.includes('Bonus') ? 0.1 : 10});
  };
  const removeEffect = (pi, ui, key) => {
    const eff = {...paths[pi].upgrades[ui].effects};
    delete eff[key];
    updateUpgrade(pi, ui, 'effects', eff);
  };

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
        <div style={{ fontSize:11, color:'var(--text3)' }}>Bis zu 3 Upgrade-Pfade, je 5 Stufen</div>
        {paths.length < 3 && <button className="btn btn-ghost btn-sm" onClick={addPath}>+ Pfad</button>}
      </div>
      {paths.map((path, pi) => (
        <div key={pi} style={{ background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:8, padding:12, marginBottom:10 }}>
          <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center' }}>
            <select value={path.icon} onChange={e => updatePath(pi,'icon',e.target.value)}
              style={{ width:48, fontSize:18, background:'var(--bg)', border:'1px solid var(--border2)', borderRadius:4, color:'var(--text)' }}>
              {['⬆️','🎯','⚔️','🔥','❄️','⚡','☠️','🌀','💣','🛡️','🔗','💎'].map(i=><option key={i} value={i}>{i}</option>)}
            </select>
            <input className="input" value={path.name} onChange={e => updatePath(pi,'name',e.target.value)}
              placeholder="Pfad Name" style={{ flex:1 }} />
            <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }}
              onClick={() => onChange(paths.filter((_,i)=>i!==pi))}>✕</button>
          </div>
          {path.upgrades.map((upg, ui) => (
            <div key={ui} style={{ background:'rgba(0,0,0,.2)', borderRadius:6, padding:'8px 10px', marginBottom:6 }}>
              <div style={{ display:'flex', gap:8, marginBottom:6 }}>
                <span style={{ fontSize:11, color:'var(--text3)', minWidth:52, paddingTop:6 }}>Stufe {ui+1}</span>
                <input className="input" value={upg.desc} onChange={e => updateUpgrade(pi,ui,'desc',e.target.value)}
                  placeholder="Beschreibung" style={{ flex:1 }} />
                <input className="input" type="number" value={upg.cost} onChange={e => updateUpgrade(pi,ui,'cost',+e.target.value)}
                  style={{ width:72 }} placeholder="Gold" />
              </div>
              {/* Effects */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:5 }}>
                {Object.entries(upg.effects).map(([k,v]) => (
                  <div key={k} style={{ display:'flex', alignItems:'center', gap:3, background:'rgba(240,200,60,.1)', border:'1px solid rgba(240,200,60,.3)', borderRadius:4, padding:'2px 6px' }}>
                    <span style={{ fontSize:9, color:'var(--text2)' }}>{k}</span>
                    <input type="number" step="any" value={v}
                      onChange={e => updateUpgrade(pi,ui,'effects',{...upg.effects,[k]:+e.target.value})}
                      style={{ width:52, fontSize:10, background:'transparent', border:'none', color:'var(--gold)', outline:'none' }} />
                    <span onClick={() => removeEffect(pi,ui,k)} style={{ cursor:'pointer', color:'var(--red)', fontSize:10 }}>✕</span>
                  </div>
                ))}
                <select style={{ fontSize:10, background:'var(--bg)', border:'1px solid var(--border2)', borderRadius:4, color:'var(--text3)', padding:'2px 4px' }}
                  value="" onChange={e => { if(e.target.value) addEffect(pi,ui,e.target.value); e.target.value=''; }}>
                  <option value="">+ Effekt</option>
                  {EFFECT_KEYS.filter(ek => !(ek.key in upg.effects)).map(ek =>
                    <option key={ek.key} value={ek.key}>{ek.label}</option>
                  )}
                </select>
              </div>
            </div>
          ))}
        </div>
      ))}
      {paths.length === 0 && (
        <div style={{ textAlign:'center', padding:16, color:'var(--text3)', fontSize:12 }}>
          Keine Upgrade-Pfade. Klicke "+ Pfad" um einen hinzuzufügen.
        </div>
      )}
    </div>
  );
}

// ── Building Editor ────────────────────────────────────────────
export function BuildingEditor({ building, onSave, onClose }) {
  const isNew = !building?.id;
  const [form, setForm] = useState({
    name: building?.name || '',
    description: building?.description || '',
    icon: building?.icon || '🏰',
    color: building?.color || '#c0a060',
    sprite_type: building?.sprite_type || 'generic',
    cost: building?.cost || 100,
    base_range: building?.base_range || 3.0,
    base_cd: building?.base_cd || 1000,
    base_dmg: building?.base_dmg || 20,
    dmg_type: building?.dmg_type || 'phys',
    unlock_wave: building?.unlock_wave || 0,
    can_hit_air: building?.can_hit_air ?? true,
    flags: building?.flags || {},
    upgrade_paths: building?.upgrade_paths || [],
    is_public: building?.is_public || false,
  });
  const [tab, setTab] = useState('stats');
  const [saving, setSaving] = useState(false);

  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const setFlag = (k,v) => setForm(f=>({...f, flags:{...f.flags,[k]:v||undefined}}));

  const [saveErr, setSaveErr] = useState('');
  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true); setSaveErr('');
    try {
      const r = isNew
        ? await api.post('/workshop/buildings', form)
        : await api.put(`/workshop/buildings/${building.id}`, form);
      onSave(r.data);
    } catch (e) {
      setSaveErr(e.response?.data?.error || e.response?.data?.errors?.[0]?.msg || 'Fehler beim Speichern');
    }
    setSaving(false);
  };

  const tabBtn = (k,l) => (
    <button onClick={()=>setTab(k)} style={{ padding:'7px 12px', border:'none', background:'none', cursor:'pointer',
      fontFamily:'Cinzel,serif', fontSize:10, fontWeight:700,
      color: tab===k?'var(--gold)':'var(--text3)',
      borderBottom: tab===k?'2px solid var(--gold)':'2px solid transparent' }}>{l}</button>
  );

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.75)',backdropFilter:'blur(4px)',zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }} onClick={onClose}>
      <div style={{ background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:12,width:'100%',maxWidth:580,maxHeight:'92vh',overflow:'hidden',display:'flex',flexDirection:'column' }} onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'12px 16px',borderBottom:'1px solid var(--border2)',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div style={{ fontWeight:900,fontSize:15,color:'var(--gold)' }}>{isNew?'+ Neues Gebäude':'✏️ Gebäude'}</div>
          <span onClick={onClose} style={{ cursor:'pointer',color:'var(--text3)',fontSize:20 }}>✕</span>
        </div>
        <div style={{ display:'flex',borderBottom:'1px solid var(--border2)' }}>
          {tabBtn('stats','📊 Stats')}
          {tabBtn('flags','⚙️ Flags')}
          {tabBtn('upgrades','⬆️ Upgrades')}
        </div>
        <div style={{ flex:1,overflow:'auto',padding:'12px 16px' }}>
          {tab==='stats' && (
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
              {/* Icon + Name row */}
              <div style={{ gridColumn:'1/-1',display:'flex',gap:8,alignItems:'center' }}>
                <select value={form.icon} onChange={e=>set('icon',e.target.value)}
                  style={{ width:52,fontSize:22,background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:6,color:'var(--text)' }}>
                  {BLDG_ICONS.map(i=><option key={i} value={i}>{i}</option>)}
                </select>
                <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Name *" style={{ flex:1 }} />
                <input type="color" value={form.color} onChange={e=>set('color',e.target.value)}
                  style={{ width:40,height:36,border:'none',background:'none',cursor:'pointer' }} title="Farbe" />
              </div>
              <div style={{ gridColumn:'1/-1' }}>
                <input className="input" value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Beschreibung (optional)" />
              </div>
              {[
                ['cost','Kosten (Gold)','number',1,9999,1],
                ['base_dmg','Grundschaden','number',1,9999,1],
                ['base_range','Reichweite (Tiles)','number',0.5,15,0.5],
                ['base_cd','Cooldown (ms)','number',100,30000,100],
                ['unlock_wave','Freischalten ab Wave','number',0,25,1],
              ].map(([k,l,t,mn,mx,st])=>(
                <div key={k}>
                  <label style={{ fontSize:10,color:'var(--text3)' }}>{l}</label>
                  <input className="input" type={t} min={mn} max={mx} step={st}
                    value={form[k]} onChange={e=>set(k,+e.target.value)} />
                </div>
              ))}
              <div>
                <label style={{ fontSize:10,color:'var(--text3)' }}>Schadenstyp</label>
                <div style={{ display:'flex',gap:6,marginTop:4 }}>
                  {DMG_TYPES.map(d=>(
                    <button key={d} onClick={()=>set('dmg_type',d)}
                      style={{ flex:1,padding:6,border:`2px solid ${form.dmg_type===d?'var(--gold)':'var(--border2)'}`,
                        background:form.dmg_type===d?'rgba(240,200,60,.15)':'var(--bg2)',
                        borderRadius:6,cursor:'pointer',fontSize:13,color:'var(--text)' }}>
                      {DMG_ICONS[d]} {d}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display:'flex',alignItems:'center',gap:8,paddingTop:12 }}>
                <input type="checkbox" id="air" checked={form.can_hit_air} onChange={e=>set('can_hit_air',e.target.checked)} />
                <label htmlFor="air" style={{ fontSize:12 }}>Trifft Lufteinheiten</label>
              </div>
              <div style={{ display:'flex',alignItems:'center',gap:8,paddingTop:12 }}>
                <input type="checkbox" id="pub_b" checked={form.is_public} onChange={e=>set('is_public',e.target.checked)} />
                <label htmlFor="pub_b" style={{ fontSize:12 }}>Öffentlich</label>
              </div>
            </div>
          )}
          {tab==='flags' && (
            <div>
              <div style={{ fontSize:11,color:'var(--text3)',marginBottom:12 }}>
                Spezielle Mechaniken aktivieren. Nur eine Mechanik pro Gebäude empfohlen.
              </div>
              {FLAG_KEYS.map(({key,label,hint})=>(
                <div key={key} style={{ display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border2)' }}>
                  <input type="checkbox" id={`flag-${key}`}
                    checked={!!form.flags[key]} onChange={e=>setFlag(key, e.target.checked ? (key==='blindSpot' ? 1.5 : true) : undefined)} />
                  <div style={{ flex:1 }}>
                    <label htmlFor={`flag-${key}`} style={{ fontSize:13,fontWeight:700,color:'var(--text)',cursor:'pointer' }}>{label}</label>
                    <div style={{ fontSize:10,color:'var(--text3)' }}>{hint}</div>
                  </div>
                  {key==='blindSpot' && form.flags.blindSpot && (
                    <input type="number" min="0.5" max="5" step="0.5" value={form.flags.blindSpot||1.5}
                      onChange={e=>setFlag('blindSpot',+e.target.value)}
                      style={{ width:64 }} className="input" />
                  )}
                </div>
              ))}
            </div>
          )}
          {tab==='upgrades' && (
            <UpgradePathBuilder paths={form.upgrade_paths} onChange={p=>set('upgrade_paths',p)} />
          )}
        </div>
        <div style={{ padding:'10px 16px',borderTop:'1px solid var(--border2)',display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap' }}>
          {saveErr&&<div style={{ width:'100%',fontSize:11,color:'var(--red)',padding:'4px 0' }}>⚠️ {saveErr}</div>}
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()||saving}>
            {saving?'⏳ Speichert…':'💾 Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Unit Editor ────────────────────────────────────────────────
export function UnitEditor({ unit, onSave, onClose }) {
  const isNew = !unit?.id;
  const [form, setForm] = useState({
    name: unit?.name || '',
    description: unit?.description || '',
    icon: unit?.icon || '👾',
    color: unit?.color || '#b02810',
    shape: unit?.shape || 'circle',
    size_factor: unit?.size_factor || 0.26,
    base_hp: unit?.base_hp || 100,
    base_speed: unit?.base_speed || 1.5,
    base_reward: unit?.base_reward || 10,
    armor_phys: unit?.armor_phys || 0,
    armor_magic: unit?.armor_magic || 0,
    is_air: unit?.is_air || false,
    abilities: unit?.abilities || {},
    is_public: unit?.is_public || false,
  });
  const [saving, setSaving] = useState(false);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const [saveErr, setSaveErr] = useState('');
  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true); setSaveErr('');
    try {
      const r = isNew
        ? await api.post('/workshop/units', form)
        : await api.put(`/workshop/units/${unit.id}`, form);
      onSave(r.data);
    } catch (e) {
      setSaveErr(e.response?.data?.error || e.response?.data?.errors?.[0]?.msg || 'Fehler beim Speichern');
    }
    setSaving(false);
  };

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.75)',backdropFilter:'blur(4px)',zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }} onClick={onClose}>
      <div style={{ background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:12,width:'100%',maxWidth:500,maxHeight:'90vh',overflow:'hidden',display:'flex',flexDirection:'column' }} onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'12px 16px',borderBottom:'1px solid var(--border2)',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div style={{ fontWeight:900,fontSize:15,color:'var(--gold)' }}>{isNew?'+ Neue Einheit':'✏️ Einheit'}</div>
          <span onClick={onClose} style={{ cursor:'pointer',color:'var(--text3)',fontSize:20 }}>✕</span>
        </div>
        <div style={{ flex:1,overflow:'auto',padding:'14px 16px' }}>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
            <div style={{ gridColumn:'1/-1',display:'flex',gap:8,alignItems:'center' }}>
              <select value={form.icon} onChange={e=>set('icon',e.target.value)}
                style={{ width:52,fontSize:22,background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:6,color:'var(--text)' }}>
                {UNIT_ICONS.map(i=><option key={i} value={i}>{i}</option>)}
              </select>
              <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Name *" style={{ flex:1 }} />
              <input type="color" value={form.color} onChange={e=>set('color',e.target.value)}
                style={{ width:40,height:36,border:'none',background:'none',cursor:'pointer' }} />
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <input className="input" value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Beschreibung" />
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Form</label>
              <div style={{ display:'flex',gap:4,marginTop:4 }}>
                {SHAPES.map(s=>(
                  <button key={s} onClick={()=>set('shape',s)}
                    style={{ flex:1,padding:5,border:`2px solid ${form.shape===s?'var(--gold)':'var(--border2)'}`,
                      background:form.shape===s?'rgba(240,200,60,.15)':'var(--bg2)',
                      borderRadius:6,cursor:'pointer',fontSize:10,color:'var(--text)' }}>{s}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Größe (0.1–0.8)</label>
              <input className="input" type="number" min="0.1" max="0.8" step="0.05"
                value={form.size_factor} onChange={e=>set('size_factor',+e.target.value)} />
            </div>
            {[
              ['base_hp','HP',1,99999,1],
              ['base_speed','Geschwindigkeit',0.1,20,0.1],
              ['base_reward','Bounty (Gold)',1,9999,1],
              ['armor_phys','Phys. Rüstung (0–0.9)',0,0.9,0.05],
              ['armor_magic','Magic. Rüstung (0–0.8)',0,0.8,0.05],
            ].map(([k,l,mn,mx,st])=>(
              <div key={k}>
                <label style={{ fontSize:10,color:'var(--text3)' }}>{l}</label>
                <input className="input" type="number" min={mn} max={mx} step={st}
                  value={form[k]} onChange={e=>set(k,+e.target.value)} />
              </div>
            ))}
            <div style={{ display:'flex',alignItems:'center',gap:8,paddingTop:8 }}>
              <input type="checkbox" id="air_u" checked={form.is_air} onChange={e=>set('is_air',e.target.checked)} />
              <label htmlFor="air_u" style={{ fontSize:12 }}>🦅 Lufteinheit</label>
            </div>
            <div style={{ display:'flex',alignItems:'center',gap:8,paddingTop:8 }}>
              <input type="checkbox" id="pub_u" checked={form.is_public} onChange={e=>set('is_public',e.target.checked)} />
              <label htmlFor="pub_u" style={{ fontSize:12 }}>Öffentlich</label>
            </div>
          </div>
        </div>
        <div style={{ padding:'10px 16px',borderTop:'1px solid var(--border2)',display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap' }}>
          {saveErr&&<div style={{ width:'100%',fontSize:11,color:'var(--red)',padding:'4px 0' }}>⚠️ {saveErr}</div>}
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()||saving}>
            {saving?'⏳ Speichert…':'💾 Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Race Editor ────────────────────────────────────────────────
export function RaceEditor({ race, onSave, onClose }) {
  const isNew = !race?.id || race.is_builtin;
  const [form, setForm] = useState({
    name: race && !race.is_builtin ? race.name : '',
    icon: race?.icon || '⚔️',
    color: race?.color || '#c0a060',
    description: race?.description || '',
    building_ids: race && !race.is_builtin ? (race.building_ids||[]) : [],
    is_public: race?.is_public || false,
  });
  const [builtinBuildings, setBuiltinBuildings] = useState([]);
  const [customBuildings, setCustomBuildings]   = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  useEffect(() => {
    api.get('/workshop/buildings/builtin')
      .then(r => setBuiltinBuildings(Array.isArray(r.data) ? r.data : []))
      .catch(() => setBuiltinBuildings([]));
    // Only load custom buildings if logged in (has token)
    const token = localStorage.getItem('access_token');
    if (token) {
      api.get('/workshop/buildings?mine=true')
        .then(r => setCustomBuildings(Array.isArray(r.data) ? r.data : []))
        .catch(() => setCustomBuildings([]));
    }
  }, []);

  const toggleBuilding = (id) => {
    setForm(f => ({...f,
      building_ids: f.building_ids.includes(id)
        ? f.building_ids.filter(x=>x!==id)
        : [...f.building_ids, id]
    }));
  };

  const [saveErr, setSaveErr] = useState('');
  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true); setSaveErr('');
    try {
      const r = isNew
        ? await api.post('/workshop/races', form)
        : await api.put(`/workshop/races/${race.id}`, form);
      onSave(r.data);
    } catch (e) {
      setSaveErr(e.response?.data?.error || e.response?.data?.errors?.[0]?.msg || 'Fehler beim Speichern');
    }
    setSaving(false);
  };

  const allBuildings = [
    ...builtinBuildings.map(b => ({ ...b, isBuiltin: true, label: b.name, group: `${b.race || 'standard'} (eingebaut)` })),
    ...customBuildings.map(b => ({ ...b, isBuiltin: false, label: b.name, group: 'Eigene Gebäude' })),
  ];

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.75)',backdropFilter:'blur(4px)',zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }} onClick={onClose}>
      <div style={{ background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:12,width:'100%',maxWidth:540,maxHeight:'92vh',overflow:'hidden',display:'flex',flexDirection:'column' }} onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'12px 16px',borderBottom:'1px solid var(--border2)',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div style={{ fontWeight:900,fontSize:15,color:'var(--gold)' }}>{isNew?'+ Neue Rasse':'✏️ Rasse'}</div>
          <span onClick={onClose} style={{ cursor:'pointer',color:'var(--text3)',fontSize:20 }}>✕</span>
        </div>
        <div style={{ flex:1,overflow:'auto',padding:'14px 16px' }}>
          {/* Identity */}
          <div style={{ display:'flex',gap:8,marginBottom:10,alignItems:'center' }}>
            <select value={form.icon} onChange={e=>set('icon',e.target.value)}
              style={{ width:52,fontSize:22,background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:6,color:'var(--text)' }}>
              {RACE_ICONS.map(i=><option key={i} value={i}>{i}</option>)}
            </select>
            <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Rassen-Name *" style={{ flex:1 }} />
            <input type="color" value={form.color} onChange={e=>set('color',e.target.value)}
              style={{ width:40,height:36,border:'none',background:'none',cursor:'pointer' }} />
          </div>
          <input className="input" value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Beschreibung" style={{ marginBottom:14 }} />

          {/* Building picker */}
          <div style={{ fontSize:11,color:'var(--text3)',marginBottom:8 }}>
            Gebäude wählen <span style={{ color:'var(--text3)' }}>({form.building_ids.length} gewählt — empfohlen: 3)</span>
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:6 }}>
            {allBuildings.map(b => {
              const sel = form.building_ids.includes(b.id);
              return (
                <div key={b.id} onClick={()=>toggleBuilding(b.id)} style={{
                  padding:'8px 10px',borderRadius:8,cursor:'pointer',
                  border:`2px solid ${sel?form.color:'var(--border2)'}`,
                  background: sel?`${form.color}18`:'var(--bg2)',
                  display:'flex',alignItems:'center',gap:8,
                }}>
                  <span style={{ fontSize:18 }}>{b.icon||'🏰'}</span>
                  <div>
                    <div style={{ fontSize:11,fontWeight:700,color:sel?form.color:'var(--text2)' }}>{b.name}</div>
                    <div style={{ fontSize:9,color:'var(--text3)' }}>
                      {b.cost}g · {DMG_ICONS[b.dmg_type]||''} {b.group}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {allBuildings.length === 0 && (
            <div style={{ fontSize:11,color:'var(--text3)',textAlign:'center',padding:16 }}>
              Keine Gebäude verfügbar. Erstelle zuerst Gebäude im "Gebäude"-Tab.
            </div>
          )}
          <div style={{ display:'flex',alignItems:'center',gap:8,marginTop:12 }}>
            <input type="checkbox" id="pub_r" checked={form.is_public} onChange={e=>set('is_public',e.target.checked)} />
            <label htmlFor="pub_r" style={{ fontSize:12 }}>Rasse öffentlich teilen</label>
          </div>
        </div>
        <div style={{ padding:'10px 16px',borderTop:'1px solid var(--border2)',display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap' }}>
          {saveErr&&<div style={{ width:'100%',fontSize:11,color:'var(--red)',padding:'4px 0' }}>⚠️ {saveErr}</div>}
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()||saving}>
            {saving?'⏳ Speichert…':'💾 Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Content Browser (tabs: Gebäude | Einheiten | Rassen) ───────
export default function WorkshopContent() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab]          = useState('buildings');
  const [buildings, setBuildings] = useState([]);
  const [units, setUnits]      = useState([]);
  const [races, setRaces]      = useState([]);
  const [editor, setEditor]    = useState(null); // {type, item}
  const [loading, setLoading]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [br, ur, rr] = await Promise.all([
        api.get('/workshop/buildings?mine=true').catch(()=>({data:[]})),
        api.get('/workshop/units?mine=true').catch(()=>({data:[]})),
        api.get('/workshop/races').catch(()=>({data:[]})),
      ]);
      setBuildings(Array.isArray(br.data) ? br.data : []);
      setUnits(Array.isArray(ur.data) ? ur.data : []);
      setRaces(Array.isArray(rr.data) ? rr.data : []);
    } catch (e) { console.error('Workshop load error:', e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (type, id) => {
    if (!confirm('Löschen?')) return;
    await api.delete(`/workshop/${type}/${id}`).catch(()=>{});
    load();
  };

  const tabBtn = (k,l,count) => (
    <button onClick={()=>setTab(k)} style={{ padding:'8px 14px',border:'none',background:'none',cursor:'pointer',
      fontFamily:'Cinzel,serif',fontWeight:700,fontSize:11,
      color:tab===k?'var(--gold)':'var(--text3)',
      borderBottom:tab===k?'2px solid var(--gold)':'2px solid transparent' }}>
      {l} {count>0&&<span style={{ fontSize:9,color:'var(--text3)' }}>({count})</span>}
    </button>
  );

  // renderItems: inline render helper (NOT a component — avoids React hook rules violation)
  const renderItems = (items, type) => {
    const filtered = (items||[]).filter(x=>!x.is_builtin);
    return (
      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:10,padding:'12px 16px' }}>
        {filtered.map(item=>(
          <div key={item.id} style={{ background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:8,padding:12 }}>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:6 }}>
              <span style={{ fontSize:22 }}>{item.icon||'❓'}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700,fontSize:13,color:'var(--text)' }}>{item.name}</div>
                <div style={{ fontSize:10,color:'var(--text3)' }}>
                  {type==='buildings'&&`${item.cost||0}g · ${DMG_ICONS[item.dmg_type]||''} · R${item.base_range||0}`}
                  {type==='units'&&`${item.base_hp||0}HP · ${item.base_speed||0}spd · ${item.base_reward||0}g`}
                  {type==='races'&&`${item.building_ids?.length||0} Gebäude`}
                </div>
              </div>
              <span style={{ width:10,height:10,borderRadius:'50%',background:item.color||'#888',flexShrink:0,border:'1px solid rgba(255,255,255,.2)' }} />
            </div>
            {item.description&&<div style={{ fontSize:10,color:'var(--text3)',marginBottom:8,lineHeight:1.3 }}>{item.description}</div>}
            <div style={{ display:'flex',gap:6 }}>
              <button className="btn btn-ghost btn-sm" style={{ flex:1 }} onClick={()=>setEditor({type,item})}>✏️ Bearbeiten</button>
              <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }} onClick={()=>del(type,item.id)}>🗑️</button>
              {item.is_public
                ? <span style={{ fontSize:9,color:'#40a840',alignSelf:'center' }}>🌍</span>
                : <span style={{ fontSize:9,color:'var(--text3)',alignSelf:'center' }}>🔒</span>}
            </div>
          </div>
        ))}
        {filtered.length===0&&(
          <div className="empty-state" style={{ gridColumn:'1/-1' }}>
            <div className="empty-icon">{type==='buildings'?'🏰':type==='units'?'👾':'⚔️'}</div>
            Noch nichts hier. Erstelle dein erstes {type==='buildings'?'Gebäude':type==='units'?'Einheit':'Rasse'}!
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ height:'100%',overflow:'auto' }}>
      <div className="page-header">
        <span className="page-title">🔨 Inhalte</span>
        <button className="btn btn-primary btn-sm"
          onClick={()=>setEditor({type:tab,item:null})}>
          + {tab==='buildings'?'Gebäude':tab==='units'?'Einheit':'Rasse'} erstellen
        </button>
      </div>
      <div style={{ display:'flex',borderBottom:'1px solid var(--border2)',paddingLeft:16 }}>
        {tabBtn('buildings','🏰 Gebäude',buildings.filter(x=>!x.is_builtin).length)}
        {tabBtn('units',    '👾 Einheiten',units.length)}
        {tabBtn('races',    '⚔️ Rassen',races.filter(x=>!x.is_builtin).length)}
      </div>
      {loading ? <div className="loading-screen">⏳</div> : (
        <>
          {tab==='buildings'&&renderItems(buildings,'buildings')}
          {tab==='units'    &&renderItems(units,'units')}
          {tab==='races'    &&renderItems(races,'races')}
        </>
      )}
      {editor?.type==='buildings'&&<BuildingEditor building={editor.item} onSave={()=>{setEditor(null);load();}} onClose={()=>setEditor(null)} />}
      {editor?.type==='units'    &&<UnitEditor unit={editor.item}         onSave={()=>{setEditor(null);load();}} onClose={()=>setEditor(null)} />}
      {editor?.type==='races'    &&<RaceEditor race={editor.item}         onSave={()=>{setEditor(null);load();}} onClose={()=>setEditor(null)} />}
    </div>
  );
}
