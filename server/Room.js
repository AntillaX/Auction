const Game = require('./Game');
const GameX = require('./GameX');
const Player = require('./Player');

const MAX_PLAYERS_AUCTION = 5;
const MAX_PLAYERS_AUCTIONX = 4;
const MIN_PLAYERS_NO_BOTS = 3;
const LAST_PLAYER_GRACE_MS = 10000;
const BOT_NAMES = ['Allegri', 'Conte', 'Simeone', 'Ancelotti', 'Mourinho'];

class Room {
  constructor(code, mode = 'auction') {
    this.code = code;
    this.mode = mode;
    this.players = new Map();
    this.hostId = null;
    this.game = null;
    this.state = 'lobby';
    this.lastPlayerTimer = null;
  }

  get maxPlayers() {
    return this.mode === 'auctionx' ? MAX_PLAYERS_AUCTIONX : MAX_PLAYERS_AUCTION;
  }

  connectedCount(humansOnly = false) {
    let n = 0;
    for (const [, p] of this.players) {
      if (p.connected && (!humansOnly || !p.isBot)) n++;
    }
    return n;
  }

  firstConnectedHumanId() {
    for (const [id, p] of this.players) {
      if (p.connected && !p.isBot) return id;
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
    if (this.players.size >= this.maxPlayers) {
      return { success: false, error: `Room is full (max ${this.maxPlayers} players)` };
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

    // If no human players remain connected, start a grace timer.
    // With bots the game is technically playable, but a match with
    // zero humans watching is pointless — end it after the grace
    // window unless someone reconnects.
    if (this.state === 'playing' && this.game && this.game.state !== 'finished') {
      const humanCount = this.connectedCount(true);
      if (humanCount === 0 && !this.lastPlayerTimer) {
        this.broadcast({
          type: 'last_player_warning',
          survivorId: null,
          graceMs: LAST_PLAYER_GRACE_MS,
        });
        this.lastPlayerTimer = setTimeout(() => {
          this.lastPlayerTimer = null;
          if (!this.game || this.game.state === 'finished') return;
          if (this.connectedCount(true) > 0) return;
          this.state = 'finished';
          this.game.endGame('all_left');
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
    if (this.lastPlayerTimer && this.connectedCount(true) > 0) {
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
      if (player.connected && !player.isBot) return false;
    }
    return true;
  }

  fillBots() {
    let i = 0;
    while (this.players.size < this.maxPlayers && i < BOT_NAMES.length) {
      const botId = `bot_${i}`;
      if (!this.players.has(botId)) {
        const bot = new Player(botId, BOT_NAMES[i], null, true);
        this.players.set(botId, bot);
      }
      i++;
    }
  }

  canStartWithoutBots() {
    return this.connectedCount(true) >= MIN_PLAYERS_NO_BOTS;
  }

  startGame(noBots = false) {
    if (this.state !== 'lobby') return;
    if (!noBots) this.fillBots();
    this.state = 'playing';
    const GameClass = this.mode === 'auctionx' ? GameX : Game;
    this.game = new GameClass(this.players, this.broadcast.bind(this));
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
      mode: this.mode,
      canStartWithoutBots: this.canStartWithoutBots(),
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
