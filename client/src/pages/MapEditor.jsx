import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

// ── Size presets ───────────────────────────────────────────────
const SIZE_PRESETS = {
  klein:  { label:'Klein',  cols:15, rows:20 },
  mittel: { label:'Mittel', cols:25, rows:35 },
  gross:  { label:'Groß',   cols:35, rows:50 },
  custom: { label:'Custom', cols:20, rows:28 },
};

const GAME_TYPES = [
  { key:'td',          label:'Tower Defense', icon:'🏰' },
  { key:'vs',          label:'VS',            icon:'⚔️' },
  { key:'time_attack', label:'Time Attack',   icon:'⏱️' },
  { key:'pve',         label:'PvE',           icon:'🤖', badge:'Beta' },
];

const ENTITIES = [
  { key:'passive',  label:'Passiv',    color:'#606060' },
  { key:'friendly', label:'Freundlich',color:'#40a040' },
  { key:'cpu',      label:'CPU',       color:'#a04040' },
  { key:'player_1', label:'Spieler 1', color:'#4080e0' },
  { key:'player_2', label:'Spieler 2', color:'#e08040' },
  { key:'player_3', label:'Spieler 3', color:'#c040c0' },
  { key:'player_4', label:'Spieler 4', color:'#40c0c0' },
];

// ── Tower palette (visual) ─────────────────────────────────────
const TOWERS = [
  {id:'dart',    icon:'🎯', name:'Dart',      cost:75},
  {id:'poison',  icon:'☠️', name:'Gift',      cost:80},
  {id:'splash',  icon:'💣', name:'Kanone',    cost:120},
  {id:'frost',   icon:'❄️', name:'Frost',     cost:160},
  {id:'lightning',icon:'⚡',name:'Blitz',     cost:200},
  {id:'wall',    icon:'🧱', name:'Mauer',     cost:0},
];
const UNITS = [
  {id:'basic',   icon:'🗡️', name:'Soldat'},
  {id:'fast',    icon:'💨', name:'Renner'},
  {id:'armored', icon:'🛡️', name:'Gepanzert'},
  {id:'healer',  icon:'💚', name:'Heiler'},
  {id:'boss',    icon:'👑', name:'Boss'},
];
const STRUCTURES = [
  {id:'main_building', icon:'🏰', name:'Hauptgebäude'},
  {id:'barracks',      icon:'🏗️', name:'Kaserne'},
  {id:'tower_struct',  icon:'🗼', name:'Turm'},
  {id:'wall_struct',   icon:'🧱', name:'Mauer'},
];
const SPECIAL = [
  {id:'spawn',    icon:'🚪', name:'Spawn'},
  {id:'exit',     icon:'🎯', name:'Ausgang'},
  {id:'waypoint', icon:'📍', name:'Wegpunkt'},
  {id:'zone',     icon:'🔷', name:'Zone'},
];

const ITEM_SIZE = { tower:2, unit:1, structure:3, special:1 };

