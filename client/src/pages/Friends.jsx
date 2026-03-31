// src/pages/Friends.jsx
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import Avatar from '../components/Avatar';

export default function Friends() {
  const { t }      = useTranslation();
  const navigate   = useNavigate();
  const [following, setFollowing] = useState([]);
  const [search,    setSearch]    = useState('');
  const [results,   setResults]   = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    api.get('/users/me/following').then(r => setFollowing(r.data)).catch(()=>{});
  }, []);

  const doSearch = useCallback(async (q) => {
    setSearch(q);
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const { data } = await api.get(`/users/search?q=${encodeURIComponent(q)}`);
      setResults(data);
    } finally { setSearching(false); }
  }, []);

  const follow = async (userId) => {
    await api.post(`/users/${userId}/follow`);
    const { data } = await api.get('/users/me/following');
    setFollowing(data);
  };

  const unfollow = async (userId) => {
    await api.delete(`/users/${userId}/follow`);
    setFollowing(f => f.filter(u => u.id !== userId));
  };

  const isFollowing = (id) => following.some(u => u.id === id);

  return (
    <div className="friends-page">
      <div className="page-header">
        <span className="page-title">👥 {t('friends')}</span>
      </div>
      <div className="search-bar">
        <input
          className="input"
          placeholder={t('search_users')}
          value={search}
          onChange={e => doSearch(e.target.value)}
        />
      </div>

      {search.length >= 2 ? (
        <div className="friends-list">
          <div className="section-title">Suchergebnisse</div>
          {searching && <div className="empty-state">{t('loading')}</div>}
          {!searching && results.length === 0 && <div className="empty-state">{t('no_results')}</div>}
          {results.map(u => (
            <div key={u.id} className="friend-row">
              <Avatar user={u} size="md" showOnline />
              <div style={{ flex: 1 }}>
                <div className="friend-name">{u.username}</div>
              </div>
              <button
                className={`btn btn-sm ${isFollowing(u.id) ? 'btn-danger' : 'btn-green'}`}
                onClick={() => isFollowing(u.id) ? unfollow(u.id) : follow(u.id)}
              >
                {isFollowing(u.id) ? t('unfollow') : t('follow')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/chat/${u.id}`)}>💬</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="friends-list">
          <div className="section-title">{t('following')} ({following.length})</div>
          {following.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">👥</div>
              Suche nach Spielern, um ihnen zu folgen.
            </div>
          )}
          {following.map(u => (
            <div key={u.id} className="friend-row" onClick={() => navigate(`/profile/${u.id}`)}>
              <Avatar user={u} size="md" showOnline />
              <div style={{ flex: 1 }}>
                <div className="friend-name">{u.username}</div>
                <div className="friend-status">{u.online ? `● ${t('online')}` : t('offline')}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); navigate(`/chat/${u.id}`); }}>💬</button>
              <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); unfollow(u.id); }}>{t('unfollow')}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
