// src/pages/Profile.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../App';
import { api } from '../api';
import Avatar from '../components/Avatar';

export default function Profile() {
  const { id }     = useParams();
  const { user, setUser } = useAuth();
  const { t }      = useTranslation();
  const navigate   = useNavigate();
  const isSelf     = !id || id === user?.id;
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ username: '', avatar_color: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (isSelf) {
      setProfile(user);
      setForm({ username: user?.username || '', avatar_color: user?.avatar_color || '#4a90e2' });
    } else {
      api.get(`/users/${id}`).then(r => setProfile(r.data)).catch(()=>{});
    }
  }, [id, user]);

  const saveProfile = async () => {
    setError('');
    try {
      const { data } = await api.patch('/users/me', form);
      setUser(u => ({ ...u, ...data }));
      localStorage.setItem('user', JSON.stringify({ ...user, ...data }));
      setEditing(false);
    } catch (e) { setError(t(e.response?.data?.error || 'error')); }
  };

  const COLORS = ['#4a90e2','#e24a4a','#4ae24a','#e2c04a','#c04ae2','#4ae2c0','#e2804a','#808080'];

  if (!profile) return <div className="loading-screen">{t('loading')}</div>;

  return (
    <div className="profile-page">
      <div className="profile-header">
        <Avatar user={profile} size="xl" showOnline />
        <div style={{ flex: 1 }}>
          {editing ? (
            <>
              <input className="input" value={form.username}
                onChange={e=>setForm(f=>({...f,username:e.target.value}))}
                style={{ marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {COLORS.map(c => (
                  <div key={c} onClick={() => setForm(f=>({...f,avatar_color:c}))}
                    style={{ width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer',
                      border: form.avatar_color===c ? '3px solid var(--gold)' : '2px solid transparent' }} />
                ))}
              </div>
              {error && <div className="form-error">{error}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={saveProfile}>{t('save')}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>{t('cancel')}</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{profile.username}</div>
              <div style={{ fontSize: 12, color: profile.online ? 'var(--green)' : 'var(--text3)', marginTop: 2 }}>
                {profile.online ? `● ${t('online')}` : t('offline')}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 13, color: 'var(--text2)' }}>
                <span><b style={{color:'var(--text)'}}>{profile.following_count||0}</b> {t('following')}</span>
                <span><b style={{color:'var(--text)'}}>{profile.followers_count||0}</b> {t('followers')}</span>
              </div>
              {isSelf
                ? <button className="btn btn-ghost btn-sm" style={{marginTop:10}} onClick={()=>setEditing(true)}>✏ Bearbeiten</button>
                : !profile.is_following
                  ? <button className="btn btn-green btn-sm" style={{marginTop:10}} onClick={()=>{api.post(`/users/${id}/follow`);setProfile(p=>({...p,is_following:true}))}}>{t('follow')}</button>
                  : <button className="btn btn-danger btn-sm" style={{marginTop:10}} onClick={()=>{api.delete(`/users/${id}/follow`);setProfile(p=>({...p,is_following:false}))}}>{t('unfollow')}</button>
              }
            </>
          )}
        </div>
      </div>
    </div>
  );
}
