import React, { createContext, useContext, useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

import { api, getSocket, disconnectSocket } from './api';
import Nav from './components/Nav';
import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import Friends from './pages/Friends';
import ChatPage from './pages/ChatPage';
import LobbyList from './pages/LobbyList';
import Profile from './pages/Profile';
import Leaderboard from './pages/Leaderboard';
import JoinRedirect from './pages/JoinRedirect';
import Legal    from './pages/Legal';
import Brands         from './pages/Brands';
import Admin          from './pages/Admin';
import MapSelect      from './pages/MapSelect';
import ChallengePage  from './pages/ChallengePage';
import ErrorBoundary    from './components/ErrorBoundary';
import './App.css';

// Lazy-loaded: pulls in @craftworks/arops-shared (AropsLobbyPanel) and other
// heavier per-page code into their own chunks instead of the single ~734KB
// entry bundle every route used to share (Vite itself flagged this — "some
// chunks are larger than 500kB, consider dynamic import()"). Isolation is
// the real point: a problem in one of these pages' code (or a dependency
// only they use) can no longer affect pages that don't render them at all,
// like /login — previously everything was eagerly evaluated in one script
// regardless of which route was actually active.
const LobbyRoom = lazy(() => import('./pages/LobbyRoom'));
const GamePage = lazy(() => import('./pages/GamePage'));
const Workshop = lazy(() => import('./pages/Workshop'));
const WorkshopContent = lazy(() => import('./pages/WorkshopContent'));
const MapEditor = lazy(() => import('./pages/MapEditor'));
const HuntEditor = lazy(() => import('./pages/HuntEditor'));
const HuntPlay = lazy(() => import('./pages/HuntPlay'));
const LazyFallback = () => <div className="loading-screen">⏳</div>;

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
          <Route path="/workshop"         element={<ErrorBoundary><Suspense fallback={<LazyFallback />}><Workshop /></Suspense></ErrorBoundary>} />
          <Route path="/workshop/content" element={<ErrorBoundary><Suspense fallback={<LazyFallback />}><WorkshopContent /></Suspense></ErrorBoundary>} />
          <Route path="/verify-email" element={<div>Verifying…</div>} />
          <Route path="/challenge/:token"  element={<ChallengePage />} />

          {/* Protected */}
          <Route path="/" element={<RequireAuth><Nav /></RequireAuth>}>
            <Route index                   element={<Home />} />
            <Route path="friends"          element={<Friends />} />
            <Route path="chat"             element={<ChatPage />} />
            <Route path="chat/:userId"     element={<ChatPage />} />
            <Route path="lobby"            element={<LobbyList />} />
            <Route path="lobby/:id"        element={<ErrorBoundary><Suspense fallback={<LazyFallback />}><LobbyRoom /></Suspense></ErrorBoundary>} />
            <Route path="game/:sessionId"  element={<ErrorBoundary><Suspense fallback={<LazyFallback />}><GamePage /></Suspense></ErrorBoundary>} />
            <Route path="profile"          element={<Profile />} />
            <Route path="profile/:id"      element={<Profile />} />
            <Route path="leaderboard"      element={<Leaderboard />} />
            <Route path="workshop"           element={<ErrorBoundary><Suspense fallback={<LazyFallback />}><Workshop /></Suspense></ErrorBoundary>} />
            <Route path="workshop/content"   element={<ErrorBoundary><Suspense fallback={<LazyFallback />}><WorkshopContent /></Suspense></ErrorBoundary>} />
            <Route path="brands"              element={<Brands />} />
            <Route path="admin"               element={<Admin />} />
            <Route path="play"                element={<MapSelect />} />
            <Route path="workshop/editor/:id"   element={<ErrorBoundary><Suspense fallback={<LazyFallback />}><MapEditor /></Suspense></ErrorBoundary>} />
            <Route path="workshop/editor"        element={<ErrorBoundary><Suspense fallback={<LazyFallback />}><MapEditor /></Suspense></ErrorBoundary>} />
            <Route path="hunt/editor/:id"        element={<ErrorBoundary><Suspense fallback={<LazyFallback />}><HuntEditor /></Suspense></ErrorBoundary>} />
            <Route path="hunt/editor"            element={<ErrorBoundary><Suspense fallback={<LazyFallback />}><HuntEditor /></Suspense></ErrorBoundary>} />
            <Route path="hunt/play/:code"        element={<ErrorBoundary><Suspense fallback={<LazyFallback />}><HuntPlay /></Suspense></ErrorBoundary>} />
            <Route path="hunt/play"              element={<ErrorBoundary><Suspense fallback={<LazyFallback />}><HuntPlay /></Suspense></ErrorBoundary>} />

          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
