import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { api } from '../api';
import { WaveSetEditor } from './WaveSetEditor';

// ── Shared constants ───────────────────────────────────────────
const DMG_TYPES  = ['phys','magic','expl'];
const DMG_ICONS  = { phys:'⚔️', magic:'🔮', expl:'💥' };
const SHAPES     = ['circle','square','diamond'];
const UNIT_ICONS = ['👾','🔴','🟡','🔵','🟢','👑','🐉','🦅','🐗','🦎','💀','🧟'];
const BLDG_ICONS = ['🏰','🗼','⚔️','🔧','💣','❄️','🌋','⚡','🌿','☠️','🥁','🎯'];
const RACE_ICONS = ['⚔️','💀','⚙️','🌊','🌿','🔥','❄️','⚡','🌑','🌞','🐲','🦁'];
const ABIL_ICONS = ['⬆️','🎯','⚔️','🔥','❄️','⚡','☠️','🌀','💣','🛡️','🔗','💎','🌿','🩸','📯','🚀'];

const EFFECT_KEYS = [
  {key:'dmg',label:'Schaden',hint:'+X'},
  {key:'rangeDelta',label:'Reichweite',hint:'+T'},
  {key:'cdDelta',label:'CD −%',hint:'0.1=−10%'},
  {key:'pierce',label:'Durchschlag',hint:'+N'},
  {key:'splashR',label:'Splash R',hint:'+T'},
  {key:'slowFrac',label:'Slow',hint:'0.5=50%'},
  {key:'slowDur',label:'Slow ms',hint:'2000'},
  {key:'dotMult',label:'DoT ×',hint:'1.5'},
  {key:'armorShred',label:'Rüst-Riss',hint:'0.1=10%'},
  {key:'fireDur',label:'Feuer ms',hint:'3000'},
  {key:'fireDmg',label:'Feuer Dmg',hint:'8'},
  {key:'chains',label:'Ketten+',hint:'+1'},
  {key:'shatBonus',label:'Splitter%',hint:'0.2'},
  {key:'spreadChance',label:'Spread%',hint:'0.5'},
  {key:'clusterN',label:'Cluster',hint:'3'},
  {key:'healMult',label:'Heilung×',hint:'2.0'},
  {key:'pullStrength',label:'Sog',hint:'0.5'},
  {key:'rootDurDelta',label:'Root+ms',hint:'1000'},
  {key:'auraSpeed',label:'AuraSpd%',hint:'0.1'},
  {key:'auraDmg',label:'AuraDmg%',hint:'0.1'},
  {key:'dmgRedDelta',label:'DmgRed%',hint:'0.05'},
];

// ── Builtin gallery (horizontal scroll, expand, copy) ──────────
function BuiltinGallery({ items, type, label, onCopy }) {
  const [expanded, setExpanded] = useState(null);

  if (!items?.length) return null;

  const getSubtitle = (item) => {
    if (type==='buildings') return `${item.cost||0}g · ${DMG_ICONS[item.dmg_type]||''} · R${item.base_range||0}`;
    if (type==='units') return `${item.base_hp||0}HP · ${item.base_speed||0}spd`;
    if (type==='abilities') return `${item.tower||''} · ${(item.levels||[]).length-1} Stufen`;
    if (type==='races') return `${(item.building_ids||[]).length} Gebäude`;
    return '';
  };

  return (
    <div style={{ marginBottom:12 }}>
      <div style={{ fontSize:10, color:'var(--text3)', letterSpacing:.5, marginBottom:5, fontWeight:700 }}>
        📚 EINGEBAUTE {label.toUpperCase()}
      </div>
      {/* Horizontal scroll row */}
      <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:6 }}>
        {items.map(item => (
          <div key={item.id} style={{ flexShrink:0, width:90, background:'var(--bg2)',
            border:`1px solid ${expanded===item.id?'var(--gold)':'var(--border2)'}`,
            borderRadius:7, padding:'6px 6px 4px', cursor:'pointer', textAlign:'center',
            transition:'border-color .15s' }}
            onClick={() => setExpanded(expanded===item.id ? null : item.id)}>
            <div style={{ fontSize:18 }}>{item.icon||'❓'}</div>
            <div style={{ fontSize:8, fontWeight:700, color:'var(--text2)', lineHeight:1.2, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.name}</div>
            <div style={{ fontSize:7, color:'var(--text3)', marginTop:1 }}>{getSubtitle(item)}</div>
          </div>
        ))}
      </div>
      {/* Expanded detail */}
      {expanded && (() => {
        const item = items.find(x=>x.id===expanded);
        if (!item) return null;
        return (
          <div style={{ background:'rgba(240,200,60,.06)', border:'1px solid rgba(240,200,60,.2)', borderRadius:8, padding:10, marginTop:2 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
              <div>
                <span style={{ fontSize:14 }}>{item.icon}</span>
                <span style={{ fontWeight:900, color:'var(--gold)', fontSize:13, marginLeft:6 }}>{item.name}</span>
                {item.description && <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>{item.description}</div>}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => { onCopy(item); setExpanded(null); }}>
                📋 Kopieren
              </button>
            </div>
            {type==='abilities' && (item.levels||[]).map((lvl,i) => (
              <div key={i} style={{ fontSize:9, color: i===0?'var(--text3)':'var(--text2)', display:'flex', gap:8, padding:'2px 0', borderTop:i>0?'1px solid var(--border2)':undefined }}>
                <span style={{ minWidth:48, color:'var(--text3)' }}>{i===0?'Passiv':`Stufe ${i}`}</span>
                <span>{lvl.desc}</span>
                {lvl.cost>0&&<span style={{ color:'var(--gold)', marginLeft:'auto' }}>{lvl.cost}g</span>}
              </div>
            ))}
            {type==='buildings' && <>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:4, marginTop:4 }}>
                {[['Kosten',item.cost+'g'],['Schaden',item.base_dmg],['Reichweite',item.base_range+'T'],['Cooldown',item.base_cd+'ms'],['Typ',DMG_ICONS[item.dmg_type]+' '+item.dmg_type],['Luft',item.can_hit_air?'✓':'✗']].map(([k,v])=>(
                  <div key={k} style={{ background:'var(--bg)',borderRadius:4,padding:'3px 5px' }}>
                    <div style={{ fontSize:7, color:'var(--text3)' }}>{k}</div>
                    <div style={{ fontSize:10, fontWeight:700, color:'var(--text)' }}>{v}</div>
                  </div>
                ))}
              </div>
            </>}
            {type==='units' && <>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:4, marginTop:4 }}>
                {[['HP',item.base_hp],['Geschw.',item.base_speed],['Bounty',item.base_reward+'g'],['Phys.Rst.',Math.round((item.armor_phys||0)*100)+'%'],['Mag.Rst.',Math.round((item.armor_magic||0)*100)+'%'],['Typ',item.is_air?'🦅 Luft':'🏃 Boden']].map(([k,v])=>(
                  <div key={k} style={{ background:'var(--bg)',borderRadius:4,padding:'3px 5px' }}>
                    <div style={{ fontSize:7, color:'var(--text3)' }}>{k}</div>
                    <div style={{ fontSize:10, fontWeight:700, color:'var(--text)' }}>{v}</div>
                  </div>
                ))}
              </div>
            </>}
          </div>
        );
      })()}
    </div>
  );
}

