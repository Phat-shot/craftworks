import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import { SERVER_URL } from './config';

export interface User { id: string; username: string; avatar_color?: string; }

let accessToken: string | null = null;
let refreshToken: string | null = null;
let currentUser: User | null = null;
let socket: Socket | null = null;

export function getUser(): User | null { return currentUser; }

/** Access tokens expire after 15 min — transparently refresh and retry once. */
async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const d = await res.json();
    if (!d.access_token) return false;
    accessToken = d.access_token;
    const sets: [string, string][] = [['access_token', d.access_token]];
    if (d.refresh_token) { refreshToken = d.refresh_token; sets.push(['refresh_token', d.refresh_token]); }
    await AsyncStorage.multiSet(sets);
    // Keep the socket usable after reconnects
    if (socket) (socket.auth as any) = { token: accessToken };
    return true;
  } catch {
    return false;
  }
}

async function req(path: string, body?: unknown, method = 'POST', retry = true): Promise<any> {
  const res = await fetch(`${SERVER_URL}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && retry) {
      if (await tryRefresh()) return req(path, body, method, false);
      // Refresh failed → session is truly dead; clear it so next boot re-logins
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
  return data.user;
}

/** Try restoring a previous session from storage. */
export async function restoreSession(): Promise<User | null> {
  const [[, tok], [, rtok], [, userJson]] = await AsyncStorage.multiGet(['access_token', 'refresh_token', 'user']);
  if (!tok || !userJson) return null;
  accessToken = tok;
  refreshToken = rtok || null;
  currentUser = JSON.parse(userJson);
  // Proactively refresh: the stored access token is likely older than its 15 min TTL
  if (refreshToken) await tryRefresh();
  return currentUser;
}

export async function joinLobbyByCode(code: string): Promise<{ lobbyId: string }> {
  const data = await req(`/lobbies/join/${code.trim().toUpperCase()}`);
  return { lobbyId: data.lobby.id };
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

/** Shared authenticated socket (created lazily after login). */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, { auth: { token: accessToken }, reconnectionAttempts: 10 });
  }
  return socket;
}

export function resetSocket(): void {
  socket?.disconnect();
  socket = null;
}

export async function logout(): Promise<void> {
  await AsyncStorage.multiRemove(['access_token', 'refresh_token', 'user']).catch(() => {});
  accessToken = null; refreshToken = null; currentUser = null;
  resetSocket();
}
