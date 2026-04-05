import React, { createContext, useContext, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

import { api, getSocket, disconnectSocket } from './api';
import Nav from './components/Nav';
import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import Friends from './pages/Friends';
import ChatPage from './pages/ChatPage';
import LobbyList from './pages/LobbyList';
import LobbyRoom from './pages/LobbyRoom';
import GamePage from './pages/GamePage';
import Profile from './pages/Profile';
import Leaderboard from './pages/Leaderboard';
import JoinRedirect from './pages/JoinRedirect';
import Legal    from './pages/Legal';
import Workshop from './pages/Workshop';
import WorkshopContent from './pages/WorkshopContent';
import Brands         from './pages/Brands';
import MapSelect      from './pages/MapSelect';
import MapEditor      from './pages/MapEditor';
import ChallengePage  from './pages/ChallengePage';
import ErrorBoundary    from './components/ErrorBoundary';
import './App.css';

// ── Auth Context ──────────────────────────
export const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }) {
  const [user, setUser]       = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Verify token on load
    if (localStorage.getItem('access_token')) {
      api.get('/users/me')
        .then(r => { setUser(r.data); localStorage.setItem('user', JSON.stringify(r.data)); })
        .catch(() => {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('user');
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = (data) => {
    localStorage.setItem('access_token',  data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    getSocket(); // connect socket
  };

  const logoutCtx = () => {
    disconnectSocket();
    localStorage.clear();
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, setUser, login, logout: logoutCtx, loading }}>
      {children}
    </AuthCtx.Provider>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="loading-screen">⏳</div>;
  if (!user)   return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/legal/:type" element={<Legal />} />
          <Route path="/join/:type/:code" element={<JoinRedirect />} />
          <Route path="/workshop"         element={<ErrorBoundary><Workshop /></ErrorBoundary>} />
          <Route path="/workshop/content" element={<ErrorBoundary><WorkshopContent /></ErrorBoundary>} />
          <Route path="/verify-email" element={<div>Verifying…</div>} />
          <Route path="/challenge/:token"  element={<ChallengePage />} />

          {/* Protected */}
          <Route path="/" element={<RequireAuth><Nav /></RequireAuth>}>
            <Route index                   element={<Home />} />
            <Route path="friends"          element={<Friends />} />
            <Route path="chat"             element={<ChatPage />} />
            <Route path="chat/:userId"     element={<ChatPage />} />
            <Route path="lobby"            element={<LobbyList />} />
            <Route path="lobby/:id"        element={<LobbyRoom />} />
            <Route path="game/:sessionId"  element={<GamePage />} />
            <Route path="profile"          element={<Profile />} />
            <Route path="profile/:id"      element={<Profile />} />
            <Route path="leaderboard"      element={<Leaderboard />} />
            <Route path="workshop"           element={<ErrorBoundary><Workshop /></ErrorBoundary>} />
            <Route path="workshop/content"   element={<ErrorBoundary><WorkshopContent /></ErrorBoundary>} />
            <Route path="brands"              element={<Brands />} />
            <Route path="play"                element={<MapSelect />} />
            <Route path="workshop/editor/:id"   element={<MapEditor />} />
            <Route path="workshop/editor"        element={<MapEditor />} />

          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
