const STARTING_BUDGET = 1000;

class Player {
  constructor(id, name, ws) {
    this.id = id;
    this.name = name;
    this.ws = ws;
    this.budget = STARTING_BUDGET;
    this.score = 0;
    this.cardsWon = [];
    this.connected = true;
  }

  canAfford(amount) {
    return this.budget >= amount;
  }

  deductBudget(amount) {
    this.budget -= amount;
  }

  addCard(card) {
    this.cardsWon.push(card);
    this.score += card.value;
  }

  reset() {
    this.budget = STARTING_BUDGET;
    this.score = 0;
    this.cardsWon = [];
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      budget: this.budget,
      score: this.score,
      cardsWon: this.cardsWon,
      connected: this.connected,
    };
  }
}

module.exports = Player;