export default function MapEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const isNew = !id || id === 'new';

  // Map config
  const [gameType, setGameType]   = useState('td');
  const [sizeKey,  setSizeKey]    = useState('mittel');
  const [cols,     setCols]       = useState(25);
  const [rows,     setRows]       = useState(35);
  const [title,    setTitle]      = useState('');
  const [items,    setItems]      = useState([]); // placed items
  const [sequences,setSequences]  = useState([]); // TA prebuilt sequences
  const [saving,   setSaving]     = useState(false);
  const [loading,  setLoading]    = useState(!isNew);

  // Editor state
  const [tab,        setTab]       = useState('place'); // place|sequences|settings
  const [palette,    setPalette]   = useState('tower');
  const [selItem,    setSelItem]   = useState(TOWERS[0]);
  const [selEntity,  setSelEntity] = useState('passive');
  const [selRound,   setSelRound]  = useState(null); // null=all rounds
  const [hoverCell,  setHoverCell] = useState(null);
  const [selPlaced,  setSelPlaced] = useState(null); // selected placed item
  const [totalRounds,setTotalRounds]=useState(5);
  const [zoom,       setZoom]      = useState(1);

  // Load existing map
  useEffect(() => {
    if (isNew) return;
    api.get(`/workshop/maps/${id}`)
      .then(r => {
        const m = r.data;
        setTitle(m.title || '');
        setGameType(m.game_type || 'td');
        setCols(m.cols || 25);
        setRows(m.rows || 35);
        setItems(Array.isArray(m.layout_items) ? m.layout_items : []);
        setSequences(Array.isArray(m.prebuilt_sequences) ? m.prebuilt_sequences : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  // Apply size preset
  const applyPreset = (key) => {
    setSizeKey(key);
    if (key !== 'custom') {
      setCols(SIZE_PRESETS[key].cols);
      setRows(SIZE_PRESETS[key].rows);
    }
  };

  // Canvas rendering
  const TILE = Math.max(10, Math.min(28, Math.floor((window.innerWidth * 0.55) / cols))) * zoom;

  const getEntityColor = (entity) => ENTITIES.find(e=>e.key===entity)?.color || '#888';

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const CW = cols * TILE, CH = rows * TILE;
    canvas.width  = CW * window.devicePixelRatio;
    canvas.height = CH * window.devicePixelRatio;
    canvas.style.width  = CW + 'px';
    canvas.style.height = CH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

    // Grid
    const entryCol = Math.floor(cols/2);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const isEntry = (r === 0 && c === entryCol) || (r === rows-1 && c === entryCol);
      ctx.fillStyle = isEntry ? '#2a5010' : (r+c)%2===0 ? '#1e3210':'#1a2c0e';
      ctx.fillRect(c*TILE, r*TILE, TILE, TILE);
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = .5;
    for (let r=0;r<=rows;r++){ctx.beginPath();ctx.moveTo(0,r*TILE);ctx.lineTo(CW,r*TILE);ctx.stroke();}
    for (let c=0;c<=cols;c++){ctx.beginPath();ctx.moveTo(c*TILE,0);ctx.lineTo(c*TILE,CH);ctx.stroke();}

    // Entry/exit portals
    ctx.fillStyle='#50ff70'; ctx.font=`bold ${TILE*.6}px serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('▼', entryCol*TILE+TILE/2, TILE/2);
    ctx.fillStyle='#ff6050';
    ctx.fillText('▲', entryCol*TILE+TILE/2, (rows-1)*TILE+TILE/2);

    // Placed items (filter by selected round)
    const visItems = items.filter(it => selRound===null || it.round===null || it.round===selRound);
    for (const it of visItems) {
      const sz = (ITEM_SIZE[it.category]||1) * TILE;
      const x = it.col * TILE, y = it.row * TILE;
      const ec = getEntityColor(it.entity);
      const isSel = selPlaced?.id === it.id;

      // Background
      ctx.fillStyle = ec + '33';
      ctx.fillRect(x, y, sz, sz);
      ctx.strokeStyle = isSel ? '#fff8c0' : ec;
      ctx.lineWidth = isSel ? 2.5 : 1.5;
      ctx.strokeRect(x+.5, y+.5, sz-1, sz-1);

      // Icon
      ctx.font = `${Math.max(10,sz*.55)}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.shadowBlur = 0;
      ctx.fillText(it.icon, x+sz/2, y+sz/2);

      // Round badge
      if (it.round !== null) {
        ctx.font = `bold ${TILE*.22}px Cinzel,serif`;
        ctx.fillStyle = '#fff8c0';
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillText(`R${it.round}`, x+sz-2, y+2);
      }
    }

    // Hover
    if (hoverCell && tab === 'place') {
      const sz = (ITEM_SIZE[palette]||1) * TILE;
      ctx.fillStyle = 'rgba(255,255,255,.15)';
      ctx.fillRect(hoverCell.c*TILE, hoverCell.r*TILE, sz, sz);
    }
  }, [cols, rows, TILE, items, hoverCell, tab, palette, selRound, selPlaced]);

  useEffect(() => { renderCanvas(); }, [renderCanvas]);

  // Canvas interaction
  const cellFromEvent = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left), y = (e.clientY - rect.top);
    return { r: Math.floor(y / TILE), c: Math.floor(x / TILE) };
  };

  const handleCanvasClick = (e) => {
    const cell = cellFromEvent(e);
    if (!cell) return;
    const { r, c } = cell;
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;

    if (tab !== 'place') return;

    // Check if clicking existing item
    const existing = items.find(it => {
      const sz = ITEM_SIZE[it.category] || 1;
      return r >= it.row && r < it.row+sz && c >= it.col && c < it.col+sz;
    });
    if (existing) { setSelPlaced(existing); return; }
    setSelPlaced(null);

    // Place new item
    const sz = ITEM_SIZE[palette] || 1;
    if (r + sz > rows || c + sz > cols) return;

    const newItem = {
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      category: palette,
      item_id: selItem.id,
      icon: selItem.icon,
      name: selItem.name,
      row: r, col: c,
      entity: selEntity,
      round: selRound,
    };
    setItems(prev => [...prev, newItem]);
  };

  const handleCanvasRightClick = (e) => {
    e.preventDefault();
    const cell = cellFromEvent(e);
    if (!cell) return;
    const { r, c } = cell;
    const existing = items.find(it => {
      const sz = ITEM_SIZE[it.category] || 1;
      return r >= it.row && r < it.row+sz && c >= it.col && c < it.col+sz;
    });
    if (existing) {
      setItems(prev => prev.filter(it => it.id !== existing.id));
      if (selPlaced?.id === existing.id) setSelPlaced(null);
    }
  };

  const deleteSelected = () => {
    if (!selPlaced) return;
    setItems(prev => prev.filter(it => it.id !== selPlaced.id));
    setSelPlaced(null);
  };

  // TA Sequences
  const addSequence = () => {
    setSequences(prev => [...prev, {
      id: `seq_${Date.now()}`,
      name: `Layout ${prev.length+1}`,
      mode: 'sequential',
      items: items.map(it => ({ ...it })), // snapshot current layout
    }]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        title: title.trim() || 'Unbenannte Map',
        game_type: gameType,
        game_mode: gameType,
        cols, rows,
        layout_items: items,
        prebuilt_sequences: sequences,
        config: {
          game_mode: gameType, cols, rows,
          prebuilt_items: items,
          prebuilt_sequences: sequences,
          ta_layout: gameType === 'time_attack' ? {
            cols, rows, rounds: totalRounds,
            gold_per_round: 100, wood_per_round: 60,
            prebuilt_towers: items.filter(it=>it.category==='tower'),
            prebuilt_sequences: sequences,
          } : undefined,
        },
      };
      if (isNew) await api.post('/workshop/maps', payload);
      else await api.put(`/workshop/maps/${id}`, payload);
      navigate('/workshop');
    } catch(e) { alert('Fehler beim Speichern'); }
    setSaving(false);
  };

  if (loading) return <div className="loading-screen">⏳ Lädt…</div>;

  const palettes = {
    tower:     TOWERS,
    unit:      UNITS,
    structure: STRUCTURES,
    special:   SPECIAL,
  };

  const tabBtn = (k,l) => (
    <button onClick={()=>setTab(k)} style={{
      padding:'6px 12px', border:'none', background:'none', cursor:'pointer',
      fontFamily:'Cinzel,serif', fontSize:10, fontWeight:700,
      color:tab===k?'var(--gold)':'var(--text3)',
      borderBottom:tab===k?'2px solid var(--gold)':'2px solid transparent',
    }}>{l}</button>
  );

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* Header */}
      <div className="page-header" style={{ flexShrink:0 }}>
        <button className="btn btn-ghost btn-sm" onClick={()=>navigate('/workshop')}>← Zurück</button>
        <input className="input" value={title} onChange={e=>setTitle(e.target.value)}
          placeholder="Map-Titel…" style={{ flex:1, maxWidth:240, fontSize:13, fontWeight:700 }} />
        <div style={{ display:'flex', gap:5, marginLeft:'auto' }}>
          {GAME_TYPES.map(gt => (
            <button key={gt.key} onClick={()=>setGameType(gt.key)} style={{
              padding:'4px 8px', borderRadius:5, cursor:'pointer', fontSize:10, fontWeight:700,
              border:`2px solid ${gameType===gt.key?'var(--gold)':'var(--border2)'}`,
              background:gameType===gt.key?'rgba(240,200,60,.1)':'var(--bg2)',
              color:gameType===gt.key?'var(--gold)':'var(--text3)', position:'relative',
            }}>
              {gt.icon} {gt.label}
              {gt.badge&&<span style={{ position:'absolute',top:-6,right:-4,fontSize:7,background:'#c04020',color:'#fff',padding:'1px 3px',borderRadius:3 }}>{gt.badge}</span>}
            </button>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
          {saving?'⏳':'💾'} Speichern
        </button>
      </div>

      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        {/* Left: canvas */}
        <div style={{ flex:1, overflow:'auto', background:'#0a0c08', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:12 }}>
          <div>
            {/* Zoom + size controls */}
            <div style={{ display:'flex', gap:8, marginBottom:8, alignItems:'center' }}>
              {Object.entries(SIZE_PRESETS).map(([k,p])=>(
                <button key={k} onClick={()=>applyPreset(k)} style={{
                  padding:'3px 8px', borderRadius:4, cursor:'pointer', fontSize:9, fontWeight:700,
                  border:`1px solid ${sizeKey===k?'var(--gold)':'var(--border2)'}`,
                  background:sizeKey===k?'rgba(240,200,60,.1)':'transparent',
                  color:sizeKey===k?'var(--gold)':'var(--text3)',
                }}>{p.label} {p.cols}×{p.rows}</button>
              ))}
              {sizeKey==='custom'&&(
                <>
                  <input type="number" min="8" max="60" value={cols}
                    onChange={e=>setCols(+e.target.value)}
                    style={{ width:44, padding:'2px 4px', background:'var(--bg2)', border:'1px solid var(--border2)', color:'var(--text)', fontSize:10, borderRadius:3 }} />
                  <span style={{ color:'var(--text3)', fontSize:10 }}>×</span>
                  <input type="number" min="10" max="80" value={rows}
                    onChange={e=>setRows(+e.target.value)}
                    style={{ width:44, padding:'2px 4px', background:'var(--bg2)', border:'1px solid var(--border2)', color:'var(--text)', fontSize:10, borderRadius:3 }} />
                </>
              )}
              <div style={{ marginLeft:'auto', display:'flex', gap:4 }}>
                <button onClick={()=>setZoom(z=>Math.max(.4,+(z-.2).toFixed(1)))}
                  style={{ padding:'2px 7px', background:'var(--bg2)', border:'1px solid var(--border2)', color:'var(--text2)', borderRadius:3, cursor:'pointer' }}>−</button>
                <span style={{ fontSize:10, color:'var(--text3)', minWidth:32, textAlign:'center', lineHeight:'22px' }}>{Math.round(zoom*100)}%</span>
                <button onClick={()=>setZoom(z=>Math.min(3,+(z+.2).toFixed(1)))}
                  style={{ padding:'2px 7px', background:'var(--bg2)', border:'1px solid var(--border2)', color:'var(--text2)', borderRadius:3, cursor:'pointer' }}>+</button>
              </div>
            </div>
            <canvas ref={canvasRef}
              onClick={handleCanvasClick}
              onContextMenu={handleCanvasRightClick}
              onMouseMove={e=>setHoverCell(cellFromEvent(e))}
              onMouseLeave={()=>setHoverCell(null)}
              style={{ display:'block', cursor:'crosshair', borderRadius:4, border:'1px solid rgba(255,255,255,.08)' }} />
            <div style={{ fontSize:9, color:'var(--text3)', marginTop:4, textAlign:'center' }}>
              {cols}×{rows} · Linksklick: platzieren · Rechtsklick: entfernen · {items.length} Items
            </div>
          </div>
        </div>

        {/* Right: controls */}
        <div style={{ width:220, flexShrink:0, display:'flex', flexDirection:'column', borderLeft:'1px solid var(--border2)', overflow:'hidden' }}>
          <div style={{ display:'flex', borderBottom:'1px solid var(--border2)' }}>
            {tabBtn('place','📍 Platzieren')}
            {tabBtn('sequences','🔄 Sequenzen')}
          </div>

          {tab==='place'&&<div style={{ flex:1, overflow:'auto', padding:10 }}>
            {/* Palette selector */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, marginBottom:10 }}>
              {Object.entries({tower:'🏰',unit:'👾',structure:'🏗️',special:'📍'}).map(([k,ic])=>(
                <button key={k} onClick={()=>setPalette(k)} style={{
                  padding:'5px 4px', borderRadius:5, cursor:'pointer', fontSize:9, fontWeight:700,
                  border:`2px solid ${palette===k?'var(--gold)':'var(--border2)'}`,
                  background:palette===k?'rgba(240,200,60,.08)':'var(--bg2)',
                  color:palette===k?'var(--gold)':'var(--text3)',
                }}>{ic} {k.charAt(0).toUpperCase()+k.slice(1)}</button>
              ))}
            </div>

            {/* Item picker */}
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:9, color:'var(--text3)', marginBottom:4 }}>Item</div>
              {palettes[palette].map(it=>(
                <div key={it.id} onClick={()=>setSelItem(it)} style={{
                  display:'flex', alignItems:'center', gap:7, padding:'5px 7px', borderRadius:5, cursor:'pointer',
                  border:`1px solid ${selItem?.id===it.id?'var(--gold)':'transparent'}`,
                  background:selItem?.id===it.id?'rgba(240,200,60,.08)':'transparent',
                  marginBottom:2,
                }}>
                  <span style={{ fontSize:16 }}>{it.icon}</span>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:'var(--text)' }}>{it.name}</div>
                    {it.cost!==undefined&&<div style={{ fontSize:8, color:'var(--text3)' }}>{it.cost>0?`${it.cost}g`:'Kostenlos'}</div>}
                  </div>
                </div>
              ))}
            </div>

            {/* Entity */}
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:9, color:'var(--text3)', marginBottom:4 }}>Entität</div>
              {ENTITIES.map(en=>(
                <div key={en.key} onClick={()=>setSelEntity(en.key)} style={{
                  display:'flex', alignItems:'center', gap:6, padding:'4px 7px', borderRadius:5, cursor:'pointer',
                  border:`1px solid ${selEntity===en.key?en.color+'88':'transparent'}`,
                  background:selEntity===en.key?en.color+'18':'transparent', marginBottom:2,
                }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:en.color, flexShrink:0 }} />
                  <span style={{ fontSize:10, color:selEntity===en.key?en.color:'var(--text2)' }}>{en.label}</span>
                </div>
              ))}
            </div>

            {/* Round filter (for TA sequences) */}
            {gameType==='time_attack'&&(
              <div style={{ marginBottom:10 }}>
                <div style={{ fontSize:9, color:'var(--text3)', marginBottom:4 }}>Runde</div>
                <select className="input" value={selRound??''} onChange={e=>setSelRound(e.target.value===''?null:+e.target.value)} style={{ fontSize:10 }}>
                  <option value="">Alle Runden</option>
                  {Array.from({length:totalRounds},(_, i)=>(
                    <option key={i+1} value={i+1}>Runde {i+1}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Selected item actions */}
            {selPlaced&&(
              <div style={{ padding:8, background:'rgba(240,200,60,.06)', border:'1px solid rgba(240,200,60,.2)', borderRadius:6, marginTop:8 }}>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--gold)', marginBottom:5 }}>
                  {selPlaced.icon} {selPlaced.name}
                </div>
                <div style={{ fontSize:9, color:'var(--text3)', marginBottom:6 }}>
                  {selPlaced.row},{selPlaced.col} · {ENTITIES.find(e=>e.key===selPlaced.entity)?.label}
                  {selPlaced.round!==null&&` · R${selPlaced.round}`}
                </div>
                <select className="input" value={selPlaced.entity}
                  onChange={e=>{ const ne=e.target.value; setItems(p=>p.map(it=>it.id===selPlaced.id?{...it,entity:ne}:it)); setSelPlaced(p=>({...p,entity:ne})); }}
                  style={{ fontSize:9, marginBottom:5, width:'100%' }}>
                  {ENTITIES.map(en=><option key={en.key} value={en.key}>{en.label}</option>)}
                </select>
                <button onClick={deleteSelected} style={{ width:'100%', padding:'4px', background:'rgba(200,40,20,.2)', border:'1px solid #a02010', color:'#ff6050', borderRadius:4, cursor:'pointer', fontSize:9 }}>
                  🗑️ Entfernen
                </button>
              </div>
            )}
          </div>}

          {tab==='sequences'&&<div style={{ flex:1, overflow:'auto', padding:10 }}>
            <div style={{ fontSize:10, color:'var(--text3)', lineHeight:1.5, marginBottom:10 }}>
              Sequenzen definieren welche vorplatzierten Items wann erscheinen. Nützlich für TA-Runden.
            </div>
            {gameType==='time_attack'&&(
              <div style={{ marginBottom:10 }}>
                <label style={{ fontSize:9, color:'var(--text3)' }}>Gesamt-Runden</label>
                <input type="number" min="1" max="20" value={totalRounds}
                  onChange={e=>setTotalRounds(+e.target.value)}
                  className="input" style={{ fontSize:10 }} />
              </div>
            )}
            {sequences.map((seq,i)=>(
              <div key={seq.id} style={{ background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:6, padding:8, marginBottom:8 }}>
                <div style={{ display:'flex', gap:5, alignItems:'center', marginBottom:5 }}>
                  <input className="input" value={seq.name}
                    onChange={e=>setSequences(p=>p.map((s,j)=>j===i?{...s,name:e.target.value}:s))}
                    style={{ flex:1, fontSize:10 }} />
                  <button onClick={()=>setSequences(p=>p.filter((_,j)=>j!==i))}
                    style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:14 }}>✕</button>
                </div>
                <select className="input" value={seq.mode}
                  onChange={e=>setSequences(p=>p.map((s,j)=>j===i?{...s,mode:e.target.value}:s))}
                  style={{ fontSize:9, marginBottom:5, width:'100%' }}>
                  <option value="sequential">Sequenziell (1→2→3…)</option>
                  <option value="shuffle">Zufällig gemischt</option>
                </select>
                <div style={{ fontSize:9, color:'var(--text3)' }}>{seq.items?.length||0} Items</div>
                <button className="btn btn-ghost btn-sm" onClick={()=>
                  setSequences(p=>p.map((s,j)=>j===i?{...s,items:items.map(it=>({...it}))}:s))
                } style={{ marginTop:4, fontSize:9 }}>📸 Aktuelle Items übernehmen</button>
              </div>
            ))}
            <button className="btn btn-primary btn-sm" onClick={addSequence} style={{ width:'100%' }}>
              + Sequenz hinzufügen
            </button>

            {gameType==='time_attack'&&sequences.length>0&&(
              <div style={{ marginTop:12, fontSize:9, color:'var(--text3)', padding:'6px 8px', background:'rgba(60,60,200,.1)', borderRadius:5, border:'1px solid rgba(60,60,200,.2)', lineHeight:1.6 }}>
                💡 Items in einer Sequenz ersetzen die Standard-Prebuilts für eine Runde. Im Shuffle-Modus wird die Reihenfolge der Sequenzen jede Partie neu gemischt.
              </div>
            )}
          </div>}
        </div>
      </div>
    </div>
  );
}
