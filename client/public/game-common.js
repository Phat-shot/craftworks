// game-common.js — shared logic for all game modes
'use strict';

// ── Session ────────────────────────────────────────────────────
function getSession() {
  return JSON.parse(sessionStorage.getItem('mp_session') || 'null');
}

// ── Socket bootstrap ───────────────────────────────────────────
// Call this from each game page's connect() function
// Returns the socket. Handles solo_start vs game:join automatically.
function bootstrapGameSocket(opts) {
  // opts: { onSoloStarted, onTick, onVsTick, onTaTick, onActionResult,
  //         onWaveStarted, onWaveEnded, onGameOver, onTaRoundEnd }
  const sess = getSession();
  if (!sess) return null;

  const token = localStorage.getItem('access_token');
  const socket = io({ auth: { token } });

  socket.on('connect', () => {
    if (sess.solo) {
      socket.emit('game:solo_start', {
        difficulty: sess.difficulty || 'normal',
        race:       sess.race       || 'standard',
        workshopConfig: sess.workshopConfig || null,
        mode:       sess.mode       || 'solo',
      });
    } else {
      socket.emit('game:join', { sessionId: sess.sessionId });
    }
  });

  socket.on('game:solo_started', ({ sessionId: sid, mode: m }) => {
    const s = getSession() || {};
    s.sessionId = sid;
    sessionStorage.setItem('mp_session', JSON.stringify(s));
    // Redirect to correct page if needed
    const page = window.location.pathname;
    if ((m === 'td' || m === 'solo' || m === 'coop') && !page.includes('td-game')) {
      window.location.href = '/td-game.html'; return;
    }
    if (m === 'vs' && !page.includes('vs-game')) {
      window.location.href = '/vs-game.html'; return;
    }
    if (m === 'time_attack' && !page.includes('ta-game')) {
      window.location.href = '/ta-game.html'; return;
    }
    opts.onSoloStarted?.({ sessionId: sid, mode: m });
  });

  if (opts.onTick)         socket.on('game:tick',           opts.onTick);
  if (opts.onVsTick)       socket.on('game:vs_tick',        opts.onVsTick);
  if (opts.onTaTick)       socket.on('game:ta_tick',        opts.onTaTick);
  if (opts.onWaveStarted)  socket.on('game:wave_started',   opts.onWaveStarted);
  if (opts.onWaveEnded)    socket.on('game:wave_ended',     opts.onWaveEnded);
  if (opts.onGameOver)     socket.on('game:over',           opts.onGameOver);
  if (opts.onTaRoundEnd)   socket.on('game:ta_round_end',   opts.onTaRoundEnd);
  if (opts.onActionResult) socket.on('game:action_result',  opts.onActionResult);

  return socket;
}

function sendGameAction(socket, sessionId, action, data = {}) {
  if (!socket)    { console.warn('No socket'); return; }
  if (!sessionId) { console.warn('No sessionId yet'); return; }
  socket.emit('game:action', { sessionId, action, data });
}

function quitToLobby(socket) {
  if (confirm('Spiel beenden?')) {
    socket?.disconnect();
    sessionStorage.removeItem('mp_session');
    window.location.href = '/';
  }
}
