// src/pages/Login.jsx
import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../App';
import { api } from '../api';

export default function Login() {
  const { t, i18n } = useTranslation();
  const { login }   = useAuth();
  const navigate    = useNavigate();
  const location    = useLocation();
  const from        = location.state?.from?.pathname || '/';
  const verified    = new URLSearchParams(location.search).get('verified');

  const [form, setForm]   = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
      login(data);
      navigate(from, { replace: true });
    } catch (err) {
      setError(t(err.response?.data?.error || 'error'));
    } finally { setLoading(false); }
  };

  const guestLogin = async () => {
    const name = prompt(t('guest_name'));
    if (!name?.trim()) return;
    setLoading(true);
    try {
      const { data } = await api.post('/auth/guest', {
        username: name.trim().slice(0,24),
        language: i18n.language,
      });
      login(data);
      navigate('/');
    } catch (err) {
      setError(t(err.response?.data?.error || 'error'));
    } finally { setLoading(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-title">⚔ GamePlatform</div>
        <div className="auth-sub">{t('login')}</div>

        {verified && <div className="alert alert-success">✅ E-Mail bestätigt! Du kannst dich jetzt anmelden.</div>}
        {error    && <div className="alert alert-error">{error}</div>}

        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label">{t('email')}</label>
            <input className="input" type="email" value={form.email} required
              onChange={e => setForm(f => ({...f, email: e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('password')}</label>
            <input className="input" type="password" value={form.password} required
              onChange={e => setForm(f => ({...f, password: e.target.value}))} />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? '...' : t('login')}
          </button>
        </form>

        <div className="auth-divider">oder</div>
        <button className="btn btn-ghost btn-block" onClick={guestLogin} disabled={loading}>
          🎭 {t('guest_play')}
        </button>

        <div className="auth-links">
          <Link to="/register">{t('register')}</Link>
          <div style={{ display: 'flex', gap: 8 }}>
            {['de','en'].map(l => (
              <button key={l} onClick={() => { i18n.changeLanguage(l); localStorage.setItem('lang',l); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: i18n.language===l ? 'var(--gold)' : 'var(--text3)', fontSize: 12 }}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11 }}>
          <Link to="/legal/imprint" style={{ color: 'var(--text3)', marginRight: 12 }}>{t('imprint')}</Link>
          <Link to="/legal/privacy" style={{ color: 'var(--text3)' }}>{t('privacy')}</Link>
        </div>
      </div>
    </div>
  );
}
