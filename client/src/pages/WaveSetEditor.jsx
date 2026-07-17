import React, { useState } from 'react';
import { api } from '../api';

const WAVE_TYPES  = ['basic','fast','armored','healer','air_light','air_heavy','boss'];
const TYPE_ICONS  = {basic:'🔴',fast:'🟡',armored:'🔵',healer:'🟢',air_light:'🦅',air_heavy:'🐉',boss:'👑'};
const TYPE_NAMES  = {basic:'Läufer',fast:'Renner',armored:'Gepanzert',healer:'Heiler',air_light:'Gryphon',air_heavy:'Drache',boss:'Boss'};
const SPAWN_TYPES = ['snake','group','parallel','random'];
const SPAWN_ICONS = {snake:'🐍',group:'👥',parallel:'⚡',random:'🎲'};
const SPAWN_DESC  = {
  snake:    'Einer nach dem anderen — enger Zug',
  group:    'Gruppen gleichzeitig — Pausen dazwischen',
  parallel: 'Alle auf einmal erscheinen',
  random:   'Zufällige Abstände',
};

const DEFAULT_TYPES = ['basic','fast','armored','healer','air_light','basic','fast','armored',
  'healer','boss','armored','healer','basic','fast','air_heavy','healer','basic','fast',
  'armored','boss','basic','fast','armored','healer','boss'];

function mkWave(i, defaultSpawn='snake') {
  return { wave:i+1, type:DEFAULT_TYPES[i]||'basic', count:null, hpMult:null, disabled:false, spawn:null };
}