// ── Ability Level Editor ───────────────────────────────────────
function AbilityLevelEditor({ level, idx, onChange }) {
  const addEffect = (key) => {
    const def = EFFECT_KEYS.find(e=>e.key===key);
    onChange({ ...level, effects: { ...level.effects, [key]: key.includes('Frac')||key.includes('Delta')||key.includes('Mult')||key.includes('Chance')||key.includes('Bonus')||key.includes('Strength')||key.includes('Shred') ? 0.1 : 10 } });
  };
  const removeEffect = (key) => {
    const eff = {...level.effects}; delete eff[key];
    onChange({ ...level, effects: eff });
  };

  return (
    <div style={{ background:'rgba(0,0,0,.2)', borderRadius:6, padding:'8px 10px', marginBottom:5 }}>
      <div style={{ display:'flex', gap:6, marginBottom:5, alignItems:'center' }}>
        <span style={{ fontSize:11, color:'var(--text3)', minWidth:52, fontWeight:700 }}>
          {idx===0?'Passiv':'Stufe '+idx}
        </span>
        <input className="input" value={level.desc} onChange={e=>onChange({...level,desc:e.target.value})}
          placeholder={idx===0?'Passiver Effekt (immer aktiv)':'Beschreibung der Stufe'} style={{ flex:1, fontSize:11 }} />
        {idx>0 && <input className="input" type="number" value={level.cost||0}
          onChange={e=>onChange({...level,cost:+e.target.value})}
          style={{ width:68 }} placeholder="Gold" />}
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:4, alignItems:'center' }}>
        {Object.entries(level.effects||{}).map(([k,v])=>(
          <div key={k} style={{ display:'flex', alignItems:'center', gap:2, background:'rgba(240,200,60,.12)', border:'1px solid rgba(240,200,60,.3)', borderRadius:4, padding:'2px 5px' }}>
            <span style={{ fontSize:8, color:'var(--text2)' }}>{k}</span>
            <input type="number" step="any" value={v}
              onChange={e=>onChange({...level,effects:{...level.effects,[k]:+e.target.value}})}
              style={{ width:48, fontSize:9, background:'transparent', border:'none', color:'var(--gold)', outline:'none' }} />
            <span onClick={()=>removeEffect(k)} style={{ cursor:'pointer', color:'var(--red)', fontSize:9 }}>✕</span>
          </div>
        ))}
        <select style={{ fontSize:9, background:'var(--bg)', border:'1px solid var(--border2)', borderRadius:4, color:'var(--text3)', padding:'2px 3px' }}
          value="" onChange={e=>{if(e.target.value)addEffect(e.target.value);e.target.value='';}}>
          <option value="">+ Effekt</option>
          {EFFECT_KEYS.filter(ek=>!(ek.key in (level.effects||{}))).map(ek=>
            <option key={ek.key} value={ek.key}>{ek.label} ({ek.hint})</option>
          )}
        </select>
      </div>
    </div>
  );
}

