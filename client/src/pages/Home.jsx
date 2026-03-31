import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../App';
import { api } from '../api';
import Avatar from '../components/Avatar';

export function Home() {
  const { user }   = useAuth();
  const { t }      = useTranslation();
  const navigate   = useNavigate();
  const [history, setHistory] = useState([]);

  useEffect(() => {
    api.get('/games/history').then(r => setHistory(r.data)).catch(()=>{});
  }, []);

  const startSolo = () => {
    sessionStorage.setItem('mp_session', JSON.stringify({
      solo: true,
      userId: user.id,
      username: user.username,
    }));
    window.location.href = '/td-game.html';
  };

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <Avatar user={user} size="xl" />
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{user?.username}</div>
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>● {t('online')}</div>
        </div>
      </div>

      {/* Game tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
        {/* Singleplayer tile */}
        <div
          onClick={startSolo}
          style={{
            background: 'linear-gradient(135deg, #1a2a0a, #0e1806)',
            border: '2px solid #3a6020',
            borderRadius: 12, padding: 20, cursor: 'pointer',
            transition: 'border-color .15s, transform .1s',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor='#60a030'}
          onMouseLeave={e => e.currentTarget.style.borderColor='#3a6020'}
        >
          <div style={{ fontSize: 32 }}>🗡️</div>
          <div style={{ fontWeight: 900, color: '#80e060', fontSize: 15 }}>Einzelspieler</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.4 }}>
            Tower Defense solo.<br/>Schwierigkeit wählbar.
          </div>
        </div>

        {/* Multiplayer tile */}
        <div
          onClick={() => navigate('/lobby')}
          style={{
            background: 'linear-gradient(135deg, #1a0e2a, #0e0816)',
            border: '2px solid #602080',
            borderRadius: 12, padding: 20, cursor: 'pointer',
            transition: 'border-color .15s',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor='#a040d0'}
          onMouseLeave={e => e.currentTarget.style.borderColor='#602080'}
        >
          <div style={{ fontSize: 32 }}>⚔️</div>
          <div style={{ fontWeight: 900, color: '#c060f0', fontSize: 15 }}>Multiplayer</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.4 }}>
            Koop &amp; Turnier.<br/>Lobbys erstellen &amp; beitreten.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
        <button className="btn btn-ghost" onClick={() => navigate('/friends')}>👥 {t('friends')}</button>
        <button className="btn btn-ghost" onClick={() => navigate('/leaderboard')}>🏆</button>
      </div>

      {history.length > 0 && (
        <>
          <div className="section-title">Letzte Spiele</div>
          {history.slice(0,5).map(g => (
            <div key={g.id} className="card" style={{ marginBottom: 8, padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className={`lobby-badge badge-${g.game_mode}`}>{t(g.game_mode)}</span>
                  <span className={`lobby-badge badge-${g.difficulty}`} style={{ marginLeft: 6 }}>{t(g.difficulty)}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--gold)' }}>Wave {g.wave} · {g.score} Pts</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(g.started_at).toLocaleDateString()}</div>
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
export default Home;
