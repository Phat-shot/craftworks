// src/api.js
import axios from 'axios';
import { io } from 'socket.io-client';

const BASE = process.env.REACT_APP_API_URL || '';

// ── Axios instance ────────────────────────
export const api = axios.create({ baseURL: `${BASE}/api`, withCredentials: true });

// Auto-attach access token
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('access_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Auto-refresh on 401
api.interceptors.response.use(
  r => r,
  async err => {
    if (err.response?.status === 401 && !err.config._retry) {
      err.config._retry = true;
      const refresh = localStorage.getItem('refresh_token');
      if (refresh) {
        try {
          const { data } = await axios.post(`${BASE}/api/auth/refresh`, { refresh_token: refresh });
          localStorage.setItem('access_token', data.access_token);
          err.config.headers.Authorization = `Bearer ${data.access_token}`;
          return api(err.config);
        } catch { logout(); }
      }
    }
    return Promise.reject(err);
  }
);

export function logout() {
  const rt = localStorage.getItem('refresh_token');
  if (rt) api.post('/auth/logout', { refresh_token: rt }).catch(() => {});
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

// ── Socket.io ─────────────────────────────
let _socket = null;

export function getSocket() {
  if (_socket?.connected) return _socket;
  const token = localStorage.getItem('access_token');
  _socket = io(BASE || window.location.origin, {
    auth: { token },
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
  });
  _socket.on('connect_error', (e) => console.warn('Socket error:', e.message));
  return _socket;
}

export function disconnectSocket() {
  _socket?.disconnect();
  _socket = null;
}