// ── Ability Editor ─────────────────────────────────────────────
export function AbilityEditor({ ability, onSave, onClose }) {
  const isNew = !ability?.id || ability?.is_builtin;
  const [form, setForm] = useState({
    name: ability && !ability.is_builtin ? ability.name : '',
    description: ability?.description || '',
    icon: ability?.icon || '⬆️',
    is_public: ability?.is_public || false,
    levels: ability?.levels?.length ? ability.levels
      : [
        {desc:'Passiv-Effekt (kein Upgrade nötig)',cost:0,effects:{}},
        {desc:'Stufe 1',cost:50,effects:{}},
        {desc:'Stufe 2',cost:80,effects:{}},
        {desc:'Stufe 3',cost:120,effects:{}},
        {desc:'Stufe 4',cost:170,effects:{}},
        {desc:'Stufe 5',cost:230,effects:{}},
      ],
  });
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true); setSaveErr('');
    try {
      const r = isNew
        ? await api.post('/workshop/abilities', form)
        : await api.put(`/workshop/abilities/${ability.id}`, form);
      onSave(r.data);
    } catch(e) { setSaveErr(e.response?.data?.error||'Fehler beim Speichern'); }
    setSaving(false);
  };

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.75)',backdropFilter:'blur(4px)',zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }} onClick={onClose}>
      <div style={{ background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:12,width:'100%',maxWidth:560,maxHeight:'92vh',overflow:'hidden',display:'flex',flexDirection:'column' }} onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'12px 16px',borderBottom:'1px solid var(--border2)',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div style={{ fontWeight:900,fontSize:15,color:'var(--gold)' }}>{isNew?'+ Neue Ability':'✏️ Ability'}</div>
          <span onClick={onClose} style={{ cursor:'pointer',color:'var(--text3)',fontSize:20 }}>✕</span>
        </div>
        <div style={{ flex:1,overflow:'auto',padding:'12px 16px' }}>
          <div style={{ display:'flex',gap:8,marginBottom:10,alignItems:'center' }}>
            <select value={form.icon} onChange={e=>set('icon',e.target.value)}
              style={{ width:52,fontSize:22,background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:6,color:'var(--text)' }}>
              {ABIL_ICONS.map(i=><option key={i} value={i}>{i}</option>)}
            </select>
            <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Ability Name *" style={{ flex:1 }} />
          </div>
          <input className="input" value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Beschreibung (optional)" style={{ marginBottom:10 }} />

          <div style={{ fontSize:11,color:'var(--text3)',marginBottom:8 }}>
            6 Stufen: Passiv (Level 0, immer aktiv) + Stufen 1–5 (kaufbar)
          </div>
          {form.levels.map((lvl,i)=>(
            <AbilityLevelEditor key={i} level={lvl} idx={i}
              onChange={updated=>set('levels',form.levels.map((l,j)=>j===i?updated:l))} />
          ))}
          <div style={{ display:'flex',alignItems:'center',gap:8,marginTop:8 }}>
            <input type="checkbox" id="pub_a" checked={form.is_public} onChange={e=>set('is_public',e.target.checked)} />
            <label htmlFor="pub_a" style={{ fontSize:12 }}>Öffentlich teilen</label>
          </div>
        </div>
        <div style={{ padding:'10px 16px',borderTop:'1px solid var(--border2)',display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap' }}>
          {saveErr&&<div style={{ width:'100%',fontSize:11,color:'var(--red)' }}>⚠️ {saveErr}</div>}
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()||saving}>
            {saving?'⏳ Speichert…':'💾 Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Ability picker (assign 3 abilities to a building/unit) ─────
function AbilityPicker({ selectedIds, onChange, builtinAbilities, customAbilities }) {
  const all = [
    ...(builtinAbilities||[]).map(a=>({...a,_builtin:true})),
    ...(customAbilities||[]).map(a=>({...a,_builtin:false})),
  ];
  const toggle = (id) => {
    const cur = selectedIds||[];
    if (cur.includes(id)) onChange(cur.filter(x=>x!==id));
    else if (cur.length < 3) onChange([...cur, id]);
  };
  return (
    <div>
      <div style={{ fontSize:10,color:'var(--text3)',marginBottom:6 }}>
        Bis zu 3 Abilities wählen ({(selectedIds||[]).length}/3)
      </div>
      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,maxHeight:240,overflowY:'auto' }}>
        {all.map(a=>{
          const sel=(selectedIds||[]).includes(a.id);
          return (
            <div key={a.id} onClick={()=>toggle(a.id)} style={{
              padding:'6px 8px',borderRadius:6,cursor:'pointer',
              border:`1.5px solid ${sel?'var(--gold)':'var(--border2)'}`,
              background:sel?'rgba(240,200,60,.1)':'var(--bg2)',
              display:'flex',alignItems:'center',gap:6,
            }}>
              <span style={{ fontSize:16,flexShrink:0 }}>{a.icon}</span>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:10,fontWeight:700,color:sel?'var(--gold)':'var(--text2)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{a.name}</div>
                <div style={{ fontSize:8,color:'var(--text3)' }}>{a._builtin?`${a.tower||'Eingebaut'}`:'Custom'}</div>
              </div>
            </div>
          );
        })}
        {all.length===0&&<div style={{ gridColumn:'1/-1',fontSize:11,color:'var(--text3)',textAlign:'center',padding:12 }}>
          Keine Abilities verfügbar. Erstelle zuerst eine Ability.
        </div>}
      </div>
    </div>
  );
}

