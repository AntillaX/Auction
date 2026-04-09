const WIN_THRESHOLD = 655;
const MIN_OPENING_BID = 50;
const MIN_BID_INCREMENT = 10;
const TIMER_DURATION = 10000; // 10 seconds
const DELAY_CARD_WON = 2500;
const DELAY_CARD_PASSED = 1500;

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
  }

  generateDeck() {
    const cards = [];
    for (let i = 0; i < 6; i++) cards.push(90);
    for (let i = 0; i < 6; i++) cards.push(92);
    for (let i = 0; i < 5; i++) cards.push(94);
    for (let i = 0; i < 4; i++) cards.push(96);
    for (let i = 0; i < 3; i++) cards.push(98);
    cards.push(100);
    return cards;
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

    this.broadcast({
      type: 'game_started',
      ...this.getFullState(),
    });
  }

  startAuctions() {
    if (this.state !== 'study') return;
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
  }

  destroy() {
    this.clearTimer();
  }
}

module.exports = Game;
