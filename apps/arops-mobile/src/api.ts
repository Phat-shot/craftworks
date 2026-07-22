import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, NativeEventSubscription } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { SERVER_URL } from './config';
import { withTimeout } from './utils/withTimeout';
import type { ThemeName } from './theme';
export type { ThemeName } from './theme';

// fetch() has no built-in timeout — a slow/unresponsive server (or a bad
// mobile network) can leave it hanging far longer than any user will wait,
// with no rejection to react to. Bounded here the same way expo-location's
// equally timeout-less promises already are (see withTimeout's own
// comment) — this runs at boot (restoreSession -> tryRefresh) before the
// player can do anything at all, so a hang here reads as "the whole app is
// stuck", not just one failed request.
const FETCH_TIMEOUT_MS = 10_000;

export interface User { id: string; username: string; avatar_color?: string; }
export interface LastPosition { lat: number; lon: number; ts: number; }

let accessToken: string | null = null;
let refreshToken: string | null = null;
let currentUser: User | null = null;
let socket: Socket | null = null;
let appStateSub: NativeEventSubscription | null = null;
let lastPosition: LastPosition | null = null;

export function getUser(): User | null { return currentUser; }

/** Last real (device-reported, not IP-guessed) GPS fix, persisted locally
 *  across app restarts — purely a map-convenience default (never sent to
 *  the server), so the lobby map can center on roughly the right area
 *  immediately instead of the world view while a fresh fix is still
 *  pending. */
export function getLastPosition(): LastPosition | null { return lastPosition; }

export async function saveLastPosition(lat: number, lon: number): Promise<void> {
  lastPosition = { lat, lon, ts: Date.now() };
  await AsyncStorage.setItem('last_position', JSON.stringify(lastPosition)).catch(() => {});
}

/** Restores the persisted last-known position into memory. Independent of
 *  restoreSession (device-local, not tied to a user session) — call once
 *  at boot before any screen that reads getLastPosition() can mount. */
export async function loadLastPosition(): Promise<void> {
  const raw = await AsyncStorage.getItem('last_position').catch(() => null);
  if (!raw) return;
  try { lastPosition = JSON.parse(raw); } catch {}
}

export interface HeadingSettings { interpolation: boolean; sampleMs: number; renderHz: number; }
const DEFAULT_HEADING_SETTINGS: HeadingSettings = { interpolation: true, sampleMs: 250, renderHz: 30 };
let headingSettings: HeadingSettings = { ...DEFAULT_HEADING_SETTINGS };

/** Compass smoothing prefs (see useTelemetry's setHeadingInterpolation/
 *  setHeadingSampleIntervalMs/setHeadingRenderRateHz) — a device-level
 *  performance tradeoff, not a per-match setting, so it lives on the start
 *  screen and persists across matches/restarts instead of GameScreen's own
 *  in-match popup. */
export function getHeadingSettings(): HeadingSettings { return headingSettings; }

export async function saveHeadingSettings(patch: Partial<HeadingSettings>): Promise<void> {
  headingSettings = { ...headingSettings, ...patch };
  await AsyncStorage.setItem('heading_settings', JSON.stringify(headingSettings)).catch(() => {});
}

/** Independent of restoreSession, same as loadLastPosition — call once at
 *  boot before GameScreen can mount. */
export async function loadHeadingSettings(): Promise<void> {
  const raw = await AsyncStorage.getItem('heading_settings').catch(() => null);
  if (!raw) return;
  try { headingSettings = { ...DEFAULT_HEADING_SETTINGS, ...JSON.parse(raw) }; } catch {}
}

// UI theme (Color/Nacht/Tag) — device-level, same persistence shape as
// HeadingSettings above. Default 'color' (today's only look, unchanged) so
// existing installs see no visual change until the player explicitly opts
// into Night/Day via the Einstellungen picker. Type lives in theme.ts (the
// canonical definition, re-exported here) rather than duplicated.
const DEFAULT_THEME: ThemeName = 'color';
let currentTheme: ThemeName = DEFAULT_THEME;

