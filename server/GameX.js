const BotAIX = require('./BotAIX');

const TEAM_SIZE = 11;
const MIN_SCORE = 1000;
const MIN_OPENING_BID = 50;
const MIN_BID_INCREMENT = 5;
const TIMER_DURATION = 10000;
const DELAY_CARD_WON = 2500;
const DELAY_CARD_PASSED = 1500;
const STUDY_AUTOSTART_MS = 45000;
const BOT_BID_DELAY_MIN = 1200;
const BOT_BID_DELAY_MAX = 3500;
const BOT_READY_DELAY_MIN = 800;
const BOT_READY_DELAY_MAX = 2000;

const TEAM_REQS = { gk: 1, def: 3, mid: 3, att: 2 };
const MAX_GK = 2;

function posCategory(pos) {
  if (pos === 'GK') return 'gk';
  if (['CB', 'LB', 'RB'].includes(pos)) return 'def';
  if (['CM', 'CAM', 'RM'].includes(pos)) return 'mid';
  return 'att';
}

function countCategories(cards) {
  const counts = { gk: 0, def: 0, mid: 0, att: 0 };
  for (const c of cards) counts[posCategory(c.position)]++;
  return counts;
}

function hasValidTeam(player) {
  if (player.cardsWon.length < TEAM_SIZE) return false;
  if (player.score < MIN_SCORE) return false;
  const counts = countCategories(player.cardsWon);
  if (counts.gk < TEAM_REQS.gk) return false;
  if (counts.gk > MAX_GK) return false;
  if (counts.def < TEAM_REQS.def) return false;
  if (counts.mid < TEAM_REQS.mid) return false;
  if (counts.att < TEAM_REQS.att) return false;
  return true;
}

function ownsPlayer(player, cardName) {
  return player.cardsWon.some((c) => c.name === cardName);
}

class GameX {
  constructor(players, broadcast) {
    this.players = players;
    this.broadcast = broadcast;
    this.originalDeck = [];
    this.deck = [];
    this.discardPile = [];
    this.currentIndex = 0;
    this.currentCard = null;
    this.highestBid = 0;
    this.highestBidderId = null;
    this.timerTimeout = null;
    this.timerRemaining = 0;
    this.timerStartedAt = 0;
    this.state = 'study';
    this.roundNumber = 0;
    this.inDiscardPhase = false;
    this.cardsBoughtThisPass = 0;
    this.consecutiveEmptyPasses = 0;
    this.nextCardTimeout = null;
    this.extendedBy = new Set();
    this.readyPlayers = new Set();
    this.studyAutoStartTimeout = null;
    this.studyAutoStartAt = 0;
    this.botTimeouts = [];
    this.mode = 'auctionx';
  }

