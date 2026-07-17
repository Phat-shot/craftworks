'use strict';
// ═══════════════════════════════════════════════════════════
//  GAME MANAGER
//  Creates/destroys Worker Threads for each game session.
//  Bridges between Socket.io (main thread) and game workers.
// ═══════════════════════════════════════════════════════════
const { Worker } = require('worker_threads');
const path = require('path');

const WORKER_PATH = path.join(__dirname, 'worker.js');

class GameManager {
  constructor() {
    this._games = new Map(); // sessionId -> { worker, listeners }
    this._reqId = 0;
    this._pending = new Map(); // reqId -> { resolve, reject }
  }

  // Create a new game in a worker thread
  create(sessionId, { difficulty, mode, players, playerRaces, workshopConfig }) {
    if (this._games.has(sessionId)) return;

    const worker = new Worker(WORKER_PATH);
    const listeners = new Map(); // event -> Set of callbacks

    // Route messages from worker to registered listeners
    worker.on('message', (msg) => {
      const cbs = listeners.get(msg.type);
      if (cbs) cbs.forEach(cb => cb(msg));

      // Resolve action_result promises
      if (msg.type === 'action_result' && this._pending.has(msg.reqId)) {
        const { resolve } = this._pending.get(msg.reqId);
        this._pending.delete(msg.reqId);
        resolve(msg.result);
      }
    });

    worker.on('error', err => {
      console.error(`[GameWorker:${sessionId}] Error:`, err.message);
      this.destroy(sessionId);
    });

    worker.on('exit', code => {
      if (code !== 0) console.warn(`[GameWorker:${sessionId}] Exited with code ${code}`);
      this._games.delete(sessionId);
    });

    this._games.set(sessionId, { worker, listeners });

    // Initialize the game in the worker
    worker.postMessage({ type:'init', sessionId, difficulty, mode, players, playerRaces, workshopConfig });
  }

  // Send an action, returns Promise<result>
  action(sessionId, userId, action, data) {
    const game = this._games.get(sessionId);
    if (!game) return Promise.resolve({ ok:false, err:'no_session' });

    return new Promise((resolve, reject) => {
      const reqId = ++this._reqId;
      this._pending.set(reqId, { resolve, reject });
      game.worker.postMessage({ type:'action', action, userId, data, reqId });
      // Timeout after 2s
      setTimeout(() => {
        if (this._pending.has(reqId)) {
          this._pending.delete(reqId);
          resolve({ ok:false, err:'timeout' });
        }
      }, 2000);
    });
  }

  // Register event listener for a session
  on(sessionId, event, callback) {
    const game = this._games.get(sessionId);
    if (!game) return;
    if (!game.listeners.has(event)) game.listeners.set(event, new Set());
    game.listeners.get(event).add(callback);
  }

  off(sessionId, event, callback) {
    const game = this._games.get(sessionId);
    if (!game) return;
    game.listeners.get(event)?.delete(callback);
  }

  destroy(sessionId) {
    const game = this._games.get(sessionId);
    if (!game) return;
    game.worker.postMessage({ type:'stop' });
    setTimeout(() => game.worker.terminate(), 500);
    this._games.delete(sessionId);
  }

  has(sessionId) { return this._games.has(sessionId); }

  get count() { return this._games.size; }
}

// Singleton
module.exports = new GameManager();
