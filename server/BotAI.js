const WIN_THRESHOLD = 655;
const MIN_OPENING_BID = 50;
const MIN_BID_INCREMENT = 10;

const BOT_BIASES = {
  Allegri: {
    favorites: ['Buffon', 'Ronaldo', 'Van Dijk', 'Neuer'],
    dislikes: ['Neymar', 'Lamine Yamal'],
  },
  Conte: {
    favorites: ['Haaland', 'Rooney', 'Beckham', 'Ramos'],
    dislikes: ['Jordi Alba', 'Iniesta'],
  },
  Simeone: {
    favorites: ['Casillas', 'Dani Carvajal', 'Marcelo', 'Modric'],
    dislikes: ['Ronaldinho', 'Neymar'],
  },
  Ancelotti: {
    favorites: ['Ronaldo', 'Modric', 'Benzema', 'Marcelo'],
    dislikes: ['Fred', 'Lingard'],
  },
  Mourinho: {
    favorites: ['Ibrahimovic', 'Rooney', 'Ramos', 'Neuer'],
    dislikes: ['Pedri', 'Lamine Yamal'],
  },
};

// Calculate the maximum amount a bot is willing to pay for a card.
//
// Strategy: budget is a finite resource spread across the points
// still needed to reach 655.  Base price is proportional to
// (card value / points needed) * budget.  Layers on top:
//
//   1. Scarcity  — premium for above-average cards, discount when
//      better ones are coming.
//   2. Personality — each bot overpays for favourites (~20%) and
//      mostly ignores cards it dislikes (~70% discount).
//   3. Blocking  — if an opponent would reach 655 by winning this
//      card, bid just enough to outprice their budget.
//   4. Win-now   — if this card clinches the game, go all-in.

function calculateMaxBid(bot, card, game) {
  const needed = WIN_THRESHOLD - bot.score;
  if (needed <= 0) return 0;

  // This card clinches the game — spend everything
  if (card.value >= needed) return bot.budget;

  // Base valuation: budget per point * card points
  let maxBid = (card.value / needed) * bot.budget;

  // Scarcity: compare this card to what's still coming
  const future = [...game.getRemainingCards(), ...game.discardPile];
  if (future.length > 0) {
    const avg = future.reduce((s, c) => s + c.value, 0) / future.length;
    if (card.value > avg) {
      maxBid *= 1 + (card.value - avg) / 100;
    } else if (future.length > 3) {
      maxBid *= 0.85;
    }
  } else {
    maxBid = bot.budget;
  }

  // Personality bias (applied before blocking so a bot can still
  // be forced to block on a card it dislikes)
  const bias = BOT_BIASES[bot.name];
  if (bias) {
    if (bias.favorites.includes(card.name)) {
      maxBid *= 1.2;
    } else if (bias.dislikes.includes(card.name)) {
      maxBid *= 0.3;
    }
  }

  // Blocking: if an opponent would win with this card, bid just
  // enough to outprice them — no need to burn the whole budget.
  let blockAmount = 0;
  for (const [id, p] of game.players) {
    if (id === bot.id) continue;
    if (p.score + card.value >= WIN_THRESHOLD && p.budget >= MIN_OPENING_BID) {
      blockAmount = Math.max(blockAmount, p.budget + MIN_BID_INCREMENT);
    }
  }
  if (blockAmount > 0) {
    maxBid = Math.max(maxBid, Math.min(blockAmount, bot.budget));
  }

  maxBid = Math.min(maxBid, bot.budget);
  maxBid = Math.floor(maxBid / 10) * 10;
  return Math.max(0, maxBid);
}

module.exports = { calculateMaxBid };
