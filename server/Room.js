const Game = require('./Game');
const Player = require('./Player');

const MAX_PLAYERS = 5;

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.hostId = null;
    this.game = null;
    this.state = 'lobby'; // lobby | playing | finished
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
        ...this.getState(),
      });
    } else {
      this.broadcast({
        type: 'player_disconnected',
        playerId,
        ...this.getState(),
      });
    }
  }

  reconnectPlayer(playerId, ws) {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, error: 'Player not found in this room' };
    }
    player.ws = ws;
    player.connected = true;
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

  startAuctions() {
    if (!this.game) return;
    this.game.startAuctions();
  }

  playAgain() {
    if (!this.game) return;
    this.game.reset();
    this.game.start();
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
    if (this.game) {
      this.game.destroy();
    }
  }
}

module.exports = Room;