export function getTheme(): ThemeName { return currentTheme; }

export async function saveTheme(name: ThemeName): Promise<void> {
  currentTheme = name;
  await AsyncStorage.setItem('theme', name).catch(() => {});
}

/** Independent of restoreSession, same as loadLastPosition/loadHeadingSettings. */
export async function loadTheme(): Promise<void> {
  const raw = await AsyncStorage.getItem('theme').catch(() => null);
  if (raw === 'color' || raw === 'night' || raw === 'day') currentTheme = raw;
}

// 'ok' — refreshed successfully. 'rejected' — the SERVER actually responded
// and said the refresh token is dead (expired/invalid); the session really
// is over. 'network_error' — never got a response at all (timeout, no
// connectivity, cold app-start network re-establishing) — the refresh token
// itself might still be perfectly valid, we just couldn't reach the server
// this instant. Callers must NOT treat 'network_error' the same as
// 'rejected': wiping stored tokens on a transient network hiccup is exactly
// what caused "closed and reopened the app -> session expired" even though
// the 30-day refresh token was still good — see the two call sites below.
type RefreshResult = 'ok' | 'rejected' | 'network_error';

/** Access tokens expire after 15 min — transparently refresh and retry once. */
async function tryRefresh(): Promise<RefreshResult> {
  if (!refreshToken) return 'rejected';
  let res: Response;
  try {
    res = await withTimeout(fetch(`${SERVER_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }), FETCH_TIMEOUT_MS);
  } catch {
    return 'network_error';
  }
  if (!res.ok) {
    // Only a genuine 401 (server explicitly rejects this refresh token —
    // see auth.js's /refresh route, the only place it sends one) means the
    // session is truly dead. Any OTHER non-2xx status (500/502/503 — e.g.
    // the test server mid-redeploy/restart, which happens on every push
    // this session) is a transient server-side problem, not proof the
    // refresh token itself is invalid. Treating those as 'rejected' too
    // was wiping perfectly valid 30-day tokens on nothing more than bad
    // timing against a server restart — reported as "kill the app, back to
    // login" with no actual session issue involved.
    return res.status === 401 ? 'rejected' : 'network_error';
  }
  try {
    const d = await res.json();
    if (!d.access_token) return 'rejected';
    accessToken = d.access_token;
    const sets: [string, string][] = [['access_token', d.access_token]];
    if (d.refresh_token) { refreshToken = d.refresh_token; sets.push(['refresh_token', d.refresh_token]); }
    await AsyncStorage.multiSet(sets);
    // Keep the socket usable after reconnects
    if (socket) (socket.auth as any) = { token: accessToken };
    return 'ok';
  } catch {
    return 'network_error';
  }
}

// Access tokens live only 15 min, but a socket connection can legitimately
// sit idle for much longer than that (host slowly setting up a lobby) with
// zero HTTP calls happening to reactively trigger a refresh via req()'s 401
// handling below. Left alone, the token silently goes stale; the NEXT time
// the socket has to reconnect (backgrounding, a network drop) the server's
// auth middleware rejects the stale token outright, with nothing to recover
// it — reported as "lobby expired" when trying to start a match after
// sitting in the lobby a while. Proactively refreshing well inside the TTL
// keeps both the HTTP token and (via the assignment above) the socket's
// auth payload fresh regardless of whether any HTTP request happens to fire.
const PROACTIVE_REFRESH_MS = 10 * 60_000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
function startProactiveRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => { tryRefresh(); }, PROACTIVE_REFRESH_MS);
}
function stopProactiveRefresh(): void {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

async function req(path: string, body?: unknown, method = 'POST', retry = true): Promise<any> {
  const res = await withTimeout(fetch(`${SERVER_URL}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }), FETCH_TIMEOUT_MS);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // /auth/* endpoints' own 401s mean something specific to that endpoint
    // (login: wrong password) — never "your access token expired". There's
    // no access token involved in a fresh login/register/guest attempt at
    // all, so refreshing one and retrying makes no sense here; worse, it
    // masked the real error (e.g. invalid_credentials) behind a misleading
    // "session_expired" for every failed login attempt.
    const isAuthEndpoint = path.startsWith('/auth/');
    if (res.status === 401 && retry && !isAuthEndpoint) {
      const r = await tryRefresh();
      if (r === 'ok') return req(path, body, method, false);
      if (r === 'network_error') {
        // Couldn't even reach the server to ask — the session may well
        // still be fine. Surface a distinct, retryable error instead of
        // wiping valid tokens over a transient connectivity blip.
        throw new Error('network_error');
      }
      // Server explicitly rejected the refresh token → session is truly dead.
      await AsyncStorage.multiRemove(['access_token', 'refresh_token', 'user']).catch(() => {});
      accessToken = null; refreshToken = null;
      throw new Error('session_expired');
    }
    throw new Error(data?.error || data?.errors?.[0]?.msg || `http_${res.status}`);
  }
  return data;
}

