const WIN_THRESHOLD = 644;
const MIN_OPENING_BID = 50;
const MIN_BID_INCREMENT = 5;

const BOT_BIASES = {
  Allegri: {
    mustHave: ['Buffon', 'Beckham'],
    likes: ['Ronaldo', 'Ramos'],
    dislikes: ['Neymar', 'Ronaldinho', 'Morata', 'Lingard', 'Mustafi', 'Maguire', 'Maradona'],
  },
  Conte: {
    mustHave: ['Haaland', 'Marcelo'],
    likes: ['Beckham', 'Van Dijk'],
    dislikes: ['Jordi Alba', 'Mustafi', 'Morata', 'Lingard', 'Maguire', 'De Gea', 'Puyol'],
  },
  Simeone: {
    mustHave: ['Ramos', 'Marcelo'],
    likes: ['Casillas', 'Dani Carvajal'],
    dislikes: ['Ronaldinho', 'Neymar', 'Lingard', 'Maguire', 'Mustafi', 'Morata', 'Cruyff'],
  },
  Ancelotti: {
    mustHave: ['Modric', 'Beckham', 'Marcelo'],
    likes: ['Ronaldo', 'Courtois'],
    dislikes: ['Lingard', 'Mustafi', 'Jordi Alba', 'Maguire', 'Morata', 'De Gea', 'Puyol'],
  },
  Mourinho: {
    mustHave: ['Neuer', 'Beckham'],
    likes: ['Xavi', 'Ramos'],
    dislikes: ['Iniesta', 'Neymar', 'Lingard', 'Mustafi', 'Maguire', 'Allison', 'Puyol'],
  },
};

function calculateMaxBid(bot, card, game) {
  const needed = WIN_THRESHOLD - bot.score;
  if (needed <= 0) return 0;

  if (card.value >= needed) return bot.budget;

  let maxBid = (card.value / needed) * bot.budget;

  const future = [...game.getRemainingCards(), ...game.discardPile];
  const avg = future.length > 0
    ? future.reduce((s, c) => s + c.value, 0) / future.length
    : card.value;

  if (future.length > 0) {
    if (card.value > avg) {
      maxBid *= 1 + (card.value - avg) / 100;
    } else if (future.length > 3) {
      maxBid *= 0.85;
    }
  } else {
    maxBid = bot.budget;
  }

  const pointsAfter = needed - card.value;
  if (pointsAfter > 0) {
    const cardsStillNeeded = Math.ceil(pointsAfter / avg);
    const reserve = cardsStillNeeded * MIN_OPENING_BID;
    maxBid = Math.min(maxBid, bot.budget - reserve);
  }

  const bias = BOT_BIASES[bot.name];
  let isNeutral = true;
  if (bias) {
    if (bias.mustHave.includes(card.name)) {
      maxBid *= 1.4;
      isNeutral = false;
    } else if (bias.likes.includes(card.name)) {
      maxBid *= 1.15;
      isNeutral = false;
    } else if (bias.dislikes.includes(card.name)) {
      maxBid *= 0.7;
      isNeutral = false;
    }
  }
  if (isNeutral) {
    const jitter = Math.random() < 0.75 ? (1 - Math.random() * 0.05) : (1 + Math.random() * 0.05);
    maxBid *= jitter;
  }

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
  maxBid = Math.floor(maxBid / 5) * 5;
  return Math.max(0, maxBid);
}

function willStartBid(bot, card) {
  const bias = BOT_BIASES[bot.name];
  if (bias && bias.dislikes.includes(card.name)) return false;
  return true;
}

module.exports = { calculateMaxBid, willStartBid };
