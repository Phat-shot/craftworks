// src/components/Nav.jsx
import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../App';
import { api, getSocket } from '../api';
import Avatar from './Avatar';

export default function Nav() {
  const { user, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    // Load unread count
    api.get('/chat/unread').then(r => {
      const total = Object.values(r.data).reduce((s, v) => s + v, 0);
      setUnread(total);
    }).catch(() => {});

    const socket = getSocket();
    socket.on('chat:dm', () => setUnread(n => n + 1));
    return () => socket.off('chat:dm');
  }, []);

  const navItems = [
    { to: '/',          icon: '🏠', label: t('home')        },
    { to: '/friends',   icon: '👥', label: t('friends')     },
    { to: '/chat',      icon: '💬', label: t('chat'), badge: unread },
    { to: '/lobby',     icon: '🎮', label: t('lobby')       },
    { to: '/leaderboard',icon: '🏆', label: t('leaderboard')},
    { to: '/workshop',    icon: '🔧', label: 'Workshop'         },
    { to: '/workshop/content', icon: '🔨', label: 'Inhalte' },
    { to: '/brands',           icon: '🏢', label: 'Brands'  },
  ];

  return (
    <div className="nav-layout">
      <aside className="sidebar">
        <div className="nav-brand">
          <span>⚔</span>
          <span className="nav-brand-text">GamePlatform</span>
        </div>
        <nav className="nav-items">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              {item.badge > 0 && <span className="nav-badge">{item.badge > 99 ? '99+' : item.badge}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="nav-footer">
          {/* Language toggle */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, justifyContent: 'center' }}>
            {['de','en'].map(lang => (
              <button
                key={lang}
                onClick={() => { i18n.changeLanguage(lang); localStorage.setItem('lang', lang); }}
                className="btn btn-ghost btn-sm"
                style={{ padding: '4px 10px', opacity: i18n.language === lang ? 1 : .4 }}
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="nav-user" onClick={() => navigate('/profile')}>
            <Avatar user={user} size="sm" />
            <div className="nav-user-info">
              <div className="nav-username">{user?.username}</div>
              <div className="nav-status">● {t('online')}</div>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm btn-block"
            style={{ marginTop: 6 }}
            onClick={logout}
          >
            {t('logout')}
          </button>
        </div>
      </aside>

      <main className="page-content">
        <Outlet />
      </main>
    </div>
  );
}