  generateDeck() {
    return [
      // 100 (2)
      { name: 'Messi', value: 100, position: 'RW' },
      { name: 'Pedri', value: 100, position: 'CM' },
      // 98 (7)
      { name: 'Ronaldo', value: 98, position: 'LW' },
      { name: 'Neuer', value: 98, position: 'GK' },
      { name: 'Lamine Yamal', value: 98, position: 'RW' },
      { name: 'Van Dijk', value: 98, position: 'CB' },
      { name: 'Mbappé', value: 98, position: 'ST' },
      { name: 'Iniesta', value: 98, position: 'CM' },
      { name: 'Xavi', value: 98, position: 'CM' },
      // 95 (11)
      { name: 'Neymar', value: 95, position: 'LW' },
      { name: 'Zidane', value: 95, position: 'CAM' },
      { name: 'Ronaldinho', value: 95, position: 'CAM' },
      { name: 'Ramos', value: 95, position: 'CB' },
      { name: 'Buffon', value: 95, position: 'GK' },
      { name: 'Casillas', value: 95, position: 'GK' },
      { name: 'Maradona', value: 95, position: 'CF' },
      { name: 'Cruyff', value: 95, position: 'CF' },
      { name: 'Beckenbauer', value: 95, position: 'CB' },
      { name: 'Kroos', value: 95, position: 'CM' },
      { name: 'Beckham', value: 95, position: 'RM' },
      // 92 (7)
      { name: 'Ronaldo', value: 92, position: 'LW' },
      { name: 'Neuer', value: 92, position: 'GK' },
      { name: 'Modric', value: 92, position: 'CM' },
      { name: 'De Bruyne', value: 92, position: 'CAM' },
      { name: 'Courtois', value: 92, position: 'GK' },
      { name: 'De Gea', value: 92, position: 'GK' },
      { name: 'Ter Stegen', value: 92, position: 'GK' },
      // 88 (12)
      { name: 'Mbappé', value: 88, position: 'ST' },
      { name: 'Neymar', value: 88, position: 'LW' },
      { name: 'Zidane', value: 88, position: 'CAM' },
      { name: 'Beckham', value: 88, position: 'RM' },
      { name: 'Haaland', value: 88, position: 'ST' },
      { name: 'Jordi Alba', value: 88, position: 'LB' },
      { name: 'Piqué', value: 88, position: 'CB' },
      { name: 'Puyol', value: 88, position: 'CB' },
      { name: 'Carvajal', value: 88, position: 'RB' },
      { name: 'Marcelo', value: 88, position: 'LB' },
      { name: 'Ramos', value: 88, position: 'CB' },
      { name: 'Van Dijk', value: 88, position: 'CB' },
      // 85 (6)
      { name: 'Modric', value: 85, position: 'CM' },
      { name: 'Carvajal', value: 85, position: 'RB' },
      { name: 'Marcelo', value: 85, position: 'LB' },
      { name: 'Bellingham', value: 85, position: 'CM' },
      { name: 'Lingard', value: 85, position: 'CM' },
      { name: 'Maguire', value: 85, position: 'CB' },
    ];
  }

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  start() {
    this.originalDeck = this.shuffle(this.generateDeck());
    this.deck = [...this.originalDeck];
    this.currentIndex = 0;
    this.discardPile = [];
    this.state = 'study';
    this.roundNumber = 0;
    this.inDiscardPhase = false;
    this.cardsBoughtThisPass = 0;
    this.consecutiveEmptyPasses = 0;
    this.extendedBy = new Set();
    this.readyPlayers = new Set();

    this.clearStudyAutoStart();
    this.studyAutoStartAt = Date.now() + STUDY_AUTOSTART_MS;
    this.studyAutoStartTimeout = setTimeout(() => {
      if (this.state === 'study') this.startAuctionsNow();
    }, STUDY_AUTOSTART_MS);

    this.broadcast({
      type: 'game_started',
      ...this.getFullState(),
    });

    this.scheduleBotReady();
  }

  clearStudyAutoStart() {
    if (this.studyAutoStartTimeout) {
      clearTimeout(this.studyAutoStartTimeout);
      this.studyAutoStartTimeout = null;
    }
  }

  clearBotTimeouts() {
    for (const t of this.botTimeouts) clearTimeout(t);
    this.botTimeouts = [];
  }

  scheduleBotReady() {
    this.clearBotTimeouts();
    for (const [id, player] of this.players) {
      if (!player.isBot) continue;
      const delay = BOT_READY_DELAY_MIN +
        Math.random() * (BOT_READY_DELAY_MAX - BOT_READY_DELAY_MIN);
      this.botTimeouts.push(setTimeout(() => this.markReady(id), delay));
    }
  }