/** Guest login — fastest onboarding for field tests. Persists tokens. */
export async function loginGuest(username: string): Promise<User> {
  const data = await req('/auth/guest', { username });
  accessToken = data.access_token;
  refreshToken = data.refresh_token;
  currentUser = data.user;
  await AsyncStorage.multiSet([
    ['access_token', data.access_token],
    ['refresh_token', data.refresh_token],
    ['user', JSON.stringify(data.user)],
  ]);
  startProactiveRefresh();
  return data.user;
}

/** Real account registration (email+password) — additive to the guest path,
 *  not a replacement. Server auto-verifies immediately if SMTP isn't
 *  configured or the send fails (see server/src/routes/auth.js), so this
 *  always succeeds regardless of email delivery — the caller doesn't need
 *  to handle a "pending verification, can't log in yet" state at all;
 *  `data.message` is purely informational (whether a real email went out).
 */
export async function registerAccount(email: string, username: string, password: string): Promise<{ message: string }> {
  const data = await req('/auth/register', { email, username, password });
  return { message: data.message };
}

/** Real account login (email+password) — persists tokens exactly like loginGuest. */
export async function loginAccount(email: string, password: string): Promise<User> {
  const data = await req('/auth/login', { email, password });
  accessToken = data.access_token;
  refreshToken = data.refresh_token;
  currentUser = data.user;
  await AsyncStorage.multiSet([
    ['access_token', data.access_token],
    ['refresh_token', data.refresh_token],
    ['user', JSON.stringify(data.user)],
  ]);
  startProactiveRefresh();
  return data.user;
}

