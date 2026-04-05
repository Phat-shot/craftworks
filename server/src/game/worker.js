'use strict';
// ═══════════════════════════════════════════════════════════
//  GAME WORKER — runs inside a Worker Thread
//  Each active game session gets its own thread.
//  Communicates with main thread via postMessage.
// ═══════════════════════════════════════════════════════════
const { parentPort, workerData } = require('worker_threads');
const engine = require('./engine');

let gs = null;
let intervalId = null;
const TICK_RATE = 20;

// ── Receive messages from main thread ──────────────────────
parentPort.on('message', (msg) => {
  switch (msg.type) {

    case 'init':
      if (msg.mode === 'vs') {
        gs = engine.createVsGame(msg.sessionId, msg.players, msg.playerRaces, msg.workshopConfig);
      } else if (msg.mode === 'time_attack') {
        gs = engine.createTimeAttackGame(msg.sessionId, msg.players, msg.workshopConfig);
      } else if (msg.mode === 'pve') {
        gs = engine.createPveGame(msg.sessionId, msg.players, msg.playerRaces, msg.workshopConfig);
      } else {
        gs = engine.createGame(msg.sessionId, msg.difficulty, msg.mode, msg.players, msg.playerRaces, msg.workshopConfig);
      }
      startLoop();
      break;

    case 'action':
      if (!gs) break;
      handleAction(msg);
      break;

    case 'stop':
      stopLoop();
      break;
  }
});

function handleAction({ action, userId, data, reqId }) {
  if (!gs) return;
  let result;
  switch (action) {
    case 'place_tower':  result = engine.actionPlaceTower(gs, userId, data.type, data.row, data.col); break;
    case 'upgrade_path': result = engine.actionUpgradePath(gs, userId, data.towerId, data.pi); break;
    case 'sell_tower':   result = engine.actionSellTower(gs, userId, data.towerId); break;
    case 'start_wave':   result = engine.actionStartWave(gs, userId); break;
    // VS actions
    // VS actions
    case 'build_unit':      result = engine.actionBuildUnit(gs, userId, data); break;
    case 'move_unit':       result = engine.actionMoveUnit(gs, userId, data); break;
    case 'attack_move':     result = engine.actionAttackMove(gs, userId, data); break;
    case 'build_structure': result = engine.actionBuildStructure(gs, userId, data); break;
    // Time Attack actions
    case 'ta_place_tower':  result = engine.actionTaPlaceTower(gs, userId, data); break;
    case 'ta_ready':        result = engine.actionTaReady(gs, userId); break;
    case 'ta_remove_tower': result = engine.actionTaRemoveTower(gs, userId, data); break;
    default: result = { ok:false, err:'unknown_action' };
  }
  parentPort.postMessage({ type: 'action_result', reqId, result });
}

function startLoop() {
  if (intervalId) return;
  intervalId = setInterval(tick, 1000 / TICK_RATE);
}

function stopLoop() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  gs = null;
}

function tick() {
  if (!gs || gs.gameOver) {
    if (gs?.gameOver && !gs._gameOverEmitted) {
      gs._gameOverEmitted = true;
      // Annotate players with per-game metadata for finalizer
      const playersOut = {};
      for (const [uid, p] of Object.entries(gs.players)) {
        playersOut[uid] = { ...p, wave: gs.wave||0, difficulty: gs.difficulty||'normal', mode: gs.mode||'solo' };
      }
      parentPort.postMessage({ type:'game_over', win:gs._gameOverWin||false, players:playersOut });
      stopLoop();
    }
    return;
  }

  const mode = gs.mode;

  if (mode === 'vs') {
    engine.tickVs(gs);
    // Per-player snapshots for fog of war
    for (const uid of Object.keys(gs.players)) {
      parentPort.postMessage({ type:'vs_tick', userId:uid, snap:engine.getVsSnapshot(gs, uid) });
    }

  } else if (mode === 'time_attack') {
    engine.tickTimeAttack(gs);
    // Emit per-player TA snapshots
    for (const uid of Object.keys(gs.players)) {
      parentPort.postMessage({ type:'ta_tick', userId:uid, snap:engine.getTaSnapshot(gs, uid) });
    }
    if (gs._roundJustEnded) {
      gs._roundJustEnded = false;
      parentPort.postMessage({ type:'ta_round_end', round:gs.round, players:gs.players });
    }
  } else if (mode === 'pve') {
    engine.tickPve(gs);
    for (const uid of Object.keys(gs.players)) {
      parentPort.postMessage({ type:'ta_tick', userId:uid, snap:engine.getTaSnapshot(gs, uid) });
    }
    if (gs._roundJustEnded) {
      gs._roundJustEnded = false;
      parentPort.postMessage({ type:'ta_round_end', round:gs.round, players:gs.players });
    }

  } else {
    // TD / solo / coop
    engine.tick(gs);
    const snap = engine.getSnapshot(gs);
    parentPort.postMessage({ type:'tick', snap });
    if (gs._waveJustStarted) { gs._waveJustStarted = false; parentPort.postMessage({ type:'wave_started', wave:gs.wave }); }
    if (gs._waveJustEnded)   { gs._waveJustEnded   = false; parentPort.postMessage({ type:'wave_ended',   wave:gs.wave, bonus:gs._waveEndBonus||0 }); }
  }
}