  scheduleBotBids() {
    this.clearBotTimeouts();
    if (this.state !== 'auction') return;

    for (const [id, player] of this.players) {
      if (!player.isBot) continue;
      if (id === this.highestBidderId) continue;
      if (!player.canAfford(this.getMinimumBid())) continue;
      if (ownsPlayer(player, this.currentCard.name)) continue;

      const noBidsYet = !this.highestBidderId;
      if (noBidsYet && !BotAIX.willStartBid(player, this.currentCard)) continue;

      const maxBid = BotAIX.calculateMaxBid(player, this.currentCard, this);
      if (maxBid < this.getMinimumBid()) continue;

      const delay = BOT_BID_DELAY_MIN +
        Math.random() * (BOT_BID_DELAY_MAX - BOT_BID_DELAY_MIN);
      this.botTimeouts.push(setTimeout(() => {
        if (this.state !== 'auction') return;
        if (id === this.highestBidderId) return;
        const bid = this.getMinimumBid();
        if (bid <= maxBid && player.canAfford(bid)) {
          this.placeBid(id, bid);
        }
      }, delay));
    }
  }

  getConnectedIds() {
    const ids = [];
    for (const [id, p] of this.players) {
      if (p.connected) ids.push(id);
    }
    return ids;
  }

  markReady(playerId) {
    const player = this.players.get(playerId);
    if (!player || !player.connected) return;
    if (this.state !== 'study' && this.state !== 'finished') return;
    if (this.readyPlayers.has(playerId)) return;

    this.readyPlayers.add(playerId);
    this.broadcastReadyState();

    if (this.state === 'study') {
      this.maybeStartAuctions();
    } else if (this.state === 'finished') {
      this.maybePlayAgain();
    }
  }

  reconsiderReady() {
    if (this.state === 'study') this.maybeStartAuctions();
    else if (this.state === 'finished') this.maybePlayAgain();
    if (this.state === 'study' || this.state === 'finished') {
      this.broadcastReadyState();
    }
  }

  broadcastReadyState() {
    this.broadcast({
      type: 'ready_update',
      phase: this.state === 'finished' ? 'play_again' : 'study',
      readyIds: Array.from(this.readyPlayers),
      connectedIds: this.getConnectedIds(),
      studyAutoStartAt: this.state === 'study' ? this.studyAutoStartAt : 0,
    });
  }

  allConnectedReady() {
    const connected = this.getConnectedIds();
    if (connected.length === 0) return false;
    return connected.every((id) => this.readyPlayers.has(id));
  }

  maybeStartAuctions() {
    if (this.state !== 'study') return;
    if (!this.allConnectedReady()) return;
    this.startAuctionsNow();
  }

  maybePlayAgain() {
    if (this.state !== 'finished') return;
    if (!this.allConnectedReady()) return;
    if (this.getConnectedIds().length < 2) return;
    this.reset();
    this.start();
  }

  startAuctionsNow() {
    if (this.state !== 'study') return;
    this.clearStudyAutoStart();
    this.readyPlayers = new Set();
    this.presentNextCard();
  }

  presentNextCard() {
    if (this.currentIndex >= this.deck.length) {
      if (this.discardPile.length === 0) {
        this.endGame('deck_exhausted');
        return;
      }

      if (this.inDiscardPhase) {
        if (this.cardsBoughtThisPass === 0) {
          this.consecutiveEmptyPasses++;
          if (this.consecutiveEmptyPasses >= 2) {
            this.endGame('stalemate');
            return;
          }
        } else {
          this.consecutiveEmptyPasses = 0;
        }
      }

      this.deck = [...this.discardPile];
      this.discardPile = [];
      this.currentIndex = 0;
      this.inDiscardPhase = true;
      this.cardsBoughtThisPass = 0;
    }

    if (this.allBroke()) {
      this.endGame('all_broke');
      return;
    }

    this.extendedBy = new Set();
    this.currentCard = this.deck[this.currentIndex];
    this.highestBid = 0;
    this.highestBidderId = null;
    this.roundNumber++;
    this.state = 'auction';

    this.timerRemaining = TIMER_DURATION;
    this.timerStartedAt = Date.now();

    this.broadcast({
      type: 'new_auction',
      ...this.getFullState(),
    });

    this.startTimer();
    this.scheduleBotBids();
  }

