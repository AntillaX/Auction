const WIN_THRESHOLD = 655;
const MIN_OPENING_BID = 50;
const MIN_BID_INCREMENT = 10;
const TIMER_DURATION = 10000; // 10 seconds
const DELAY_CARD_WON = 2500;
const DELAY_CARD_PASSED = 1500;
const STUDY_AUTOSTART_MS = 45000; // auto-start auctions if not all ready

class Game {
  constructor(players, broadcast) {
    this.players = players; // Map<id, Player>
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
    this.state = 'study'; // study | auction | between_rounds | finished
    this.roundNumber = 0;
    this.inDiscardPhase = false;
    this.cardsBoughtThisPass = 0;
    this.consecutiveEmptyPasses = 0;
    this.nextCardTimeout = null;
    this.extendedBy = new Set();
    // Ready system (shared between study phase and play-again).
    // readyPlayers tracks who has pressed "Ready" in the current
    // waiting phase. During study, a 45s auto-start fallback kicks
    // in so one AFK player can't hold the game hostage.
    this.readyPlayers = new Set();
    this.studyAutoStartTimeout = null;
    this.studyAutoStartAt = 0;
  }

  generateDeck() {
    return [
      { name: 'Messi', value: 100 },
      { name: 'Ronaldo', value: 98 },
      { name: 'Mbappé', value: 98 },
      { name: 'Zidane', value: 98 },
      { name: 'Neymar', value: 96 },
      { name: 'Ronaldinho', value: 96 },
      { name: 'Maradona', value: 96 },
      { name: 'Beckham', value: 96 },
      { name: 'Haaland', value: 94 },
      { name: 'De Bruyne', value: 94 },
      { name: 'Modric', value: 94 },
      { name: 'Iniesta', value: 94 },
      { name: 'Casillas', value: 94 },
      { name: 'Lamine Yamal', value: 94 },
      { name: 'Ibrahimovic', value: 92 },
      { name: 'Buffon', value: 92 },
      { name: 'Lewandowski', value: 92 },
      { name: 'Benzema', value: 92 },
      { name: 'Rooney', value: 92 },
      { name: 'Van Dijk', value: 92 },
      { name: 'Neuer', value: 92 },
      { name: 'Ramos', value: 90 },
      { name: 'Lingard', value: 90 },
      { name: 'Fred', value: 90 },
      { name: 'Pedri', value: 90 },
      { name: 'Marcelo', value: 90 },
      { name: 'Jordi Alba', value: 90 },
      { name: 'Dani Carvajal', value: 90 },
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

    // Schedule the 45s auto-start fallback so the game can't get
    // stuck on one AFK player in the study phase.
    this.clearStudyAutoStart();
    this.studyAutoStartAt = Date.now() + STUDY_AUTOSTART_MS;
    this.studyAutoStartTimeout = setTimeout(() => {
      if (this.state === 'study') this.startAuctionsNow();
    }, STUDY_AUTOSTART_MS);

    this.broadcast({
      type: 'game_started',
      ...this.getFullState(),
    });
  }

  clearStudyAutoStart() {
    if (this.studyAutoStartTimeout) {
      clearTimeout(this.studyAutoStartTimeout);
      this.studyAutoStartTimeout = null;
    }
  }

  getConnectedIds() {
    const ids = [];
    for (const [id, p] of this.players) {
      if (p.connected) ids.push(id);
    }
    return ids;
  }

  // Called when a player presses the "Ready" button. Routed based on
  // current state — study phase triggers auctions, finished state
  // triggers a play-again reset.
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

  // Re-check the ready condition without marking anyone new — used
  // when a player disconnects (their absence can itself satisfy
  // "all remaining players ready").
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
    // Don't allow a solo rematch — at minimum 2 connected players
    // must be around to press Ready before we reset the game.
    if (this.getConnectedIds().length < 2) return;
    this.reset();
    this.start();
  }

  // Actually begin the first auction. Used by both the auto-start
  // timer and the "all ready" path.
  startAuctionsNow() {
    if (this.state !== 'study') return;
    this.clearStudyAutoStart();
    this.readyPlayers = new Set();
    this.presentNextCard();
  }

  presentNextCard() {
    // Check if current deck is exhausted
    if (this.currentIndex >= this.deck.length) {
      if (this.discardPile.length === 0) {
        this.endGame('deck_exhausted');
        return;
      }

      // Transitioning to or continuing discard phase
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

      // Start new pass through discard pile
      this.deck = [...this.discardPile];
      this.discardPile = [];
      this.currentIndex = 0;
      this.inDiscardPhase = true;
      this.cardsBoughtThisPass = 0;
    }

    // Check if anyone can bid
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

    // Set timer values BEFORE broadcast so clients get correct timing
    this.timerRemaining = TIMER_DURATION;
    this.timerStartedAt = Date.now();

    this.broadcast({
      type: 'new_auction',
      ...this.getFullState(),
    });

    this.startTimer();
  }

  startTimer() {
    this.clearTimer();
    this.timerRemaining = TIMER_DURATION;
    this.timerStartedAt = Date.now();

    this.timerTimeout = setTimeout(() => {
      this.resolveAuction();
    }, TIMER_DURATION);
  }

  resetTimer() {
    this.clearTimer();
    this.timerRemaining = TIMER_DURATION;
    this.timerStartedAt = Date.now();

    this.timerTimeout = setTimeout(() => {
      this.resolveAuction();
    }, TIMER_DURATION);
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
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    if (!player.connected) {
      return { success: false, error: 'Player is disconnected' };
    }

    if (typeof amount !== 'number' || !Number.isInteger(amount)) {
      return { success: false, error: 'Invalid bid amount' };
    }

    if (amount % MIN_BID_INCREMENT !== 0) {
      return { success: false, error: 'Bid must be in $10 increments' };
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

    return { success: true };
  }

  extendTime(playerId) {
    if (this.state !== 'auction') {
      return { success: false, error: 'No auction in progress' };
    }

    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    if (!player.connected) {
      return { success: false, error: 'Player is disconnected' };
    }

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

    return { success: true };
  }

  resolveAuction() {
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

      if (winner.score >= WIN_THRESHOLD) {
        this.endGame('threshold', this.highestBidderId);
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
      if (player.budget >= MIN_OPENING_BID) {
        return false;
      }
    }
    return true;
  }

  endGame(reason, winnerId = null) {
    this.state = 'finished';
    this.clearTimer();
    this.clearStudyAutoStart();
    // New phase, new ready set — everyone has to press Play Again.
    this.readyPlayers = new Set();

    if (!winnerId) {
      let maxScore = -1;
      for (const [id, player] of this.players) {
        if (player.score > maxScore) {
          maxScore = player.score;
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
  }
}

module.exports = Game;
