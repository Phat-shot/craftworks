import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../App';

// ── Shared helpers ─────────────────────────────────────────────
const BUILTIN_MAPS = [
  { id:'builtin_td_default', title:'Grünes Tal',   game_mode:'td',          icon:'🌿' },
  { id:'builtin_td_desert',  title:'Wüstenpfad',   game_mode:'td',          icon:'🏜️' },
  { id:'builtin_vs_arena',   title:'Zentralarena', game_mode:'vs',          icon:'⚔️' },
  { id:'builtin_ta_spiral',  title:'Spirale',      game_mode:'time_attack', icon:'🌀' },
];

// ── Image upload component ─────────────────────────────────────
function ImageUpload({ brandId, onUploaded, label, current, assetType='image' }) {
  const [uploading, setUploading] = useState(false);
  const ref = useRef();

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('asset_type', assetType);
    try {
      const { data } = await api.post(`/brands/${brandId}/upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUploaded(data.url);
    } catch {}
    setUploading(false);
    e.target.value = '';
  };

  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      {current && (
        <img src={current} alt="asset" style={{ width:36, height:36, borderRadius:4, objectFit:'cover', border:'1px solid var(--border2)' }} />
      )}
      <div style={{ flex:1 }}>
        <div style={{ fontSize:10, color:'var(--text3)', marginBottom:3 }}>{label}</div>
        <input className="input" value={current||''} onChange={e=>onUploaded(e.target.value)} placeholder="URL oder Bild hochladen" style={{ fontSize:10 }} />
      </div>
      <button className="btn btn-ghost btn-sm" disabled={uploading} onClick={()=>ref.current?.click()}>
        {uploading ? '⏳' : '📁 Upload'}
      </button>
      <input ref={ref} type="file" accept="image/*" style={{ display:'none' }} onChange={upload} />
    </div>
  );
}

// ── Prize Editor ───────────────────────────────────────────────
function PrizeEditor({ prizes, onChange }) {
  const add = () => onChange([...prizes, { rank: prizes.length + 1, description: '', count: 1 }]);
  return (
    <div>
      {prizes.map((p, i) => (
        <div key={i} style={{ display:'flex', gap:6, marginBottom:6, alignItems:'center' }}>
          <div style={{ fontSize:18, minWidth:28 }}>{i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`}</div>
          <input className="input" value={p.description} placeholder="Preis beschreiben"
            onChange={e => onChange(prizes.map((x,j)=>j===i?{...x,description:e.target.value}:x))}
            style={{ flex:1 }} />
          <input className="input" type="number" min="1" max="100" value={p.count}
            onChange={e => onChange(prizes.map((x,j)=>j===i?{...x,count:+e.target.value}:x))}
            style={{ width:60 }} title="Anzahl" />
          <button onClick={()=>onChange(prizes.filter((_,j)=>j!==i))}
            style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:16 }}>✕</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={add}>+ Preis hinzufügen</button>
    </div>
  );
}

