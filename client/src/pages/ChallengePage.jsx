import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

// DSGVO-konformer Score-Submit-Dialog
function SubmitDialog({ challenge, score, wave, sessionId, onClose }) {
  const [email, setEmail]       = useState('');
  const [name, setName]         = useState('');
  const [newsletter, setNl]     = useState(false);
  const [privacyOk, setPrivacy] = useState(false);
  const [submitting, setSub]    = useState(false);
  const [result, setResult]     = useState(null);
  const [err, setErr]           = useState('');

  const submit = async () => {
    if (challenge.require_email && !email) return setErr('E-Mail ist erforderlich.');
    if (!privacyOk) return setErr('Bitte stimme der Datenschutzerklärung zu.');
    setSub(true); setErr('');
    try {
      const { data } = await api.post(`/brands/challenge/${challenge.share_token}/submit`, {
        guest_email: email||null, guest_name: name||null,
        newsletter_optin: newsletter,
        score, wave, session_id: sessionId,
      });
      setResult(data);
    } catch(e) {
      const msg = {
        email_required:'E-Mail ist erforderlich.',
        email_invalid:'Ungültige E-Mail-Adresse.',
        max_entries_reached:'Du hast bereits die maximale Anzahl an Einträgen.',
        challenge_ended:'Diese Challenge ist bereits beendet.',
      };
      setErr(msg[e.response?.data?.error]||'Fehler beim Absenden.');
    }
    setSub(false);
  };

  if (result) return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.85)',backdropFilter:'blur(8px)',zIndex:700,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }}>
      <div style={{ background:'var(--bg)',border:'1px solid var(--gold)',borderRadius:12,maxWidth:360,width:'100%',padding:24,textAlign:'center' }}>
        <div style={{ fontSize:48,marginBottom:12 }}>🎉</div>
        <div style={{ fontSize:18,fontWeight:900,color:'var(--gold)',marginBottom:8,fontFamily:'Cinzel,serif' }}>Score übertragen!</div>
        <div style={{ fontSize:13,color:'var(--text2)',marginBottom:8 }}>Dein Score: <strong>{score}</strong></div>
        <div style={{ fontSize:13,color:'var(--text3)',marginBottom:16 }}>Rang #{result.rank} — Viel Glück! 🍀</div>
        <button onClick={onClose} style={{ padding:'10px 24px',background:'rgba(60,120,60,.3)',border:'1px solid #3a7020',color:'#80e060',fontFamily:'Cinzel,serif',fontSize:12,borderRadius:6,cursor:'pointer' }}>
          Schließen
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.85)',backdropFilter:'blur(8px)',zIndex:700,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }}>
      <div style={{ background:'var(--bg)',border:'1px solid var(--border2)',borderRadius:12,maxWidth:400,width:'100%',padding:'0 0 16px',overflow:'hidden' }}>
        <div style={{ padding:'12px 16px',borderBottom:'1px solid var(--border2)',fontWeight:900,color:'var(--gold)',fontFamily:'Cinzel,serif',fontSize:14 }}>
          🏆 Am Gewinnspiel teilnehmen
        </div>
        <div style={{ padding:'14px 16px',display:'flex',flexDirection:'column',gap:10 }}>
          <div style={{ fontSize:12,color:'var(--text2)',textAlign:'center' }}>
            Dein Score: <strong style={{ color:'var(--gold)',fontSize:16 }}>{score}</strong>
            {challenge.score_metric==='wave'&&<> · Wave {wave}</>}
          </div>
          {challenge.require_email&&(
            <div>
              <label style={{ fontSize:10,color:'var(--text3)' }}>E-Mail-Adresse *</label>
              <input style={{ width:'100%',padding:'8px 10px',background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:5,color:'var(--text)',fontFamily:'inherit',fontSize:12 }}
                type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="deine@email.de" />
            </div>
          )}
          <div>
            <label style={{ fontSize:10,color:'var(--text3)' }}>Name (optional)</label>
            <input style={{ width:'100%',padding:'8px 10px',background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:5,color:'var(--text)',fontFamily:'inherit',fontSize:12 }}
              value={name} onChange={e=>setName(e.target.value)} placeholder="Spielername" />
          </div>
          {challenge.newsletter_opt_in_text&&(
            <label style={{ display:'flex',gap:8,alignItems:'flex-start',cursor:'pointer' }}>
              <input type="checkbox" checked={newsletter} onChange={e=>setNl(e.target.checked)} style={{ marginTop:2,flexShrink:0 }} />
              <span style={{ fontSize:11,color:'var(--text3)',lineHeight:1.5 }}>{challenge.newsletter_opt_in_text}</span>
            </label>
          )}
          <label style={{ display:'flex',gap:8,alignItems:'flex-start',cursor:'pointer' }}>
            <input type="checkbox" checked={privacyOk} onChange={e=>setPrivacy(e.target.checked)} style={{ marginTop:2,flexShrink:0 }} />
            <span style={{ fontSize:11,color:'var(--text3)',lineHeight:1.5 }}>
              Ich stimme zu, dass meine E-Mail-Adresse und mein Score für die Durchführung des Gewinnspiels verarbeitet werden. 
              <a href="/legal/privacy" target="_blank" style={{ color:'var(--gold)',marginLeft:4 }}>Datenschutzerklärung</a>
            </span>
          </label>
          {err&&<div style={{ fontSize:11,color:'var(--red)',padding:'4px 0' }}>⚠️ {err}</div>}
        </div>
        <div style={{ padding:'0 16px',display:'flex',gap:8,justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ padding:'8px 16px',background:'none',border:'1px solid var(--border2)',color:'var(--text3)',borderRadius:5,cursor:'pointer',fontFamily:'Cinzel,serif',fontSize:11 }}>Abbrechen</button>
          <button onClick={submit} disabled={submitting||(!email&&challenge.require_email)||!privacyOk}
            style={{ padding:'8px 18px',background:'rgba(60,160,40,.3)',border:'1px solid #3a8020',color:'#80e060',borderRadius:5,cursor:'pointer',fontFamily:'Cinzel,serif',fontSize:11,fontWeight:700,opacity:(submitting||(!email&&challenge.require_email)||!privacyOk)?.5:1 }}>
            {submitting?'⏳ Sende…':'✓ Score absenden'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChallengePage() {
  const { token } = useParams();
  const navigate   = useNavigate();
  const [challenge, setChallenge] = useState(null);
  const [leaderboard, setLb]      = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showSubmit, setShowSubmit] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameScore, setGameScore]     = useState(0);
  const [gameWave, setGameWave]       = useState(0);
  const [err, setErr]                 = useState('');

  useEffect(() => {
    api.get(`/brands/challenge/${token}`)
      .then(r => { setChallenge(r.data); setLoading(false); })
      .catch(() => { setErr('Challenge nicht gefunden.'); setLoading(false); });
    api.get(`/brands/challenge/${token}/leaderboard`)
      .then(r => setLb(r.data||[])).catch(()=>{});
  }, [token]);

  // Listen for game-over message from td-game.html (postMessage)
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === 'challenge_game_over') {
        setGameScore(e.data.score||0);
        setGameWave(e.data.wave||0);
        setShowSubmit(true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  if (loading) return <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'#06040c',color:'#e0c870',fontFamily:'Cinzel,serif',fontSize:16 }}>⏳ Lädt…</div>;

  if (err) return <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',background:'#06040c',color:'#e0c870',fontFamily:'Cinzel,serif',gap:12 }}>
    <div style={{ fontSize:32 }}>😞</div>
    <div>{err}</div>
  </div>;

  const now = new Date();
  const status = now < new Date(challenge.start_at) ? 'upcoming' : now > new Date(challenge.end_at) ? 'ended' : 'active';
  const statusColors = { upcoming:'#8080ff', active:'#40e060', ended:'#a06030' };
  const statusLabels = { upcoming:'Beginnt bald', active:'⚡ Aktiv', ended:'Beendet' };

  const startGame = () => {
    const workshopConfig = { game_mode: challenge.parent_map_id?.startsWith('builtin_vs')? 'vs': challenge.parent_map_id?.startsWith('builtin_ta')? 'time_attack':'td', challenge_token: token, ...challenge };
    sessionStorage.setItem('mp_session', JSON.stringify({ solo:true, userId:'guest_'+Date.now(), username:'Gast', difficulty:'normal', mode:'solo', workshopConfig }));
    setGameStarted(true);
    const is3D = workshopConfig?.renderer==='threejs' || workshopConfig?.id?.endsWith('_3d'); const gameUrl = workshopConfig.game_mode==='vs'?'/vs-game.html': workshopConfig.game_mode==='time_attack'?(is3D?'/ta-game-3d.html':'/ta-game.html'):'/td-game.html';
    window.location.href = gameUrl;
  };

  return (
    <div style={{ minHeight:'100vh',background:'#06040c',color:'#e0c870',fontFamily:'Cinzel,serif' }}>
      {/* Hero */}
      <div style={{ background:`linear-gradient(180deg,${challenge.brand_color||'#1a1030'},#06040c)`, padding:'32px 20px 24px', textAlign:'center', borderBottom:'1px solid rgba(255,255,255,.05)' }}>
        {challenge.logo_url && <img src={challenge.logo_url} alt="logo" style={{ height:56,marginBottom:14,borderRadius:6,objectFit:'contain' }} />}
        <div style={{ fontSize:10, color:statusColors[status], padding:'3px 14px', borderRadius:12, border:`1px solid ${statusColors[status]}55`, display:'inline-block', marginBottom:12 }}>
          {statusLabels[status]}
        </div>
        <h1 style={{ fontSize:22,fontWeight:900,color:'var(--gold)',margin:'0 0 10px' }}>{challenge.title}</h1>
        {challenge.description && <p style={{ fontSize:12,color:'#a08060',maxWidth:480,margin:'0 auto 16px',lineHeight:1.7 }}>{challenge.description}</p>}
        <div style={{ fontSize:11,color:'#806040' }}>
          {new Date(challenge.start_at).toLocaleDateString('de-DE',{day:'2-digit',month:'long',year:'numeric'})}
          {' – '}
          {new Date(challenge.end_at).toLocaleDateString('de-DE',{day:'2-digit',month:'long',year:'numeric'})}
        </div>
        {status==='active'&&(
          <button onClick={startGame} style={{ marginTop:20,padding:'14px 36px',background:'linear-gradient(180deg,rgba(60,160,20,.5),rgba(30,100,10,.4))',border:'2px solid #3a8020',color:'#80ff40',fontFamily:'Cinzel,serif',fontSize:14,fontWeight:900,borderRadius:8,cursor:'pointer',letterSpacing:.5 }}>
            ▶ Jetzt spielen!
          </button>
        )}
      </div>

      <div style={{ maxWidth:640,margin:'0 auto',padding:'20px 16px',display:'flex',flexDirection:'column',gap:24 }}>
        {/* Prizes */}
        {challenge.prizes?.length>0&&(
          <div>
            <h2 style={{ fontSize:14,fontWeight:900,color:'var(--gold)',marginBottom:12 }}>🎁 Preise</h2>
            {challenge.prizes.map((p,i)=>(
              <div key={i} style={{ display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background:'rgba(255,255,255,.04)',borderRadius:8,border:'1px solid rgba(255,255,255,.06)',marginBottom:6 }}>
                <span style={{ fontSize:22 }}>{i===0?'🥇':i===1?'🥈':i===2?'🥉':''}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12,color:'var(--text)' }}>{p.description||'—'}</div>
                  {p.count>1&&<div style={{ fontSize:10,color:'var(--text3)' }}>{p.count}× verfügbar</div>}
                </div>
              </div>
            ))}
            {challenge.lottery_count>0&&(
              <div style={{ fontSize:11,color:'var(--text3)',marginTop:6,padding:'8px 12px',background:'rgba(255,200,60,.06)',borderRadius:6,border:'1px solid rgba(255,200,60,.15)' }}>
                🎫 Zusätzlich: {challenge.lottery_count} Verlosungs-Gewinner unter allen Teilnehmern
              </div>
            )}
          </div>
        )}

        {/* Leaderboard */}
        {leaderboard.length>0&&(
          <div>
            <h2 style={{ fontSize:14,fontWeight:900,color:'var(--gold)',marginBottom:12 }}>🏅 Bestenliste</h2>
            {leaderboard.slice(0,10).map((e,i)=>(
              <div key={e.id} style={{ display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:'rgba(255,255,255,.03)',borderRadius:6,marginBottom:4,border:'1px solid rgba(255,255,255,.04)' }}>
                <span style={{ minWidth:24,fontSize:14 }}>{i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`}</span>
                <span style={{ flex:1,fontSize:12,color:'var(--text2)' }}>{e.name}</span>
                <span style={{ color:'var(--gold)',fontWeight:700,fontSize:13 }}>{e.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showSubmit && challenge && (
        <SubmitDialog challenge={challenge} score={gameScore} wave={gameWave}
          sessionId={null} onClose={()=>setShowSubmit(false)} />
      )}
    </div>
  );
}