/** Try restoring a previous session from storage. */
export async function restoreSession(): Promise<User | null> {
  // Reported: still occasionally getting bounced to the login screen with a
  // perfectly good account. One further gap beyond the network_error-vs-
  // rejected fix below: this whole function used to be able to THROW (a
  // bad AsyncStorage read, or JSON.parse on a corrupted `user` blob — e.g.
  // the app got killed mid-write) — App.tsx's caller only has a blanket
  // `.catch(() => setRoute({ name: 'login' }))` around this, so ANY
  // unexpected throw here forced a login screen exactly like a genuinely
  // dead session would, even though the refresh_token itself (the only
  // thing that actually matters) was never touched and may still be
  // perfectly valid. Wrapped so a local read/parse hiccup can never look
  // like proof of a dead session — only an explicit server-side rejection
  // (below) may ever clear the stored tokens.
  let tok: string | null, rtok: string | null, userJson: string | null;
  try {
    const got = await AsyncStorage.multiGet(['access_token', 'refresh_token', 'user']);
    tok = got[0][1]; rtok = got[1][1]; userJson = got[2][1];
  } catch {
    return null;
  }
  // Only refresh_token + user are actually load-bearing — access_token is
  // explicitly short-lived (15 min) and gets refreshed right below anyway.
  // Requiring it to be present here was wrong: reported symptom was "closed
  // and reopened the app, had to log in again" with NO server restart
  // involved — meaning a perfectly valid 30-day refresh_token (the server
  // never rotates/invalidates it on refresh, see auth.js's /refresh route)
  // was being discarded just because access_token alone was missing/stale,
  // e.g. if the app got killed mid-write during a background proactive
  // refresh (startProactiveRefresh fires every 10 min regardless of
  // foreground state).
  if (!rtok || !userJson) return null;
  let parsedUser: User;
  try {
    parsedUser = JSON.parse(userJson);
  } catch {
    // Corrupted local cache of the display-only user object — the
    // refresh_token is a separate value and untouched by this, but without
    // a /me-style endpoint to re-fetch the profile there's nothing to show
    // until the next real login. Bail out WITHOUT clearing storage (unlike
    // the 'rejected' branch below) — a real login will simply overwrite
    // this same key with fresh, valid JSON next time.
    return null;
  }
  accessToken = tok || null;
  refreshToken = rtok;
  currentUser = parsedUser;
  const r = await tryRefresh().catch((): RefreshResult => 'network_error');
  // The server explicitly rejected the refresh token — this session really
  // is dead, clear it now so the caller correctly shows the login screen.
  // A 'network_error' (cold-start connectivity not up yet, timeout) must
  // NOT be treated the same way — that used to wipe a perfectly valid
  // 30-day refresh token just because the very first request after
  // opening the app happened to be slow, forcing an unnecessary re-login.
  if (r === 'rejected') {
    await AsyncStorage.multiRemove(['access_token', 'refresh_token', 'user']).catch(() => {});
    accessToken = null; refreshToken = null; currentUser = null;
    return null;
  }
  startProactiveRefresh();
  return currentUser;
}

export async function joinLobbyByCode(code: string): Promise<{ lobbyId: string }> {
  const data = await req(`/lobbies/join/${code.trim().toUpperCase()}`);
  return { lobbyId: data.lobby.id };
}

export type ActiveGame =
  | { type: 'none' }
  | { type: 'game'; sessionId: string; lobbyId: string; gameMode: string }
  | { type: 'lobby'; lobbyId: string; code: string; isHost: boolean; gameMode: string };

/** Start-menu "Rejoin" support — does this user still have a live game or an
 *  unstarted lobby worth going back to? See server's GET /lobbies/mine/active
 *  for why this checks the actually-running worker, not just a DB flag. */
export async function getActiveGame(): Promise<ActiveGame> {
  try { return await req('/lobbies/mine/active', undefined, 'GET'); }
  catch { return { type: 'none' }; }
}

/** Create an AR Ops lobby (caller becomes host). Returns id + join code. */
export async function createArLobby(name: string): Promise<{ lobbyId: string; code: string }> {
  const data = await req('/lobbies', {
    name, game_mode: 'ar_ops', max_players: 8, is_public: false,
  });
  return { lobbyId: data.id, code: data.code };
}

/** Host-only: QR data-URL + full join link for the lobby. */
export async function fetchLobbyQr(lobbyId: string): Promise<{ qr: string; code: string; url: string } | null> {
  try { const d = await req(`/lobbies/${lobbyId}/qr`, undefined, 'GET'); return { qr: d.qr, code: d.code, url: d.url }; }
  catch { return null; }
}

/** Extract a lobby code from scanned QR content (join-URL or bare code). */
export function parseLobbyCode(raw: string): string | null {
  // Codes are nanoid(8).toUpperCase() — alphabet includes '-' and '_'
  const m = raw.match(/\/join\/lobby\/([A-Za-z0-9_-]{6,12})/);
  if (m) return m[1]!.toUpperCase();
  if (/^[A-Za-z0-9_-]{6,12}$/.test(raw.trim())) return raw.trim().toUpperCase();
  return null;
}