  startTimer() {
    this.clearTimer();
    this.timerRemaining = TIMER_DURATION;
    this.timerStartedAt = Date.now();
    this.timerTimeout = setTimeout(() => this.resolveAuction(), TIMER_DURATION);
  }

  resetTimer() {
    this.clearTimer();
    this.timerRemaining = TIMER_DURATION;
    this.timerStartedAt = Date.now();
    this.timerTimeout = setTimeout(() => this.resolveAuction(), TIMER_DURATION);
  }

  clearTimer() {
    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }
    if (this.nextCardTimeout) {
      clearTimeout(this.nextCardTimeout);
      this.nextCardTimeout = null;
    }
  }

  placeBid(playerId, amount) {
    if (this.state !== 'auction') {
      return { success: false, error: 'No auction in progress' };
    }

    const player = this.players.get(playerId);
    if (!player) return { success: false, error: 'Player not found' };
    if (!player.connected) return { success: false, error: 'Player is disconnected' };

    if (ownsPlayer(player, this.currentCard.name)) {
      return { success: false, error: 'You already own this player' };
    }

    if (typeof amount !== 'number' || !Number.isInteger(amount)) {
      return { success: false, error: 'Invalid bid amount' };
    }
    if (amount % MIN_BID_INCREMENT !== 0) {
      return { success: false, error: 'Bid must be in $5 increments' };
    }
    if (!player.canAfford(amount)) {
      return { success: false, error: 'Cannot afford this bid' };
    }

    if (this.highestBid === 0) {
      if (amount < MIN_OPENING_BID) {
        return { success: false, error: `Minimum opening bid is $${MIN_OPENING_BID}` };
      }
    } else {
      if (amount < this.highestBid + MIN_BID_INCREMENT) {
        return { success: false, error: `Minimum bid is $${this.highestBid + MIN_BID_INCREMENT}` };
      }
    }

    if (playerId === this.highestBidderId) {
      return { success: false, error: 'You are already the highest bidder' };
    }

    this.highestBid = amount;
    this.highestBidderId = playerId;
    this.resetTimer();

    this.broadcast({
      type: 'bid_placed',
      playerId,
      playerName: player.name,
      amount,
      ...this.getFullState(),
    });

    this.scheduleBotBids();
    return { success: true };
  }

  extendTime(playerId) {
    if (this.state !== 'auction') {
      return { success: false, error: 'No auction in progress' };
    }
    const player = this.players.get(playerId);
    if (!player) return { success: false, error: 'Player not found' };
    if (!player.connected) return { success: false, error: 'Player is disconnected' };
    if (this.extendedBy.has(playerId)) {
      return { success: false, error: 'Already used your extension this round' };
    }

    this.extendedBy.add(playerId);
    this.resetTimer();

    this.broadcast({
      type: 'time_extended',
      playerId,
      playerName: player.name,
      ...this.getFullState(),
    });

    this.scheduleBotBids();
    return { success: true };
  }

  resolveAuction() {
    this.clearBotTimeouts();
    this.state = 'between_rounds';
    let delay;

    if (this.highestBidderId) {
      const winner = this.players.get(this.highestBidderId);
      winner.deductBudget(this.highestBid);
      winner.addCard(this.currentCard);
      this.currentIndex++;

      if (this.inDiscardPhase) {
        this.cardsBoughtThisPass++;
      }

      this.broadcast({
        type: 'card_won',
        playerId: this.highestBidderId,
        playerName: winner.name,
        amount: this.highestBid,
        cardValue: this.currentCard,
        ...this.getFullState(),
      });

      if (hasValidTeam(winner)) {
        this.endGame('team_complete', this.highestBidderId);
        return;
      }

      delay = DELAY_CARD_WON;
    } else {
      this.discardPile.push(this.currentCard);
      this.currentIndex++;

      this.broadcast({
        type: 'card_passed',
        cardValue: this.currentCard,
        ...this.getFullState(),
      });

      delay = DELAY_CARD_PASSED;
    }

    if (this.allBroke()) {
      this.endGame('all_broke');
      return;
    }

    this.nextCardTimeout = setTimeout(() => {
      if (this.state === 'between_rounds') {
        this.presentNextCard();
      }
    }, delay);
  }

  allBroke() {
    for (const [, player] of this.players) {
      if (player.budget >= MIN_OPENING_BID) return false;
    }
    return true;
  }

  endGame(reason, winnerId = null) {
    this.state = 'finished';
    this.clearTimer();
    this.clearStudyAutoStart();
    this.clearBotTimeouts();
    this.readyPlayers = new Set();

    if (!winnerId) {
      let bestCards = -1;
      let bestScore = -1;
      for (const [id, player] of this.players) {
        const cards = player.cardsWon.length;
        if (cards > bestCards || (cards === bestCards && player.score > bestScore)) {
          bestCards = cards;
          bestScore = player.score;
          winnerId = id;
        }
      }
    }

    const winner = this.players.get(winnerId);
    this.broadcast({
      type: 'game_over',
      winnerId,
      winnerName: winner ? winner.name : 'Unknown',
      reason,
      ...this.getFullState(),
    });

    this.scheduleBotReady();
  }

  getMinimumBid() {
    if (this.highestBid === 0) return MIN_OPENING_BID;
    return this.highestBid + MIN_BID_INCREMENT;
  }

  getRemainingCards() {
    return this.deck.slice(this.currentIndex + 1);
  }

  getFullState() {
    return {
      gameState: this.state,
      mode: 'auctionx',
      players: this.getPlayersArray(),
      originalDeck: this.originalDeck,
      deck: this.deck,
      currentIndex: this.currentIndex,
      currentCard: this.currentCard,
      discardPile: this.discardPile,
      highestBid: this.highestBid,
      highestBidderId: this.highestBidderId,
      timerRemaining: this.timerRemaining,
      timerStartedAt: this.timerStartedAt,
      roundNumber: this.roundNumber,
      minimumBid: this.getMinimumBid(),
      remainingCards: this.getRemainingCards(),
      inDiscardPhase: this.inDiscardPhase,
      extendedBy: Array.from(this.extendedBy),
      readyIds: Array.from(this.readyPlayers),
      connectedIds: this.getConnectedIds(),
      studyAutoStartAt: this.state === 'study' ? this.studyAutoStartAt : 0,
      teamSize: TEAM_SIZE,
      minScore: MIN_SCORE,
    };
  }

  getPlayersArray() {
    const arr = [];
    for (const [, player] of this.players) {
      arr.push(player.toJSON());
    }
    return arr;
  }

  reset() {
    this.clearTimer();
    this.clearStudyAutoStart();
    this.clearBotTimeouts();
    for (const [, player] of this.players) {
      player.reset();
    }
    this.originalDeck = [];
    this.deck = [];
    this.discardPile = [];
    this.currentIndex = 0;
    this.currentCard = null;
    this.highestBid = 0;
    this.highestBidderId = null;
    this.timerRemaining = 0;
    this.timerStartedAt = 0;
    this.state = 'study';
    this.roundNumber = 0;
    this.inDiscardPhase = false;
    this.cardsBoughtThisPass = 0;
    this.consecutiveEmptyPasses = 0;
    this.extendedBy = new Set();
    this.readyPlayers = new Set();
  }

  destroy() {
    this.clearTimer();
    this.clearStudyAutoStart();
    this.clearBotTimeouts();
  }
}

GameX.posCategory = posCategory;
GameX.countCategories = countCategories;
GameX.hasValidTeam = hasValidTeam;
GameX.TEAM_SIZE = TEAM_SIZE;
GameX.MIN_SCORE = MIN_SCORE;
GameX.TEAM_REQS = TEAM_REQS;
GameX.MAX_GK = MAX_GK;

module.exports = GameX;
