const Game = require('./Game');
const Player = require('./Player');

const MAX_PLAYERS = 5;
const LAST_PLAYER_GRACE_MS = 10000;

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.hostId = null;
    this.game = null;
    this.state = 'lobby'; // lobby | playing | finished
    this.lastPlayerTimer = null;
  }

  connectedCount() {
    let n = 0;
    for (const [, p] of this.players) {
      if (p.connected) n++;
    }
    return n;
  }

  firstConnectedId() {
    for (const [id, p] of this.players) {
      if (p.connected) return id;
    }
    return null;
  }

  clearLastPlayerTimer() {
    if (this.lastPlayerTimer) {
      clearTimeout(this.lastPlayerTimer);
      this.lastPlayerTimer = null;
    }
  }

  addPlayer(playerId, name, ws) {
    if (this.players.size >= MAX_PLAYERS) {
      return { success: false, error: 'Room is full (max 5 players)' };
    }
    if (this.state !== 'lobby') {
      return { success: false, error: 'Game already in progress' };
    }

    const player = new Player(playerId, name, ws);
    this.players.set(playerId, player);

    if (!this.hostId) {
      this.hostId = playerId;
    }

    return { success: true };
  }

  getPlayer(playerId) {
    return this.players.get(playerId);
  }

  playerDisconnected(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    const playerName = player.name;
    player.connected = false;
    player.ws = null;

    if (this.state === 'lobby') {
      this.players.delete(playerId);
      if (this.hostId === playerId) {
        const next = this.players.keys().next();
        this.hostId = next.done ? null : next.value;
      }
      this.broadcast({
        type: 'player_left',
        playerId,
        playerName,
        ...this.getState(),
      });
      return;
    }

    this.broadcast({
      type: 'player_disconnected',
      playerId,
      playerName,
      ...this.getState(),
    });

    // If we were waiting on ready signals, a disconnect may itself
    // satisfy "all remaining connected players ready".
    if (this.game && (this.game.state === 'study' || this.game.state === 'finished')) {
      this.game.reconsiderReady();
    }

    // If the game is still in progress and only one player remains
    // connected, start a grace timer. If nobody rejoins within the
    // window, end the game with the lone survivor as the winner.
    if (this.state === 'playing' && this.game && this.game.state !== 'finished') {
      const connected = this.connectedCount();
      if (connected <= 1 && !this.lastPlayerTimer) {
        const survivorId = this.firstConnectedId();
        this.broadcast({
          type: 'last_player_warning',
          survivorId,
          graceMs: LAST_PLAYER_GRACE_MS,
        });
        this.lastPlayerTimer = setTimeout(() => {
          this.lastPlayerTimer = null;
          if (!this.game || this.game.state === 'finished') return;
          if (this.connectedCount() > 1) return;
          const winnerId = this.firstConnectedId();
          this.state = 'finished';
          this.game.endGame('last_player_standing', winnerId);
        }, LAST_PLAYER_GRACE_MS);
      }
    }
  }

  reconnectPlayer(playerId, ws) {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, error: 'Player not found in this room' };
    }
    player.ws = ws;
    player.connected = true;

    // Somebody came back before the grace timer fired — cancel the
    // auto-win and let everyone know the countdown is off.
    if (this.lastPlayerTimer && this.connectedCount() > 1) {
      this.clearLastPlayerTimer();
      this.broadcast({
        type: 'last_player_cleared',
        ...this.getState(),
      });
    }
    // Rebroadcast ready state so the newcomer sees the current counts.
    if (this.game && (this.game.state === 'study' || this.game.state === 'finished')) {
      this.game.broadcastReadyState();
    }
    return { success: true };
  }

  isEmpty() {
    if (this.players.size === 0) return true;
    for (const [, player] of this.players) {
      if (player.connected) return false;
    }
    return true;
  }

  startGame() {
    if (this.state !== 'lobby') return;
    if (this.players.size < 2) return;

    this.state = 'playing';
    this.game = new Game(this.players, this.broadcast.bind(this));
    this.game.start();
  }

  // "Ready" button pressed by a player — routes through the game,
  // which decides whether it's a study-phase ready or a play-again
  // ready based on its current state.
  markReady(playerId) {
    if (!this.game) return;
    this.game.markReady(playerId);
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const [, player] of this.players) {
      if (player.connected && player.ws && player.ws.readyState === 1) {
        player.ws.send(data);
      }
    }
  }

  broadcastExcept(excludeId, msg) {
    const data = JSON.stringify(msg);
    for (const [id, player] of this.players) {
      if (id !== excludeId && player.connected && player.ws && player.ws.readyState === 1) {
        player.ws.send(data);
      }
    }
  }

  getState() {
    return {
      roomCode: this.code,
      hostId: this.hostId,
      roomState: this.state,
      players: this.getPlayersArray(),
    };
  }

  getFullGameState() {
    const state = this.getState();
    if (this.game) {
      Object.assign(state, this.game.getFullState());
    }
    return state;
  }

  getPlayersArray() {
    const arr = [];
    for (const [, player] of this.players) {
      arr.push(player.toJSON());
    }
    return arr;
  }

  destroy() {
    this.clearLastPlayerTimer();
    if (this.game) {
      this.game.destroy();
    }
  }
}

module.exports = Room;