// Notifies the app that the session is truly dead (server explicitly
// rejected the refresh token) so it can route to LoginScreen immediately,
// the same way req()'s callers already do on a 401. Without this, the two
// tryRefresh() call sites below silently dropped a 'rejected' result: with
// reconnectionAttempts uncapped (see getSocket()'s own comment), a dead
// refresh token now retries connect_error forever instead of ever giving up
// — nothing told the player their session was over, so the lobby just
// looked permanently broken ("lobby not found") until they force-quit and
// relaunched, which is the only path that already handled 'rejected'
// correctly (via restoreSession()). Set once by App.tsx at boot.
let sessionExpiredHandler: (() => void) | null = null;
export function onSessionExpired(cb: () => void): void {
  sessionExpiredHandler = cb;
}
async function handleDeadSession(): Promise<void> {
  await AsyncStorage.multiRemove(['access_token', 'refresh_token', 'user']).catch(() => {});
  accessToken = null; refreshToken = null;
  sessionExpiredHandler?.();
}

/** Shared authenticated socket (created lazily after login). */
export function getSocket(): Socket {
  if (!socket) {
    // Reported: "lobby not found" mid-session (e.g. right after tapping
    // something in the lobby, not tied to a server redeploy), recoverable
    // only by force-quitting the app. Root cause: `reconnectionAttempts: 10`
    // (a previous explicit override of socket.io's own default, which is
    // Infinity) means a sufficiently long connectivity gap — a field test
    // is exactly the kind of place with spotty signal, and the OS also
    // freely suspends both JS timers (startProactiveRefresh's setInterval)
    // and the socket's own transport while the app is backgrounded — can
    // burn through all 10 attempts. Once that happens, socket.io stops
    // retrying *permanently* until something explicitly calls `.connect()`
    // again; nothing in this app ever did, so the socket just stayed dead
    // for the rest of the process's life. lobby:ar_update/lobby:start then
    // never reach the server at all — but from the CLIENT's perspective
    // that's indistinguishable from a real error, and `lobby_not_found` is
    // exactly what a stale in-flight/never-sent request against an old
    // session can surface. Only killing and relaunching the app "fixed" it
    // because that's the only thing that created a fresh socket instance
    // with its attempt counter reset. Dropping the cap (back to socket.io's
    // own Infinity default) means it now keeps retrying with backoff no
    // matter how long the gap is, instead of ever giving up for good.
    socket = io(SERVER_URL, { auth: { token: accessToken } });
    // A stale (expired) access token gets rejected outright by the server's
    // auth middleware on any (re)connect attempt — most likely after sitting
    // in a lobby a long time (no HTTP call around to reactively trigger a
    // refresh, see startProactiveRefresh above) combined with a reconnect
    // (backgrounding, a network drop). Refresh once and nudge a reconnect
    // immediately instead of waiting for socket.io's own backoff schedule.
    socket.on('connect_error', async () => {
      const r = await tryRefresh();
      if (r === 'ok') socket?.connect();
      else if (r === 'rejected') await handleDeadSession();
    });
    // Backgrounded JS timers (startProactiveRefresh) can be paused/throttled
    // by the OS for far longer than 10 minutes, and the transport itself is
    // often suspended too — returning to the foreground is exactly when a
    // stale token / dead socket is most likely, and also exactly when the
    // player is about to tap something. Proactively refresh + reconnect
    // right away instead of waiting for the player's tap to surface it as a
    // confusing "lobby not found".
    appStateSub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      const r = await tryRefresh();
      if (r === 'rejected') { await handleDeadSession(); return; }
      if (socket && !socket.connected) socket.connect();
    });
  }
  return socket;
}

export function resetSocket(): void {
  socket?.disconnect();
  socket = null;
  appStateSub?.remove();
  appStateSub = null;
}

export async function logout(): Promise<void> {
  stopProactiveRefresh();
  await AsyncStorage.multiRemove(['access_token', 'refresh_token', 'user']).catch(() => {});
  accessToken = null; refreshToken = null; currentUser = null;
  resetSocket();
}
