import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';

export default function Leaderboard() {
  const { t }  = useTranslation();
  const [rows, setRows] = useState([]);
  const [diff, setDiff] = useState('');

  useEffect(() => {
    api.get(`/users/leaderboard/tower_defense${diff?`?difficulty=${diff}`:''}`).then(r=>setRows(r.data)).catch(()=>{});
  }, [diff]);

  const rankIcon = i => i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`;
  return (
    <div style={{ height:'100%', overflow:'auto' }}>
      <div className="page-header">
        <span className="page-title">🏆 {t('leaderboard')}</span>
        <select className="input" style={{ width:'auto' }} value={diff} onChange={e=>setDiff(e.target.value)}>
          <option value="">Alle</option>
          {['easy','normal','hard','expert','horror'].map(d=><option key={d} value={d}>{t(d)}</option>)}
        </select>
      </div>
      {rows.length === 0
        ? <div className="empty-state"><div className="empty-icon">🏆</div>Noch keine Einträge.</div>
        : <table className="lb-table"><thead><tr><th>{t('rank')}</th><th>Spieler</th><th>{t('score')}</th><th>{t('wave')}</th><th>{t('difficulty')}</th></tr></thead>
          <tbody>{rows.map((r,i)=>(
            <tr key={i}>
              <td><span className={`lb-rank${i===0?' top1':i===1?' top2':i===2?' top3':''}`}>{rankIcon(i)}</span></td>
              <td><div style={{display:'flex',alignItems:'center',gap:8}}><div className="avatar avatar-sm" style={{background:r.avatar_color||'#4a90e2'}}>{r.username?.slice(0,2).toUpperCase()}</div>{r.username}</div></td>
              <td style={{color:'var(--gold)',fontWeight:700}}>{r.score}</td>
              <td>Wave {r.wave}</td>
              <td><span className={`lobby-badge badge-${r.difficulty}`}>{t(r.difficulty)}</span></td>
            </tr>
          ))}</tbody></table>
      }
    </div>
  );
}