// ── Building Editor ────────────────────────────────────────────
export function BuildingEditor({ building, onSave, onClose }) {
  const isNew = !building?.id;
  const [form, setForm] = useState({
    name: building?.name||'',description:building?.description||'',
    icon:building?.icon||'🏰',color:building?.color||'#c0a060',sprite_type:'generic',
    cost:building?.cost||100,base_range:building?.base_range||3.0,
    base_cd:building?.base_cd||1000,base_dmg:building?.base_dmg||20,
    dmg_type:building?.dmg_type||'phys',unlock_wave:building?.unlock_wave||0,
    can_hit_air:building?.can_hit_air??true,flags:building?.flags||{},
    ability_ids:building?.ability_ids||[],is_public:building?.is_public||false,
  });
  const [tab, setTab] = useState('stats');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [builtinAbil, setBuiltinAbil] = useState([]);
  const [customAbil, setCustomAbil]   = useState([]);
  const [builtinBldg, setBuiltinBldg] = useState([]);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const setFlag = (k,v) => setForm(f=>({...f,flags:{...f.flags,[k]:v===false?undefined:v}}));

  const FLAG_KEYS = [
    {key:'isSpinAoe',label:'Spin-AoE (Melee)',hint:'Fleischwolf-Stil'},
    {key:'isRingAoe',label:'Ring-AoE (alle)',hint:'Elektrozaun-Stil'},
    {key:'isAura',  label:'Aura (Speed/Dmg)',hint:'Kriegstrommel-Stil'},
    {key:'isHealAura',label:'Heilaura',hint:'Mondlichtaltar-Stil'},
    {key:'isPull',  label:'Sog (Pull)',hint:'Sturmstrudel-Stil'},
    {key:'blindSpot',label:'Blind Spot',hint:'Mörser-Stil'},
  ];

  useEffect(() => {
    api.get('/workshop/abilities/builtin').then(r=>setBuiltinAbil(Array.isArray(r.data)?r.data:[])).catch(()=>{});
    api.get('/workshop/abilities').then(r=>setCustomAbil(Array.isArray(r.data)?r.data:[])).catch(()=>{});
    api.get('/workshop/buildings/builtin').then(r=>setBuiltinBldg(Array.isArray(r.data)?r.data:[])).catch(()=>{});
  },[]);

  const copyBuiltin = (item) => {
    setForm(f=>({...f, name:item.name+' (Kopie)', icon:item.icon||f.icon,
      cost:item.cost||f.cost, base_dmg:item.base_dmg||item.baseDmg||f.base_dmg,
      base_range:item.base_range||item.baseRange||f.base_range,
      base_cd:item.base_cd||item.baseCd||f.base_cd,
      dmg_type:item.dmg_type||item.dmgType||f.dmg_type,
      can_hit_air:item.can_hit_air??f.can_hit_air,
    }));
    setSaveErr('');
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true); setSaveErr('');
    try {
      const r = isNew
        ? await api.post('/workshop/buildings', form)
        : await api.put(`/workshop/buildings/${building.id}`, form);
      onSave(r.data);
    } catch(e) { setSaveErr(e.response?.data?.error||e.response?.data?.detail||'Fehler beim Speichern'); }
    setSaving(false);
  };

  const tabBtn = (k,l) => (
    <button onClick={()=>setTab(k)} style={{ padding:'7px 12px',border:'none',background:'none',cursor:'pointer',
      fontFamily:'Cinzel,serif',fontSize:10,fontWeight:700,
      color:tab===k?'var(--gold)':'var(--text3)',
      borderBottom:tab===k?'2px solid var(--gold)':'2px solid transparent' }}>{l}</button>
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
          {tabBtn('flags','⚙️ Mechanik')}
          {tabBtn('abilities','✨ Abilities')}
        </div>
        <div style={{ flex:1,overflow:'auto',padding:'12px 16px' }}>
          {tab==='stats'&&<>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
              <div style={{ gridColumn:'1/-1',display:'flex',gap:8,alignItems:'center' }}>
                <select value={form.icon} onChange={e=>set('icon',e.target.value)}
                  style={{ width:52,fontSize:22,background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:6,color:'var(--text)' }}>
                  {BLDG_ICONS.map(i=><option key={i} value={i}>{i}</option>)}
                </select>
                <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Name *" style={{ flex:1 }} />
                <input type="color" value={form.color} onChange={e=>set('color',e.target.value)} style={{ width:40,height:36,border:'none',background:'none',cursor:'pointer' }} />
              </div>
              <div style={{ gridColumn:'1/-1' }}>
                <input className="input" value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Beschreibung" />
              </div>
              {[['cost','Kosten (g)',1,9999,1],['base_dmg','Grundschaden',1,9999,1],
                ['base_range','Reichweite (T)',0.5,15,0.5],['base_cd','Cooldown (ms)',100,30000,100],
                ['unlock_wave','Ab Wave',0,25,1]].map(([k,l,mn,mx,st])=>(
                <div key={k}>
                  <label style={{ fontSize:10,color:'var(--text3)' }}>{l}</label>
                  <input className="input" type="number" min={mn} max={mx} step={st} value={form[k]} onChange={e=>set(k,+e.target.value)} />
                </div>
              ))}
              <div>
                <label style={{ fontSize:10,color:'var(--text3)' }}>Schadenstyp</label>
                <div style={{ display:'flex',gap:5,marginTop:4 }}>
                  {DMG_TYPES.map(d=>(
                    <button key={d} onClick={()=>set('dmg_type',d)} style={{ flex:1,padding:5,
                      border:`2px solid ${form.dmg_type===d?'var(--gold)':'var(--border2)'}`,
                      background:form.dmg_type===d?'rgba(240,200,60,.15)':'var(--bg2)',
                      borderRadius:5,cursor:'pointer',fontSize:12,color:'var(--text)' }}>
                      {DMG_ICONS[d]}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display:'flex',gap:10,paddingTop:12 }}>
                <label style={{ fontSize:12,display:'flex',gap:6,alignItems:'center' }}>
                  <input type="checkbox" checked={form.can_hit_air} onChange={e=>set('can_hit_air',e.target.checked)} />
                  Trifft Luft
                </label>
                <label style={{ fontSize:12,display:'flex',gap:6,alignItems:'center' }}>
                  <input type="checkbox" checked={form.is_public} onChange={e=>set('is_public',e.target.checked)} />
                  Öffentlich
                </label>
              </div>
            </div>
          </>}
          {tab==='flags'&&(
            <div>
              <div style={{ fontSize:11,color:'var(--text3)',marginBottom:10 }}>Spezielle Mechaniken — max. eine empfohlen</div>
              {FLAG_KEYS.map(({key,label,hint})=>(
                <div key={key} style={{ display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border2)' }}>
                  <input type="checkbox" id={`flag-${key}`} checked={!!form.flags[key]} onChange={e=>setFlag(key,e.target.checked?( key==='blindSpot'?1.5:true):false)} />
                  <div style={{ flex:1 }}>
                    <label htmlFor={`flag-${key}`} style={{ fontSize:13,fontWeight:700,color:'var(--text)',cursor:'pointer' }}>{label}</label>
                    <div style={{ fontSize:10,color:'var(--text3)' }}>{hint}</div>
                  </div>
                  {key==='blindSpot'&&form.flags.blindSpot&&(
                    <input type="number" min="0.5" max="5" step="0.5" value={form.flags.blindSpot||1.5}
                      onChange={e=>setFlag('blindSpot',+e.target.value)} className="input" style={{ width:64 }} />
                  )}
                </div>
              ))}
            </div>
          )}
          {tab==='abilities'&&(
            <div>
              <AbilityPicker selectedIds={form.ability_ids} onChange={ids=>set('ability_ids',ids)}
                builtinAbilities={builtinAbil} customAbilities={customAbil} />
            </div>
          )}
        </div>
        <div style={{ padding:'10px 16px',borderTop:'1px solid var(--border2)',display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap' }}>
          {saveErr&&<div style={{ width:'100%',fontSize:11,color:'var(--red)' }}>⚠️ {saveErr}</div>}
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()||saving}>
            {saving?'⏳':'💾'} Speichern
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
    name:unit?.name||'',description:unit?.description||'',
    icon:unit?.icon||'👾',color:unit?.color||'#b02810',
    shape:unit?.shape||'circle',size_factor:unit?.size_factor||0.26,
    base_hp:unit?.base_hp||100,base_speed:unit?.base_speed||1.5,
    base_reward:unit?.base_reward||10,
    armor_phys:unit?.armor_phys||0,armor_magic:unit?.armor_magic||0,
    is_air:unit?.is_air||false,ability_ids:unit?.ability_ids||[],
    is_public:unit?.is_public||false,
  });
  const [saving,setSaving]=useState(false);
  const [saveErr,setSaveErr]=useState('');
  const [builtinAbil,setBuiltinAbil]=useState([]);
  const [customAbil,setCustomAbil]=useState([]);
  const [builtinUnits,setBuiltinUnits]=useState([]);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));

  useEffect(()=>{
    api.get('/workshop/abilities/builtin').then(r=>setBuiltinAbil(Array.isArray(r.data)?r.data:[])).catch(()=>{});
    api.get('/workshop/abilities').then(r=>setCustomAbil(Array.isArray(r.data)?r.data:[])).catch(()=>{});
    api.get('/workshop/units/builtin').then(r=>setBuiltinUnits(Array.isArray(r.data)?r.data.map(u=>({...u,icon:u.col?'👾':u.icon||'👾'})):[])).catch(()=>{});
  },[]);

  const copyBuiltin=(item)=>{
    setForm(f=>({...f,name:item.name+' (Kopie)',color:item.col||f.color,
      base_hp:item.base_hp||f.base_hp,base_speed:item.base_speed||f.base_speed,
      base_reward:item.base_reward||f.base_reward,is_air:item.is_air||f.is_air}));
  };

  const save=async()=>{
    if(!form.name.trim())return;
    setSaving(true);setSaveErr('');
    try{
      const r=isNew?await api.post('/workshop/units',form):await api.put(`/workshop/units/${unit.id}`,form);
      onSave(r.data);
    }catch(e){setSaveErr(e.response?.data?.error||'Fehler');}
    setSaving(false);
  };

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.75)',backdropFilter:'blur(4px)',zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }} onClick={onClose}>
      <div style={{ background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:12,width:'100%',maxWidth:520,maxHeight:'92vh',overflow:'hidden',display:'flex',flexDirection:'column' }} onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'12px 16px',borderBottom:'1px solid var(--border2)',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div style={{ fontWeight:900,fontSize:15,color:'var(--gold)' }}>{isNew?'+ Neue Einheit':'✏️ Einheit'}</div>
          <span onClick={onClose} style={{ cursor:'pointer',color:'var(--text3)',fontSize:20 }}>✕</span>
        </div>
        <div style={{ flex:1,overflow:'auto',padding:'12px 16px' }}>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10 }}>
            <div style={{ gridColumn:'1/-1',display:'flex',gap:8,alignItems:'center' }}>
              <select value={form.icon} onChange={e=>set('icon',e.target.value)}
                style={{ width:52,fontSize:22,background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:6,color:'var(--text)' }}>
                {UNIT_ICONS.map(i=><option key={i} value={i}>{i}</option>)}
              </select>
              <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Name *" style={{ flex:1 }} />
              <input type="color" value={form.color} onChange={e=>set('color',e.target.value)} style={{ width:40,height:36,border:'none',background:'none',cursor:'pointer' }} />
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <input className="input" value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Beschreibung" />
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Form</label>
              <div style={{ display:'flex',gap:4,marginTop:4 }}>
                {SHAPES.map(s=>(
                  <button key={s} onClick={()=>set('shape',s)} style={{ flex:1,padding:5,
                    border:`2px solid ${form.shape===s?'var(--gold)':'var(--border2)'}`,
                    background:form.shape===s?'rgba(240,200,60,.15)':'var(--bg2)',
                    borderRadius:5,cursor:'pointer',fontSize:9,color:'var(--text)' }}>{s}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Größe (0.1–0.8)</label>
              <input className="input" type="number" min="0.1" max="0.8" step="0.05" value={form.size_factor} onChange={e=>set('size_factor',+e.target.value)} />
            </div>
            {[['base_hp','HP',1,99999,1],['base_speed','Geschw.',0.1,20,0.1],
              ['base_reward','Bounty (g)',1,9999,1],['armor_phys','Phys. Rüstung',0,0.9,0.05],
              ['armor_magic','Magic. Rüstung',0,0.8,0.05]].map(([k,l,mn,mx,st])=>(
              <div key={k}>
                <label style={{ fontSize:10,color:'var(--text3)' }}>{l}</label>
                <input className="input" type="number" min={mn} max={mx} step={st} value={form[k]} onChange={e=>set(k,+e.target.value)} />
              </div>
            ))}
            <div style={{ display:'flex',gap:12,paddingTop:8,alignItems:'center' }}>
              <label style={{ fontSize:12,display:'flex',gap:6,alignItems:'center' }}>
                <input type="checkbox" checked={form.is_air} onChange={e=>set('is_air',e.target.checked)} />🦅 Luft
              </label>
              <label style={{ fontSize:12,display:'flex',gap:6,alignItems:'center' }}>
                <input type="checkbox" checked={form.is_public} onChange={e=>set('is_public',e.target.checked)} />Öffentlich
              </label>
            </div>
          </div>
          <div style={{ borderTop:'1px solid var(--border2)',paddingTop:10 }}>
            <div style={{ fontSize:11,fontWeight:700,color:'var(--text2)',marginBottom:8 }}>✨ Abilities (bis zu 3)</div>
            <AbilityPicker selectedIds={form.ability_ids} onChange={ids=>set('ability_ids',ids)}
              builtinAbilities={builtinAbil} customAbilities={customAbil} />
          </div>
        </div>
        <div style={{ padding:'10px 16px',borderTop:'1px solid var(--border2)',display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap' }}>
          {saveErr&&<div style={{ width:'100%',fontSize:11,color:'var(--red)' }}>⚠️ {saveErr}</div>}
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()||saving}>
            {saving?'⏳':'💾'} Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Race Editor ────────────────────────────────────────────────
export function RaceEditor({ race, onSave, onClose }) {
  const isNew = !race?.id || race.is_builtin;
  const BUILTIN_BUILDINGS_LIST = [
    {id:'dart',name:'Dart',cost:75,dmg_type:'phys',icon:'🔧',race:'standard',color:'#3ab8ff',base_range:3.5,base_dmg:20,base_cd:460},
    {id:'poison',name:'Gift',cost:100,dmg_type:'magic',icon:'🔧',race:'standard',color:'#44d040',base_range:3.0,base_dmg:8,base_cd:1800},
    {id:'splash',name:'Kanone',cost:125,dmg_type:'expl',icon:'🔧',race:'standard',color:'#ff7820',base_range:2.8,base_dmg:48,base_cd:1600},
    {id:'frost',name:'Frost',cost:175,dmg_type:'magic',icon:'⭐',race:'universal',color:'#80eeff',base_range:3.6,base_dmg:18,base_cd:1150},
    {id:'lightning',name:'Blitz',cost:200,dmg_type:'magic',icon:'⭐',race:'universal',color:'#ffe840',base_range:4.0,base_dmg:62,base_cd:860},
    {id:'fleischwolf',name:'Fleischwolf',cost:110,dmg_type:'phys',icon:'🔧',race:'orcs',color:'#e04020',base_range:1.5,base_dmg:55,base_cd:600},
    {id:'wurfspeer',name:'Wurfspeer',cost:90,dmg_type:'phys',icon:'🔧',race:'orcs',color:'#c06020',base_range:5.0,base_dmg:35,base_cd:1100},
    {id:'kriegstrommel',name:'Kriegstrommel',cost:150,dmg_type:'phys',icon:'🔧',race:'orcs',color:'#a05010',base_range:3.0,base_dmg:0,base_cd:99999},
    {id:'moerser',name:'Mörser',cost:140,dmg_type:'expl',icon:'🔧',race:'techies',color:'#a0a0a0',base_range:5.5,base_dmg:80,base_cd:2200},
    {id:'elektrozaun',name:'Elektrozaun',cost:160,dmg_type:'magic',icon:'🔧',race:'techies',color:'#60d8ff',base_range:3.0,base_dmg:30,base_cd:1400},
    {id:'raketenwerfer',name:'Raketenwerfer',cost:185,dmg_type:'expl',icon:'🔧',race:'techies',color:'#e08040',base_range:4.5,base_dmg:45,base_cd:800},
    {id:'magmaquelle',name:'Magmaquelle',cost:130,dmg_type:'expl',icon:'🔧',race:'elemente',color:'#ff4010',base_range:2.5,base_dmg:25,base_cd:2000},
    {id:'sturmstrudel',name:'Sturmstrudel',cost:155,dmg_type:'magic',icon:'🔧',race:'elemente',color:'#80c0ff',base_range:3.5,base_dmg:22,base_cd:1200},
    {id:'eisspitze',name:'Eisspitze',cost:175,dmg_type:'magic',icon:'🔧',race:'elemente',color:'#c0f0ff',base_range:4.0,base_dmg:70,base_cd:2400},
    {id:'rankenfalle',name:'Rankenfalle',cost:100,dmg_type:'phys',icon:'🔧',race:'urwald',color:'#50d040',base_range:3.2,base_dmg:30,base_cd:2500},
    {id:'giftpilz',name:'Giftpilz',cost:115,dmg_type:'magic',icon:'🔧',race:'urwald',color:'#90c020',base_range:3.0,base_dmg:10,base_cd:2000},
    {id:'mondlichtaltar',name:'Mondlichtaltar',cost:200,dmg_type:'magic',icon:'🔧',race:'urwald',color:'#d0d0ff',base_range:4.0,base_dmg:0,base_cd:99999},
  ];
  const [form,setForm]=useState({
    name:race&&!race.is_builtin?race.name:'',icon:race?.icon||'⚔️',
    color:race?.color||'#c0a060',description:race?.description||'',
    building_ids:race&&!race.is_builtin?(race.building_ids||[]):[],is_public:race?.is_public||false,
  });
  const [customBuildings,setCustomBuildings]=useState([]);
  const [saving,setSaving]=useState(false);
  const [saveErr,setSaveErr]=useState('');
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));

  useEffect(()=>{
    setCustomBuildings([]); // loaded instantly from builtin list + async
    api.get('/workshop/buildings?mine=true').then(r=>setCustomBuildings(Array.isArray(r.data)?r.data:[])).catch(()=>{});
  },[]);

  const allBuildings=[
    ...BUILTIN_BUILDINGS_LIST,
    ...customBuildings.filter(b=>!BUILTIN_BUILDINGS_LIST.find(x=>x.id===b.id)),
  ];
  const toggle=(id)=>setForm(f=>({...f,building_ids:f.building_ids.includes(id)?f.building_ids.filter(x=>x!==id):[...f.building_ids,id]}));

  const save=async()=>{
    if(!form.name.trim())return;
    setSaving(true);setSaveErr('');
    try{
      const r=isNew?await api.post('/workshop/races',form):await api.put(`/workshop/races/${race.id}`,form);
      onSave(r.data);
    }catch(e){setSaveErr(e.response?.data?.error||'Fehler');}
    setSaving(false);
  };

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.75)',backdropFilter:'blur(4px)',zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }} onClick={onClose}>
      <div style={{ background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:12,width:'100%',maxWidth:540,maxHeight:'92vh',overflow:'hidden',display:'flex',flexDirection:'column' }} onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'12px 16px',borderBottom:'1px solid var(--border2)',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div style={{ fontWeight:900,fontSize:15,color:'var(--gold)' }}>{isNew?'+ Neue Rasse':'✏️ Rasse'}</div>
          <span onClick={onClose} style={{ cursor:'pointer',color:'var(--text3)',fontSize:20 }}>✕</span>
        </div>
        <div style={{ flex:1,overflow:'auto',padding:'14px 16px' }}>
          <div style={{ display:'flex',gap:8,marginBottom:10,alignItems:'center' }}>
            <select value={form.icon} onChange={e=>set('icon',e.target.value)}
              style={{ width:52,fontSize:22,background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:6,color:'var(--text)' }}>
              {RACE_ICONS.map(i=><option key={i} value={i}>{i}</option>)}
            </select>
            <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Rassen-Name *" style={{ flex:1 }} />
            <input type="color" value={form.color} onChange={e=>set('color',e.target.value)} style={{ width:40,height:36,border:'none',background:'none',cursor:'pointer' }} />
          </div>
          <input className="input" value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Beschreibung" style={{ marginBottom:14 }} />
          <div style={{ fontSize:10,color:'var(--text3)',marginBottom:6 }}>
            Gewählt: {form.building_ids.length} Gebäude
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,maxHeight:200,overflowY:'auto' }}>
            {allBuildings.map(b=>{
              const sel=form.building_ids.includes(b.id);
              return (
                <div key={b.id} onClick={()=>toggle(b.id)} style={{
                  padding:'7px 9px',borderRadius:7,cursor:'pointer',
                  border:`1.5px solid ${sel?form.color:'var(--border2)'}`,
                  background:sel?`${form.color}18`:'var(--bg2)',
                  display:'flex',alignItems:'center',gap:7,
                }}>
                  <span style={{ fontSize:16 }}>{b.icon||'🏰'}</span>
                  <div>
                    <div style={{ fontSize:10,fontWeight:700,color:sel?form.color:'var(--text2)' }}>{b.name}</div>
                    <div style={{ fontSize:8,color:'var(--text3)' }}>{b.cost}g · {DMG_ICONS[b.dmg_type]||''} · {b.race}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:8,marginTop:12 }}>
            <input type="checkbox" id="pub_r" checked={form.is_public} onChange={e=>set('is_public',e.target.checked)} />
            <label htmlFor="pub_r" style={{ fontSize:12 }}>Öffentlich teilen</label>
          </div>
        </div>
        <div style={{ padding:'10px 16px',borderTop:'1px solid var(--border2)',display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap' }}>
          {saveErr&&<div style={{ width:'100%',fontSize:11,color:'var(--red)' }}>⚠️ {saveErr}</div>}
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()||saving}>
            {saving?'⏳':'💾'} Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Content Browser ────────────────────────────────────────────
export default function WorkshopContent() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab,setTab]=useState('buildings');
  const [buildings,setBuildings]=useState([]);
  const [units,setUnits]=useState([]);
  const [races,setRaces]=useState([]);
  const [abilities,setAbilities]=useState([]);
  const [waveSets,setWaveSets]=useState([]);
  const [editor,setEditor]=useState(null);
  const [loading,setLoading]=useState(false);

  const [builtinBldg, setBuiltinBldg] = useState([]);
  const [builtinUnits2, setBuiltinUnits2] = useState([]);
  const [builtinAbil2, setBuiltinAbil2] = useState([]);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const [br,ur,rr,ar,bbl,bbu,bba]=await Promise.all([
        api.get('/workshop/buildings?mine=true').catch(()=>({data:[]})),
        api.get('/workshop/units?mine=true').catch(()=>({data:[]})),
        api.get('/workshop/races').catch(()=>({data:[]})),
        api.get('/workshop/abilities').catch(()=>({data:[]})),
        api.get('/workshop/buildings/builtin').catch(()=>({data:[]})),
        api.get('/workshop/units/builtin').catch(()=>({data:[]})),
        api.get('/workshop/abilities/builtin').catch(()=>({data:[]})),
      ]);
      setBuildings(Array.isArray(br.data)?br.data:[]);
      setUnits(Array.isArray(ur.data)?ur.data:[]);
      setRaces(Array.isArray(rr.data)?rr.data:[]);
      setAbilities(Array.isArray(ar.data)?ar.data:[]);
      const wsr = await api.get('/workshop/wave-sets').catch(()=>({data:[]}));
      setWaveSets(Array.isArray(wsr.data)?wsr.data:[]);
      setBuiltinBldg(Array.isArray(bbl.data)?bbl.data:[]);
      setBuiltinUnits2(Array.isArray(bbu.data)?bbu.data.map(u=>({...u,icon:u.icon||'👾',color:u.col||'#b02810'})):[]);
      setBuiltinAbil2(Array.isArray(bba.data)?bba.data:[]);
    }catch(e){console.error('Load error:',e);}
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  const del=async(type,id)=>{
    if(!confirm('Löschen?'))return;
    await api.delete(`/workshop/${type}/${id}`).catch(()=>{});
    load();
  };

  const tabBtn=(k,l,count)=>(
    <button onClick={()=>setTab(k)} style={{ padding:'8px 14px',border:'none',background:'none',cursor:'pointer',
      fontFamily:'Cinzel,serif',fontWeight:700,fontSize:11,
      color:tab===k?'var(--gold)':'var(--text3)',
      borderBottom:tab===k?'2px solid var(--gold)':'2px solid transparent' }}>
      {l}{count>0&&<span style={{ fontSize:9,color:'var(--text3)',marginLeft:3 }}>({count})</span>}
    </button>
  );

  const itemTypeLabel={buildings:'Gebäude',units:'Einheit',races:'Rasse',abilities:'Ability','wave-sets':'Wave-Set'};

  const renderItems=(items,type)=>{
    const filtered=(items||[]).filter(x=>!x.is_builtin);
    return (
      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:10,padding:'10px 16px' }}>
        {filtered.map(item=>(
          <div key={item.id} style={{ background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:8,padding:11 }}>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:5 }}>
              <span style={{ fontSize:20 }}>{item.icon||'❓'}</span>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ fontWeight:700,fontSize:12,color:'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{item.name}</div>
                <div style={{ fontSize:9,color:'var(--text3)' }}>
                  {type==='buildings'&&`${item.cost||0}g · ${DMG_ICONS[item.dmg_type]||''} · R${item.base_range||0}`}
                  {type==='units'&&`${item.base_hp||0}HP · ×${item.base_speed||0}`}
                  {type==='races'&&`${item.building_ids?.length||0} Gebäude`}
                  {type==='abilities'&&`${(item.levels||[]).length} Stufen`}
                  {type==='wave-sets'&&`${item.wave_count||25} Waves`}
                </div>
              </div>
              <div style={{ width:10,height:10,borderRadius:'50%',background:item.color||'#888',border:'1px solid rgba(255,255,255,.2)',flexShrink:0 }} />
            </div>
            <div style={{ display:'flex',gap:5 }}>
              <button className="btn btn-ghost btn-sm" style={{ flex:1 }} onClick={()=>setEditor({type,item})}>✏️</button>
              <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }} onClick={()=>del(type,item.id)}>🗑️</button>
              <span style={{ fontSize:9,alignSelf:'center',color:item.is_public?'#40a840':'var(--text3)' }}>
                {item.is_public?'🌍':'🔒'}
              </span>
            </div>
          </div>
        ))}
        {filtered.length===0&&(
          <div className="empty-state" style={{ gridColumn:'1/-1' }}>
            <div className="empty-icon">{type==='buildings'?'🏰':type==='units'?'👾':type==='races'?'⚔️':type==='wave-sets'?'🌊':'✨'}</div>
            Erstelle dein erstes {itemTypeLabel[type]}!
          </div>
        )}
      </div>
    );
  };

  const newLabel={buildings:'Gebäude',units:'Einheit',races:'Rasse',abilities:'Ability','wave-sets':'Wave-Set'}[tab];

  return (
    <div style={{ height:'100%',overflow:'auto' }}>
      <div className="page-header">
        <span className="page-title">🔨 Inhalte</span>
        <button className="btn btn-primary btn-sm" onClick={()=>setEditor({type:tab,item:null})}>
          + {newLabel}
        </button>
      </div>
      <div style={{ display:'flex',borderBottom:'1px solid var(--border2)',paddingLeft:16,overflowX:'auto' }}>
        {tabBtn('buildings','🏰 Gebäude',buildings.filter(x=>!x.is_builtin).length)}
        {tabBtn('units','👾 Einheiten',units.length)}
        {tabBtn('races','⚔️ Rassen',races.filter(x=>!x.is_builtin).length)}
        {tabBtn('abilities','✨ Abilities',abilities.length)}
        {tabBtn('wave-sets','🌊 Wave-Sets',waveSets.length)}
      </div>
      {loading?<div className="loading-screen">⏳</div>:(
        <>
          {tab==='buildings'&&<>
            <div style={{ padding:'10px 16px 0' }}>
              <BuiltinGallery items={builtinBldg} type="buildings" label="Eingebaute Gebäude"
                onCopy={item=>setEditor({type:'buildings',item:{...item,id:null,name:item.name+' (Kopie)',
                  base_dmg:item.baseDmg||item.base_dmg||20,base_range:item.baseRange||item.base_range||3,
                  base_cd:item.baseCd||item.base_cd||1000,cost:item.cost||100,
                  dmg_type:item.dmgType||item.dmg_type||'phys',can_hit_air:item.canHitAir??item.can_hit_air??true}})} />
            </div>
            {renderItems(buildings,'buildings')}
          </>}
          {tab==='units'&&<>
            <div style={{ padding:'10px 16px 0' }}>
              <BuiltinGallery items={builtinUnits2} type="units" label="Eingebaute Einheiten"
                onCopy={item=>setEditor({type:'units',item:{...item,id:null,name:item.name+' (Kopie)',
                  base_hp:item.base_hp||100,base_speed:item.base_speed||1.5,base_reward:item.base_reward||10}})} />
            </div>
            {renderItems(units,'units')}
          </>}
          {tab==='races'&&renderItems(races,'races')}
          {tab==='wave-sets'&&renderItems(waveSets,'wave-sets')}
          {tab==='abilities'&&<>
            <div style={{ padding:'10px 16px 0' }}>
              <BuiltinGallery items={builtinAbil2} type="abilities" label="Eingebaute Abilities (Tower-Pfade)"
                onCopy={item=>setEditor({type:'abilities',item:{...item,id:null,name:item.name+' (Kopie)'}})} />
            </div>
            {renderItems(abilities,'abilities')}
          </>}
        </>
      )}
      {editor?.type==='buildings'&&<BuildingEditor building={editor.item} onSave={()=>{setEditor(null);load();}} onClose={()=>setEditor(null)} />}
      {editor?.type==='units'    &&<UnitEditor unit={editor.item}         onSave={()=>{setEditor(null);load();}} onClose={()=>setEditor(null)} />}
      {editor?.type==='races'    &&<RaceEditor race={editor.item}         onSave={()=>{setEditor(null);load();}} onClose={()=>setEditor(null)} />}
      {editor?.type==='abilities'&&<AbilityEditor ability={editor.item}   onSave={()=>{setEditor(null);load();}} onClose={()=>setEditor(null)} />}
      {editor?.type==='wave-sets'&&<WaveSetEditor waveSet={editor.item} onSave={()=>{setEditor(null);load();}} onClose={()=>setEditor(null)} />}
    </div>
  );
}
