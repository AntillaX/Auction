const WIN_THRESHOLD = 655;
const MIN_OPENING_BID = 50;

// Calculate the maximum amount a bot is willing to pay for a card.
//
// Strategy: treat the budget as a finite resource that must be
// spread across the points still needed to reach 655.  The base
// price of a card is proportional to (card value / points needed)
// × budget.  Adjustments layer on top:
//
//   1. Scarcity  — pay a premium for above-average cards when the
//      remaining deck is weaker, discount below-average cards when
//      better ones are still coming.
//   2. Blocking  — if an opponent would reach 655 by winning this
//      card, drastically increase willingness to pay.
//   3. Win-now   — if this card puts the bot over 655, go all-in.

function calculateMaxBid(bot, card, game) {
  const needed = WIN_THRESHOLD - bot.score;
  if (needed <= 0) return 0;

  // This card clinches the game — spend everything
  if (card.value >= needed) return bot.budget;

  // Base valuation: budget per point × card points
  let maxBid = (card.value / needed) * bot.budget;

  // Scarcity: compare this card to the average of what's left
  const future = [...game.getRemainingCards(), ...game.discardPile];
  if (future.length > 0) {
    const avg = future.reduce((s, c) => s + c.value, 0) / future.length;
    if (card.value > avg) {
      maxBid *= 1 + (card.value - avg) / 100;
    } else if (future.length > 3) {
      maxBid *= 0.85;
    }
  } else {
    // Last card in the game — only option
    maxBid = bot.budget;
  }

  // Blocking: if any opponent wins with this card, bid aggressively
  for (const [id, p] of game.players) {
    if (id === bot.id) continue;
    if (p.score + card.value >= WIN_THRESHOLD && p.budget >= MIN_OPENING_BID) {
      maxBid = Math.max(maxBid, bot.budget * 0.7);
      break;
    }
  }

  maxBid = Math.min(maxBid, bot.budget);
  maxBid = Math.floor(maxBid / 10) * 10;
  return Math.max(0, maxBid);
}

module.exports = { calculateMaxBid };