// ── Standard mode config ───────────────────────────────────────
function StandardConfig({ config, onChange }) {
  const c = config || {};
  const set = (k,v) => onChange({...c,[k]:v});
  const rules = c.special_rules || [];
  const addRule = () => onChange({...c, special_rules:[...rules,{every:5,type:'boss'}]});
  const updRule = (i,rule) => onChange({...c, special_rules:rules.map((r,j)=>j===i?rule:r)});
  const delRule = (i) => onChange({...c, special_rules:rules.filter((_,j)=>j!==i)});

  return (
    <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
        <div>
          <label style={{ fontSize:10,color:'var(--text3)' }}>Basis-Gegnertyp</label>
          <select className="input" value={c.base_type||'basic'} onChange={e=>set('base_type',e.target.value)}>
            {WAVE_TYPES.filter(t=>t!=='boss').map(t=>(
              <option key={t} value={t}>{TYPE_ICONS[t]} {TYPE_NAMES[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize:10,color:'var(--text3)' }}>HP-Wachstum pro Wave</label>
          <div style={{ display:'flex',alignItems:'center',gap:6 }}>
            <input className="input" type="number" min="1.0" max="2.0" step="0.01"
              value={c.hp_factor||1.15} onChange={e=>set('hp_factor',+e.target.value)} />
            <span style={{ fontSize:10,color:'var(--text3)',flexShrink:0 }}>×/Wave</span>
          </div>
        </div>
        <div>
          <label style={{ fontSize:10,color:'var(--text3)' }}>Startanzahl (Wave 1)</label>
          <input className="input" type="number" min="1" max="50" value={c.count_start||6} onChange={e=>set('count_start',+e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize:10,color:'var(--text3)' }}>Zuwachs pro Wave</label>
          <input className="input" type="number" min="0" max="10" step="0.5" value={c.count_per_wave||1.5} onChange={e=>set('count_per_wave',+e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize:10,color:'var(--text3)' }}>Boss alle X Waves</label>
          <input className="input" type="number" min="2" max="25" value={c.boss_interval||10} onChange={e=>set('boss_interval',+e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize:10,color:'var(--text3)' }}>Spawn-Intervall (ms)</label>
          <input className="input" type="number" min="100" max="3000" step="50" value={c.spawn_interval||800} onChange={e=>set('spawn_interval',+e.target.value)} />
        </div>
      </div>

      {/* Special rules */}
      <div>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6 }}>
          <div style={{ fontSize:11,fontWeight:700,color:'var(--text2)' }}>Sonderregeln</div>
          <button className="btn btn-ghost btn-sm" onClick={addRule}>+ Regel</button>
        </div>
        {rules.map((rule,i)=>(
          <div key={i} style={{ display:'flex',gap:6,alignItems:'center',marginBottom:5,background:'var(--bg2)',borderRadius:6,padding:'6px 8px' }}>
            <select className="input" value={rule.type} onChange={e=>updRule(i,{...rule,type:e.target.value})} style={{ width:110 }}>
              {WAVE_TYPES.map(t=><option key={t} value={t}>{TYPE_ICONS[t]} {TYPE_NAMES[t]}</option>)}
            </select>
            {/* Trigger: every N or specific waves */}
            <select className="input" value={rule.waves?'waves':'every'} onChange={e=>{
              if(e.target.value==='every') updRule(i,{type:rule.type,every:5});
              else updRule(i,{type:rule.type,waves:[5,15]});
            }} style={{ width:90 }}>
              <option value="every">alle N</option>
              <option value="waves">Wellen</option>
            </select>
            {rule.waves ? (
              <input className="input" value={(rule.waves||[]).join(',')} style={{ flex:1 }}
                placeholder="5,10,15"
                onChange={e=>updRule(i,{...rule,waves:e.target.value.split(',').map(Number).filter(n=>n>0)})} />
            ) : (
              <div style={{ display:'flex',alignItems:'center',gap:4,flex:1 }}>
                <input className="input" type="number" min="1" max="25" value={rule.every||5}
                  onChange={e=>updRule(i,{...rule,every:+e.target.value})} />
                <span style={{ fontSize:10,color:'var(--text3)' }}>Waves</span>
              </div>
            )}
            <button onClick={()=>delRule(i)} style={{ background:'none',border:'none',color:'var(--red)',cursor:'pointer',fontSize:16 }}>✕</button>
          </div>
        ))}
        {rules.length===0&&<div style={{ fontSize:10,color:'var(--text3)',padding:'4px 0' }}>Keine Sonderregeln — nur Basis-Typ mit Scaling</div>}
      </div>
    </div>
  );
}

// ── Wave grid for full-custom / spawn override ─────────────────
function WaveGrid({ waves, waveCount, defaultSpawn, onUpdate, showSpawn }) {
  const [sel, setSel] = useState(null);
  const getWave = (i) => waves.find(w=>w.wave===i+1) || mkWave(i, defaultSpawn);
  const updateWave = (i, field, val) => {
    const existing = waves.find(w=>w.wave===i+1);
    if (existing) {
      onUpdate(waves.map(w=>w.wave===i+1?{...w,[field]:val}:w));
    } else {
      onUpdate([...waves, {...mkWave(i,defaultSpawn), wave:i+1, [field]:val}]);
    }
  };
  const selW = sel!==null ? getWave(sel) : null;

  return (
    <div>
      <div style={{ fontSize:10,color:'var(--text3)',marginBottom:5 }}>
        Klicke eine Wave zum Anpassen — Gelb = abweichend vom Standard:
      </div>
      <div style={{ display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:3,marginBottom:8 }}>
        {Array.from({length:waveCount},(_,i)=>{
          const w = getWave(i);
          const modified = w.count!==null||w.hpMult!==null||w.disabled||(w.type!==DEFAULT_TYPES[i])||w.spawn;
          return (
            <div key={i} onClick={()=>setSel(sel===i?null:i)} style={{
              background:w.disabled?'#1a0a06':modified?'rgba(240,200,60,.12)':'var(--bg2)',
              border:`1px solid ${sel===i?'var(--gold)':w.disabled?'#2a1206':'var(--border2)'}`,
              borderRadius:5,padding:'4px 2px',cursor:'pointer',textAlign:'center',opacity:w.disabled?.4:1,
            }}>
              <div style={{ fontSize:12 }}>{TYPE_ICONS[w.type]||'❓'}</div>
              <div style={{ fontSize:7,color:'var(--text3)',fontWeight:700 }}>W{w.wave}</div>
              {showSpawn&&<div style={{ fontSize:8 }}>{SPAWN_ICONS[w.spawn||defaultSpawn]}</div>}
            </div>
          );
        })}
      </div>

      {selW&&(
        <div style={{ background:'rgba(240,200,60,.06)',border:'1px solid rgba(240,200,60,.2)',borderRadius:8,padding:12 }}>
          <div style={{ fontWeight:700,color:'var(--gold)',fontSize:12,marginBottom:8 }}>
            Wave {selW.wave} — {TYPE_ICONS[selW.type]} {TYPE_NAMES[selW.type]||selW.type}
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Typ</label>
              <select className="input" value={selW.type} onChange={e=>updateWave(sel,'type',e.target.value)}>
                {WAVE_TYPES.map(t=><option key={t} value={t}>{TYPE_ICONS[t]} {TYPE_NAMES[t]}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Spawn-Typ</label>
              <select className="input" value={selW.spawn||''} onChange={e=>updateWave(sel,'spawn',e.target.value||null)}>
                <option value="">Standard ({SPAWN_ICONS[defaultSpawn]} {defaultSpawn})</option>
                {SPAWN_TYPES.map(s=><option key={s} value={s}>{SPAWN_ICONS[s]} {s}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Anzahl (leer=auto)</label>
              <input className="input" type="number" min="1" max="200" placeholder="Auto"
                value={selW.count??''} onChange={e=>updateWave(sel,'count',e.target.value?+e.target.value:null)} />
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>HP Multiplikator</label>
              <input className="input" type="number" min="0.1" max="20" step="0.1" placeholder="Auto"
                value={selW.hpMult??''} onChange={e=>updateWave(sel,'hpMult',e.target.value?+e.target.value:null)} />
            </div>
            <div style={{ display:'flex',alignItems:'center',gap:8,paddingTop:12 }}>
              <input type="checkbox" id="wdis" checked={selW.disabled||false}
                onChange={e=>updateWave(sel,'disabled',e.target.checked)} />
              <label htmlFor="wdis" style={{ fontSize:12 }}>Wave deaktivieren</label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main WaveSetEditor ─────────────────────────────────────────
export function WaveSetEditor({ waveSet, onSave, onClose }) {
  const isNew = !waveSet?.id;
  const [name,     setName]     = useState(waveSet?.name||'');
  const [desc,     setDesc]     = useState(waveSet?.description||'');
  const [isPublic, setPublic]   = useState(waveSet?.is_public||false);
  const [waveCount,setWaveCount]= useState(waveSet?.wave_count||25);
  const [mode,     setMode]     = useState(waveSet?.mode||'standard');
  const [defaultSpawn, setDefaultSpawn] = useState(waveSet?.default_spawn||'snake');
  const [stdConfig,setSdtConfig]= useState(waveSet?.standard||{
    base_type:'basic',hp_factor:1.15,count_start:6,count_per_wave:1.5,
    boss_interval:10,spawn_interval:800,special_rules:[
      {every:5, type:'air_light'},
      {every:10, type:'boss'},
      {waves:[15], type:'air_heavy'},
    ]
  });
  const [waves, setWaves]       = useState(waveSet?.waves||[]);
  const [saving, setSaving]     = useState(false);
  const [saveErr, setSaveErr]   = useState('');
  const [tab, setTab]           = useState('config');

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true); setSaveErr('');
    const payload = {
      name, description:desc, wave_count:waveCount, is_public:isPublic,
      mode, default_spawn:defaultSpawn, standard:stdConfig,
      waves: waves.filter(w=>w.count!==null||w.hpMult!==null||w.disabled||
        w.type!==DEFAULT_TYPES[w.wave-1]||w.spawn),
    };
    try {
      const r = isNew
        ? await api.post('/workshop/wave-sets', payload)
        : await api.put(`/workshop/wave-sets/${waveSet.id}`, payload);
      onSave(r.data);
    } catch(e) { setSaveErr(e.response?.data?.error||'Fehler beim Speichern'); }
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
      <div style={{ background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:12,width:'100%',maxWidth:640,maxHeight:'92vh',display:'flex',flexDirection:'column' }} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding:'12px 16px',borderBottom:'1px solid var(--border2)',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div style={{ fontWeight:900,fontSize:15,color:'var(--gold)' }}>{isNew?'+ Neues Wave-Set':'✏️ Wave-Set'}</div>
          <span onClick={onClose} style={{ cursor:'pointer',color:'var(--text3)',fontSize:20 }}>✕</span>
        </div>

        {/* Sub-tabs */}
        <div style={{ display:'flex',borderBottom:'1px solid var(--border2)' }}>
          {tabBtn('config','⚙️ Grundeinstellung')}
          {tabBtn('waves', mode==='full_custom'?'🌊 Waves':'🎯 Wave-Overrides')}
        </div>

        <div style={{ flex:1,overflow:'auto',padding:'12px 16px',display:'flex',flexDirection:'column',gap:10 }}>
          {tab==='config'&&<>
            {/* Name + count */}
            <div style={{ display:'grid',gridTemplateColumns:'1fr auto auto',gap:8,alignItems:'end' }}>
              <div>
                <label style={{ fontSize:10,color:'var(--text3)' }}>Name *</label>
                <input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="Wave-Set Name" />
              </div>
              <div>
                <label style={{ fontSize:10,color:'var(--text3)' }}>Waves</label>
                <select className="input" value={waveCount} onChange={e=>setWaveCount(+e.target.value)} style={{ width:70 }}>
                  {[10,15,20,25,30].map(n=><option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:10,color:'var(--text3)' }}>Öffentlich</label>
                <input type="checkbox" checked={isPublic} onChange={e=>setPublic(e.target.checked)} style={{ marginTop:10,width:36,height:36 }} />
              </div>
            </div>
            <input className="input" value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Beschreibung" />

            {/* Mode picker */}
            <div>
              <label style={{ fontSize:11,fontWeight:700,color:'var(--text2)',display:'block',marginBottom:8 }}>Modus</label>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
                {[['standard','📈 Standard','Ein Typ, der stärker wird. Sonderregeln für Boss/Luft etc.'],
                  ['full_custom','🎛️ Full Custom','Jede Wave einzeln konfigurieren']].map(([k,l,d])=>(
                  <div key={k} onClick={()=>setMode(k)} style={{
                    padding:'10px 12px',borderRadius:8,cursor:'pointer',
                    border:`2px solid ${mode===k?'var(--gold)':'var(--border2)'}`,
                    background:mode===k?'rgba(240,200,60,.1)':'var(--bg2)',
                  }}>
                    <div style={{ fontWeight:700,color:mode===k?'var(--gold)':'var(--text2)',fontSize:13 }}>{l}</div>
                    <div style={{ fontSize:10,color:'var(--text3)',marginTop:3,lineHeight:1.4 }}>{d}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Default spawn */}
            <div>
              <label style={{ fontSize:11,fontWeight:700,color:'var(--text2)',display:'block',marginBottom:8 }}>Standard Spawn-Typ</label>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:6 }}>
                {SPAWN_TYPES.map(s=>(
                  <div key={s} onClick={()=>setDefaultSpawn(s)} style={{
                    padding:'8px 10px',borderRadius:7,cursor:'pointer',
                    border:`2px solid ${defaultSpawn===s?'var(--gold)':'var(--border2)'}`,
                    background:defaultSpawn===s?'rgba(240,200,60,.1)':'var(--bg2)',
                    display:'flex',alignItems:'center',gap:8,
                  }}>
                    <span style={{ fontSize:20 }}>{SPAWN_ICONS[s]}</span>
                    <div>
                      <div style={{ fontWeight:700,color:defaultSpawn===s?'var(--gold)':'var(--text2)',fontSize:11 }}>{s}</div>
                      <div style={{ fontSize:9,color:'var(--text3)',lineHeight:1.3 }}>{SPAWN_DESC[s]}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Standard mode config */}
            {mode==='standard'&&(
              <div style={{ borderTop:'1px solid var(--border2)',paddingTop:10 }}>
                <div style={{ fontSize:11,fontWeight:700,color:'var(--text2)',marginBottom:8 }}>📈 Standard-Konfiguration</div>
                <StandardConfig config={stdConfig} onChange={setSdtConfig} />
              </div>
            )}
          </>}

          {tab==='waves'&&(
            <WaveGrid
              waves={waves} waveCount={waveCount}
              defaultSpawn={defaultSpawn}
              onUpdate={setWaves}
              showSpawn={true}
            />
          )}
        </div>

        <div style={{ padding:'10px 16px',borderTop:'1px solid var(--border2)',display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap' }}>
          {saveErr&&<div style={{ width:'100%',fontSize:11,color:'var(--red)' }}>⚠️ {saveErr}</div>}
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim()||saving}>
            {saving?'⏳':'💾'} Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