// ── Brand Map Editor ───────────────────────────────────────────
function BrandMapEditor({ brand, brandMap, onSave, onClose }) {
  const isNew = !brandMap?.id;
  const [form, setForm] = useState({
    name: brandMap?.name || '',
    parent_map_id: brandMap?.parent_map_id || '',
    bg_texture_url: brandMap?.bg_texture_url || '',
    path_texture_url: brandMap?.path_texture_url || '',
    logo_overlay_url: brandMap?.logo_overlay_url || '',
    primary_color: brandMap?.primary_color || brand.primary_color,
    start_icon: brandMap?.start_icon || '',
    goal_icon: brandMap?.goal_icon || '',
    label_gold: brandMap?.label_gold || '',
    label_score: brandMap?.label_score || '',
    label_lives: brandMap?.label_lives || '',
    icon_gold: brandMap?.icon_gold || '',
    icon_score: brandMap?.icon_score || '',
    icon_lives: brandMap?.icon_lives || '',
    building_skins: brandMap?.building_skins || {},
    unit_skins: brandMap?.unit_skins || {},
    ability_skins: brandMap?.ability_skins || {},
  });
  const [tab, setTab] = useState('visual');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [parentData, setParentData] = useState(null);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  useEffect(() => {
    if (!form.parent_map_id) return;
    const builtin = BUILTIN_MAPS.find(m=>m.id===form.parent_map_id);
    if (builtin) { setParentData(builtin); return; }
    api.get(`/workshop/maps/${form.parent_map_id}`).then(r=>setParentData(r.data)).catch(()=>{});
  }, [form.parent_map_id]);

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true); setSaveErr('');
    try {
      const r = isNew
        ? await api.post(`/brands/${brand.id}/maps`, form)
        : await api.put(`/brands/${brand.id}/maps/${brandMap.id}`, form);
      onSave(r.data);
    } catch(e) { setSaveErr(e.response?.data?.error || 'Fehler'); }
    setSaving(false);
  };

  const tabBtn = (k,l) => (
    <button onClick={()=>setTab(k)} style={{ padding:'7px 12px', border:'none', background:'none', cursor:'pointer',
      fontFamily:'Cinzel,serif', fontSize:10, fontWeight:700,
      color:tab===k?'var(--gold)':'var(--text3)',
      borderBottom:tab===k?'2px solid var(--gold)':'2px solid transparent' }}>{l}</button>
  );

  const SkinRow = ({ id, current={}, onChange, type='building' }) => (
    <div style={{ background:'var(--bg2)', borderRadius:6, padding:'8px 10px', marginBottom:6 }}>
      <div style={{ fontSize:10, fontWeight:700, color:'var(--text2)', marginBottom:6 }}>{id}</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
        {[['name','Name'],['description','Beschreibung'],['icon','Icon (Emoji)'],['color','Farbe']].map(([k,l])=>(
          <div key={k}>
            <label style={{ fontSize:9, color:'var(--text3)' }}>{l}</label>
            <input className="input" value={current[k]||''} onChange={e=>onChange({...current,[k]:e.target.value})}
              placeholder={`${l} (leer=Standard)`} style={{ fontSize:10 }} />
          </div>
        ))}
        <div style={{ gridColumn:'1/-1' }}>
          <label style={{ fontSize:9, color:'var(--text3)' }}>Icon-Bild URL</label>
          <ImageUpload brandId={brand.id} label="" current={current.icon_url||''}
            onUploaded={u=>onChange({...current,icon_url:u})} assetType="icon" />
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.8)',backdropFilter:'blur(4px)',zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }} onClick={onClose}>
      <div style={{ background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:12,width:'100%',maxWidth:620,maxHeight:'94vh',overflow:'hidden',display:'flex',flexDirection:'column' }} onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'12px 16px',borderBottom:'1px solid var(--border2)',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div style={{ fontWeight:900,fontSize:15,color:'var(--gold)' }}>{isNew?'+ Brand Map':'✏️ Brand Map'}</div>
          <span onClick={onClose} style={{ cursor:'pointer',color:'var(--text3)',fontSize:20 }}>✕</span>
        </div>
        <div style={{ display:'flex', borderBottom:'1px solid var(--border2)' }}>
          {tabBtn('visual','🎨 Visuals')}
          {tabBtn('labels','🏷️ Labels')}
          {tabBtn('skins', '🔧 Skins')}
        </div>
        <div style={{ flex:1, overflow:'auto', padding:'12px 16px' }}>
          {tab==='visual'&&<>
            <div style={{ marginBottom:10 }}>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Map Name *</label>
              <input className="input" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Brand Map Name" />
            </div>
            <div style={{ marginBottom:10 }}>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Basis-Map</label>
              <select className="input" value={form.parent_map_id} onChange={e=>set('parent_map_id',e.target.value)}>
                <option value="">— Wähle Basis-Map —</option>
                <optgroup label="Eingebaut">
                  {BUILTIN_MAPS.map(m=><option key={m.id} value={m.id}>{m.icon} {m.title} ({m.game_mode})</option>)}
                </optgroup>
              </select>
              {parentData && <div style={{ fontSize:9,color:'var(--text3)',marginTop:3 }}>Basis: {parentData.title||parentData.name} — Texturen/Einstellungen werden als Fallback verwendet</div>}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
              <div>
                <label style={{ fontSize:10,color:'var(--text3)' }}>Primärfarbe</label>
                <div style={{ display:'flex', gap:6 }}>
                  <input type="color" value={form.primary_color} onChange={e=>set('primary_color',e.target.value)}
                    style={{ width:40,height:36,border:'none',background:'none',cursor:'pointer' }} />
                  <input className="input" value={form.primary_color} onChange={e=>set('primary_color',e.target.value)} />
                </div>
              </div>
              <div>
                <label style={{ fontSize:10,color:'var(--text3)' }}>Start-Icon</label>
                <input className="input" value={form.start_icon} onChange={e=>set('start_icon',e.target.value)} placeholder="▼ (leer=Standard)" />
              </div>
              <div>
                <label style={{ fontSize:10,color:'var(--text3)' }}>Ziel-Icon</label>
                <input className="input" value={form.goal_icon} onChange={e=>set('goal_icon',e.target.value)} placeholder="🏰 (leer=Standard)" />
              </div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <ImageUpload brandId={brand.id} label="Hintergrund-Textur" current={form.bg_texture_url} onUploaded={u=>set('bg_texture_url',u)} assetType="texture" />
              <ImageUpload brandId={brand.id} label="Pfad-Textur" current={form.path_texture_url} onUploaded={u=>set('path_texture_url',u)} assetType="texture" />
              <ImageUpload brandId={brand.id} label="Logo-Overlay (auf Karte)" current={form.logo_overlay_url} onUploaded={u=>set('logo_overlay_url',u)} assetType="logo" />
            </div>
          </>}

          {tab==='labels'&&(
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              <div style={{ gridColumn:'1/-1', fontSize:11, color:'var(--text3)', marginBottom:4 }}>
                Labels überschreiben die Standard-Spieltexte. Leer lassen = Standardwert.
              </div>
              {[
                ['label_gold','icon_gold','Gold-Label','💰','z.B. "Kronjuwelen"'],
                ['label_score','icon_score','Score-Label','🏆','z.B. "Sterne"'],
                ['label_lives','icon_lives','Leben-Label','❤️','z.B. "Energie"'],
              ].map(([lk,ik,l,defIcon,ph])=>(
                <React.Fragment key={lk}>
                  <div style={{ gridColumn:'1/3' }}>
                    <label style={{ fontSize:10,color:'var(--text3)' }}>{l}</label>
                    <input className="input" value={form[lk]} onChange={e=>set(lk,e.target.value)} placeholder={ph} />
                  </div>
                  <div>
                    <label style={{ fontSize:10,color:'var(--text3)' }}>Icon</label>
                    <input className="input" value={form[ik]} onChange={e=>set(ik,e.target.value)} placeholder={defIcon} />
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}

          {tab==='skins'&&(
            <div>
              <div style={{ fontSize:11,color:'var(--text3)',marginBottom:10,lineHeight:1.5 }}>
                Überschreibe Name, Beschreibung, Icon oder Farbe einzelner Gebäude/Einheiten.<br/>
                Mechanik bleibt erhalten — nur die Darstellung ändert sich.
              </div>
              <div style={{ fontSize:11,fontWeight:700,color:'var(--text2)',marginBottom:8 }}>🏰 Gebäude</div>
              {['dart','poison','splash','frost','lightning','fleischwolf','wurfspeer','kriegstrommel'].map(id=>(
                <SkinRow key={id} id={id} current={form.building_skins[id]||{}}
                  onChange={v=>set('building_skins',{...form.building_skins,[id]:v})} type="building" />
              ))}
              <div style={{ fontSize:11,fontWeight:700,color:'var(--text2)',margin:'12px 0 8px' }}>👾 Einheiten</div>
              {['basic','fast','armored','healer','air_light','air_heavy','boss'].map(id=>(
                <SkinRow key={id} id={id} current={form.unit_skins[id]||{}}
                  onChange={v=>set('unit_skins',{...form.unit_skins,[id]:v})} type="unit" />
              ))}
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

// ── Challenge Editor ───────────────────────────────────────────
function ChallengeEditor({ brand, challenge, brandMaps, onSave, onClose }) {
  const isNew = !challenge?.id;
  const now = new Date();
  const fmtDate = (d) => d ? new Date(d).toISOString().slice(0,16) : '';
  const [form, setForm] = useState({
    brand_map_id: challenge?.brand_map_id || '',
    title: challenge?.title || '',
    description: challenge?.description || '',
    start_at: fmtDate(challenge?.start_at || now),
    end_at: fmtDate(challenge?.end_at || new Date(now.getTime()+7*86400000)),
    prizes: challenge?.prizes || [{ rank:1, description:'', count:1 }],
    top_winners: challenge?.top_winners ?? 3,
    lottery_count: challenge?.lottery_count ?? 0,
    score_metric: challenge?.score_metric || 'score',
    max_entries_per_user: challenge?.max_entries_per_user ?? 3,
    require_email: challenge?.require_email ?? true,
    newsletter_opt_in_text: challenge?.newsletter_opt_in_text || 'Ich möchte den Newsletter des Veranstalters erhalten.',
    is_active: challenge?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [saved, setSaved] = useState(null);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true); setSaveErr('');
    try {
      const r = isNew
        ? await api.post(`/brands/${brand.id}/challenges`, form)
        : await api.put(`/brands/${brand.id}/challenges/${challenge.id}`, form);
      setSaved(r.data);
      onSave(r.data);
    } catch(e) { setSaveErr(e.response?.data?.error||'Fehler'); }
    setSaving(false);
  };

  const copyLink = () => {
    const link = `${window.location.origin}/challenge/${saved?.share_token||challenge?.share_token}`;
    navigator.clipboard.writeText(link).then(()=>alert('Link kopiert!')).catch(()=>{});
  };

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.8)',backdropFilter:'blur(4px)',zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }} onClick={onClose}>
      <div style={{ background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:12,width:'100%',maxWidth:580,maxHeight:'94vh',overflow:'hidden',display:'flex',flexDirection:'column' }} onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'12px 16px',borderBottom:'1px solid var(--border2)',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div style={{ fontWeight:900,fontSize:15,color:'var(--gold)' }}>{isNew?'+ Challenge':'✏️ Challenge'}</div>
          <span onClick={onClose} style={{ cursor:'pointer',color:'var(--text3)',fontSize:20 }}>✕</span>
        </div>
        <div style={{ flex:1,overflow:'auto',padding:'12px 16px',display:'flex',flexDirection:'column',gap:10 }}>
          <div>
            <label style={{ fontSize:10,color:'var(--text3)' }}>Brand Map *</label>
            <select className="input" value={form.brand_map_id} onChange={e=>set('brand_map_id',e.target.value)}>
              <option value="">— Wähle Brand Map —</option>
              {brandMaps.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:10,color:'var(--text3)' }}>Titel *</label>
            <input className="input" value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Challenge-Titel" />
          </div>
          <div>
            <label style={{ fontSize:10,color:'var(--text3)' }}>Beschreibung</label>
            <textarea className="input" value={form.description} onChange={e=>set('description',e.target.value)}
              placeholder="Beschreibung für Teilnehmer" rows={2} style={{ resize:'vertical' }} />
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Start</label>
              <input className="input" type="datetime-local" value={form.start_at} onChange={e=>set('start_at',e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Ende</label>
              <input className="input" type="datetime-local" value={form.end_at} onChange={e=>set('end_at',e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Score-Metrik</label>
              <select className="input" value={form.score_metric} onChange={e=>set('score_metric',e.target.value)}>
                <option value="score">Punkte</option>
                <option value="wave">Wave</option>
                <option value="time">Zeit (Time Attack)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Max. Einträge/Nutzer</label>
              <input className="input" type="number" min="1" max="100" value={form.max_entries_per_user} onChange={e=>set('max_entries_per_user',+e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Top-Gewinner (direkt)</label>
              <input className="input" type="number" min="0" value={form.top_winners} onChange={e=>set('top_winners',+e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Verlosungs-Gewinne</label>
              <input className="input" type="number" min="0" value={form.lottery_count} onChange={e=>set('lottery_count',+e.target.value)} />
            </div>
          </div>

          <div>
            <label style={{ fontSize:11,fontWeight:700,color:'var(--text2)',display:'block',marginBottom:6 }}>🎁 Preise</label>
            <PrizeEditor prizes={form.prizes} onChange={p=>set('prizes',p)} />
          </div>

          <div style={{ borderTop:'1px solid var(--border2)',paddingTop:10 }}>
            <label style={{ fontSize:11,fontWeight:700,color:'var(--text2)',display:'block',marginBottom:6 }}>📧 Lead-Capture (DSGVO)</label>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:8 }}>
              <input type="checkbox" id="req_email" checked={form.require_email} onChange={e=>set('require_email',e.target.checked)} />
              <label htmlFor="req_email" style={{ fontSize:12 }}>E-Mail-Adresse erforderlich</label>
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Newsletter-Opt-in Text (leer = kein Haken)</label>
              <input className="input" value={form.newsletter_opt_in_text||''} onChange={e=>set('newsletter_opt_in_text',e.target.value)}
                placeholder="Ich möchte den Newsletter erhalten." />
            </div>
            <div style={{ fontSize:9,color:'var(--text3)',marginTop:4,lineHeight:1.5,padding:'6px 8px',background:'rgba(255,200,60,.06)',borderRadius:4,border:'1px solid rgba(255,200,60,.15)' }}>
              ⚖️ Hinweis: Die erhobenen Daten (E-Mail, Score, Teilnahme-Zeitpunkt, IP-Hash) werden DSGVO-konform gespeichert. 
              Double-Opt-In für Newsletter bitte extern sicherstellen. Die Daten sind nur für Brand-Admins einsehbar.
            </div>
          </div>

          {/* QR Code + Link (after save) */}
          {(saved || challenge) && (
            <div style={{ borderTop:'1px solid var(--border2)',paddingTop:10 }}>
              <label style={{ fontSize:11,fontWeight:700,color:'var(--text2)',display:'block',marginBottom:8 }}>🔗 Challenge-Link & QR-Code</label>
              <div style={{ display:'flex',gap:10,alignItems:'flex-start' }}>
                {(saved||challenge)?.qr_code_url && (
                  <img src={(saved||challenge).qr_code_url} alt="QR" style={{ width:80,height:80,borderRadius:4,border:'1px solid var(--border2)' }} />
                )}
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:10,color:'var(--text3)',marginBottom:4 }}>Teilen via Link oder QR-Code:</div>
                  <div style={{ fontSize:10,background:'var(--bg2)',padding:'6px 8px',borderRadius:4,fontFamily:'monospace',wordBreak:'break-all',marginBottom:6 }}>
                    {`${window.location.origin}/challenge/${(saved||challenge).share_token}`}
                  </div>
                  <div style={{ display:'flex',gap:6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={copyLink}>📋 Link kopieren</button>
                    {(saved||challenge)?.qr_code_url && (
                      <a href={(saved||challenge).qr_code_url} download="challenge-qr.png" className="btn btn-ghost btn-sm">⬇️ QR speichern</a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div style={{ padding:'10px 16px',borderTop:'1px solid var(--border2)',display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap' }}>
          {saveErr&&<div style={{ width:'100%',fontSize:11,color:'var(--red)' }}>⚠️ {saveErr}</div>}
          <button className="btn btn-ghost" onClick={onClose}>Schließen</button>
          <button className="btn btn-primary" onClick={save} disabled={!form.title.trim()||!form.brand_map_id||saving}>
            {saving?'⏳':'💾'} Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Brand Detail Page (Maps + Challenges) ─────────────────────
function BrandDetail({ brand, onBack }) {
  const [tab, setTab]         = useState('maps');
  const [brandMaps, setBrandMaps]   = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [editor, setEditor]   = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [mr, cr] = await Promise.all([
      api.get(`/brands/${brand.id}/maps`).catch(()=>({data:[]})),
      api.get(`/brands/${brand.id}/challenges`).catch(()=>({data:[]})),
    ]);
    setBrandMaps(Array.isArray(mr.data)?mr.data:[]);
    setChallenges(Array.isArray(cr.data)?cr.data:[]);
    setLoading(false);
  }, [brand.id]);

  useEffect(()=>{ load(); },[load]);

  const tabBtn = (k,l) => (
    <button onClick={()=>setTab(k)} style={{ padding:'8px 14px',border:'none',background:'none',cursor:'pointer',
      fontFamily:'Cinzel,serif',fontWeight:700,fontSize:11,
      color:tab===k?'var(--gold)':'var(--text3)',
      borderBottom:tab===k?'2px solid var(--gold)':'2px solid transparent' }}>{l}</button>
  );

  const now = new Date();
  const chStatus = (ch) => now < new Date(ch.start_at)?'upcoming':now>new Date(ch.end_at)?'ended':'active';
  const chColor  = (s)  => ({upcoming:'#8080ff',active:'#40e060',ended:'#806040'}[s]||'#888');

  return (
    <div style={{ height:'100%',overflow:'auto' }}>
      <div className="page-header" style={{ gap:8 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Zurück</button>
        {brand.logo_url && <img src={brand.logo_url} alt="logo" style={{ height:28,borderRadius:4 }} />}
        <span className="page-title" style={{ color:brand.primary_color }}>{brand.name}</span>
        <div style={{ marginLeft:'auto',display:'flex',gap:6 }}>
          <button className="btn btn-primary btn-sm"
            onClick={()=>setEditor(tab==='maps'?{type:'map',item:null}:{type:'challenge',item:null})}>
            + {tab==='maps'?'Brand Map':'Challenge'}
          </button>
        </div>
      </div>

      <div style={{ display:'flex',borderBottom:'1px solid var(--border2)',paddingLeft:16 }}>
        {tabBtn('maps','🗺️ Brand Maps')}
        {tabBtn('challenges','🏆 Challenges')}
      </div>

      {loading ? <div className="loading-screen">⏳</div> : <>
        {tab==='maps'&&(
          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:10,padding:'14px 16px' }}>
            {brandMaps.map(m=>(
              <div key={m.id} style={{ background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:8,padding:12 }}>
                <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:6 }}>
                  {m.logo_overlay_url
                    ? <img src={m.logo_overlay_url} style={{ width:32,height:32,borderRadius:4,objectFit:'cover' }} alt="logo" />
                    : <span style={{ fontSize:22 }}>🗺️</span>}
                  <div>
                    <div style={{ fontWeight:700,fontSize:12,color:'var(--text)' }}>{m.name}</div>
                    <div style={{ fontSize:9,color:'var(--text3)' }}>Basis: {m.parent_map_id||'—'}</div>
                  </div>
                </div>
                <div style={{ display:'flex',gap:5,marginTop:6 }}>
                  <button className="btn btn-ghost btn-sm" style={{ flex:1 }} onClick={()=>setEditor({type:'map',item:m})}>✏️ Bearbeiten</button>
                </div>
              </div>
            ))}
            {brandMaps.length===0&&<div className="empty-state" style={{ gridColumn:'1/-1' }}><div className="empty-icon">🗺️</div>Noch keine Brand Maps</div>}
          </div>
        )}
        {tab==='challenges'&&(
          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:10,padding:'14px 16px' }}>
            {challenges.map(ch=>{
              const s=chStatus(ch);
              return (
                <div key={ch.id} style={{ background:'var(--bg2)',border:`1px solid ${chColor(s)}44`,borderRadius:8,padding:12 }}>
                  <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:5 }}>
                    <div style={{ fontWeight:700,fontSize:12,color:'var(--text)',flex:1,lineHeight:1.3 }}>{ch.title}</div>
                    <span style={{ fontSize:9,padding:'2px 6px',borderRadius:8,background:`${chColor(s)}22`,color:chColor(s),border:`1px solid ${chColor(s)}55`,flexShrink:0,marginLeft:6 }}>
                      {s==='upcoming'?'Geplant':s==='active'?'⚡ Aktiv':'Beendet'}
                    </span>
                  </div>
                  <div style={{ fontSize:9,color:'var(--text3)',marginBottom:6 }}>
                    {new Date(ch.start_at).toLocaleDateString('de-DE')} – {new Date(ch.end_at).toLocaleDateString('de-DE')}
                  </div>
                  {ch.prizes?.length>0&&<div style={{ fontSize:9,color:'var(--gold)',marginBottom:6 }}>
                    🎁 {ch.prizes.length} Preis{ch.prizes.length>1?'e':''}
                    {ch.lottery_count>0?` + ${ch.lottery_count}× Verlosung`:''}
                  </div>}
                  <div style={{ display:'flex',gap:5 }}>
                    <button className="btn btn-ghost btn-sm" style={{ flex:1 }} onClick={()=>setEditor({type:'challenge',item:ch})}>✏️</button>
                    <button className="btn btn-ghost btn-sm" onClick={()=>{
                      const link=`${window.location.origin}/challenge/${ch.share_token}`;
                      navigator.clipboard.writeText(link).then(()=>alert('Link kopiert!')).catch(()=>{});
                    }}>🔗</button>
                    {ch.qr_code_url&&<a href={ch.qr_code_url} download className="btn btn-ghost btn-sm">QR</a>}
                  </div>
                </div>
              );
            })}
            {challenges.length===0&&<div className="empty-state" style={{ gridColumn:'1/-1' }}><div className="empty-icon">🏆</div>Noch keine Challenges</div>}
          </div>
        )}
      </>}

      {editor?.type==='map'&&<BrandMapEditor brand={brand} brandMap={editor.item} onSave={()=>{setEditor(null);load();}} onClose={()=>setEditor(null)} />}
      {editor?.type==='challenge'&&<ChallengeEditor brand={brand} challenge={editor.item} brandMaps={brandMaps} onSave={()=>{setEditor(null);load();}} onClose={()=>setEditor(null)} />}
    </div>
  );
}

// ── Create Brand Modal ─────────────────────────────────────────
function CreateBrandModal({ onSave, onClose }) {
  const [form, setForm] = useState({ name:'', slug:'', primary_color:'#3060c0', secondary_color:'#e0a020', website_url:'', contact_email:'' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const save = async () => {
    if (!form.name.trim() || !form.slug.trim()) return;
    setSaving(true); setErr('');
    try {
      const { data } = await api.post('/brands', form);
      onSave(data);
    } catch(e) { setErr(e.response?.data?.error==='slug_taken'?'Slug bereits vergeben':e.response?.data?.error||'Fehler'); }
    setSaving(false);
  };

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.75)',backdropFilter:'blur(4px)',zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }} onClick={onClose}>
      <div style={{ background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:12,width:'100%',maxWidth:420,overflow:'hidden' }} onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'12px 16px',borderBottom:'1px solid var(--border2)',fontWeight:900,fontSize:15,color:'var(--gold)' }}>+ Brand anlegen</div>
        <div style={{ padding:'14px 16px',display:'flex',flexDirection:'column',gap:10 }}>
          <div>
            <label style={{ fontSize:10,color:'var(--text3)' }}>Brand-Name *</label>
            <input className="input" value={form.name} onChange={e=>{ set('name',e.target.value); set('slug',e.target.value.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')); }} placeholder="Meine Firma GmbH" />
          </div>
          <div>
            <label style={{ fontSize:10,color:'var(--text3)' }}>Slug (URL-ID) *</label>
            <input className="input" value={form.slug} onChange={e=>set('slug',e.target.value.toLowerCase())} placeholder="meine-firma" />
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
            {[['primary_color','Primärfarbe'],['secondary_color','Sekundärfarbe']].map(([k,l])=>(
              <div key={k}>
                <label style={{ fontSize:10,color:'var(--text3)' }}>{l}</label>
                <div style={{ display:'flex',gap:6 }}>
                  <input type="color" value={form[k]} onChange={e=>set(k,e.target.value)} style={{ width:36,height:34,border:'none',background:'none',cursor:'pointer' }} />
                  <input className="input" value={form[k]} onChange={e=>set(k,e.target.value)} />
                </div>
              </div>
            ))}
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Website</label>
              <input className="input" value={form.website_url} onChange={e=>set('website_url',e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>Kontakt-Email</label>
              <input className="input" value={form.contact_email} onChange={e=>set('contact_email',e.target.value)} placeholder="admin@firma.de" />
            </div>
          </div>
        </div>
        <div style={{ padding:'10px 16px',borderTop:'1px solid var(--border2)',display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap' }}>
          {err&&<div style={{ width:'100%',fontSize:11,color:'var(--red)' }}>⚠️ {err}</div>}
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()||!form.slug.trim()||saving}>
            {saving?'⏳':'✓'} Anlegen
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Brands Page ───────────────────────────────────────────
export default function Brands() {
  const [brands, setBrands]       = useState([]);
  const [selected, setSelected]   = useState(null);
  const [creating, setCreating]   = useState(false);
  const [loading, setLoading]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    api.get('/brands').then(r=>setBrands(Array.isArray(r.data)?r.data:[])).catch(()=>{});
    setLoading(false);
  }, []);

  useEffect(()=>{ load(); },[load]);

  if (selected) return <BrandDetail brand={selected} onBack={()=>{setSelected(null);load();}} />;

  return (
    <div style={{ height:'100%',overflow:'auto' }}>
      <div className="page-header">
        <span className="page-title">🏢 Brands</span>
        <button className="btn btn-primary btn-sm" onClick={()=>setCreating(true)}>+ Brand anlegen</button>
      </div>
      {loading ? <div className="loading-screen">⏳</div> : (
        <div style={{ padding:'14px 16px' }}>
          {brands.length===0 ? (
            <div className="empty-state">
              <div className="empty-icon">🏢</div>
              Du gehörst noch keinem Brand an. Lege einen neuen Brand an oder wende dich an deinen Administrator.
            </div>
          ) : (
            <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:12 }}>
              {brands.map(b=>(
                <div key={b.id} onClick={()=>setSelected(b)} style={{
                  background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:10,padding:16,cursor:'pointer',
                  transition:'border-color .15s',
                }} onMouseEnter={e=>e.currentTarget.style.borderColor=b.primary_color}
                   onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border2)'}>
                  <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:8 }}>
                    {b.logo_url
                      ? <img src={b.logo_url} alt="" style={{ width:40,height:40,borderRadius:6,objectFit:'cover' }} />
                      : <div style={{ width:40,height:40,borderRadius:6,background:`${b.primary_color}33`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20 }}>🏢</div>}
                    <div>
                      <div style={{ fontWeight:900,fontSize:14,color:b.primary_color }}>{b.name}</div>
                      <div style={{ fontSize:9,color:'var(--text3)' }}>{b.role === 'admin'?'👑 Admin':'👁️ Viewer'}</div>
                    </div>
                  </div>
                  {b.website_url&&<div style={{ fontSize:9,color:'var(--text3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{b.website_url}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {creating&&<CreateBrandModal onSave={()=>{setCreating(false);load();}} onClose={()=>setCreating(false)} />}
    </div>
  );
}
