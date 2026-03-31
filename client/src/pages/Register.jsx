// src/pages/Register.jsx
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';

export default function Register() {
  const { t, i18n } = useTranslation();
  const navigate    = useNavigate();
  const [form, setForm] = useState({ email: '', username: '', password: '', privacy: false });
  const [error,  setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.privacy) { setError(t('privacy_accept') + ' ist erforderlich.'); return; }
    setError(''); setLoading(true);
    try {
      await api.post('/auth/register', {
        email: form.email, username: form.username,
        password: form.password, language: i18n.language,
      });
      setSuccess(t('verification_sent'));
    } catch (err) {
      setError(t(err.response?.data?.error || 'error'));
    } finally { setLoading(false); }
  };

  if (success) return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="alert alert-success" style={{ fontSize: 14, lineHeight: 1.7 }}>{success}</div>
        <Link to="/login" className="btn btn-ghost btn-block" style={{ marginTop: 12 }}>← {t('login')}</Link>
      </div>
    </div>
  );

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-title">⚔ GamePlatform</div>
        <div className="auth-sub">{t('register')}</div>
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label">{t('email')}</label>
            <input className="input" type="email" required value={form.email}
              onChange={e => setForm(f=>({...f,email:e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('username')} (3–32, nur a-z 0-9 _ -)</label>
            <input className="input" type="text" required minLength={3} maxLength={32}
              pattern="[a-zA-Z0-9_-]+" value={form.username}
              onChange={e => setForm(f=>({...f,username:e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('password')} (min. 8 Zeichen)</label>
            <input className="input" type="password" required minLength={8} value={form.password}
              onChange={e => setForm(f=>({...f,password:e.target.value}))} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 16 }}>
            <input id="priv" type="checkbox" checked={form.privacy}
              onChange={e => setForm(f=>({...f,privacy:e.target.checked}))} />
            <label htmlFor="priv" style={{ fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
              {t('privacy_accept')} –{' '}
              <Link to="/legal/privacy" target="_blank" style={{ color: 'var(--gold2)' }}>{t('privacy')}</Link>
            </label>
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? '...' : t('register')}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/login">{t('login')}</Link>
        </div>
      </div>
    </div>
  );
}
