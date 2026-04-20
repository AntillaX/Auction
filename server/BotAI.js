const WIN_THRESHOLD = 644;
const MIN_OPENING_BID = 50;
const MIN_BID_INCREMENT = 10;

const BOT_BIASES = {
  Allegri: {
    mustHave: 'Buffon',
    likes: ['Ronaldo', 'Ramos'],
    dislikes: ['Neymar', 'Lamine Yamal', 'Ronaldinho', 'Morata', 'Lingard', 'Mustafi', 'Maguire'],
  },
  Conte: {
    mustHave: 'Haaland',
    likes: ['Beckham', 'Van Dijk'],
    dislikes: ['Jordi Alba', 'Pedri', 'Marcelo', 'Mustafi', 'Morata', 'Lingard', 'Maguire'],
  },
  Simeone: {
    mustHave: 'Ramos',
    likes: ['Casillas', 'Dani Carvajal'],
    dislikes: ['Ronaldinho', 'Neymar', 'Lingard', 'Maguire', 'Mustafi', 'Morata', 'Jordi Alba'],
  },
  Ancelotti: {
    mustHave: 'Modric',
    likes: ['Ronaldo', 'Courtois'],
    dislikes: ['Lingard', 'Mustafi', 'Jordi Alba', 'Maguire', 'Morata', 'Marcelo', 'De Gea'],
  },
  Mourinho: {
    mustHave: 'Neuer',
    likes: ['Xavi', 'Ramos'],
    dislikes: ['Pedri', 'Lamine Yamal', 'Iniesta', 'Neymar', 'Lingard', 'Mustafi', 'Maguire'],
  },
};

function calculateMaxBid(bot, card, game) {
  const needed = WIN_THRESHOLD - bot.score;
  if (needed <= 0) return 0;

  if (card.value >= needed) return bot.budget;

  let maxBid = (card.value / needed) * bot.budget;

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

  const bias = BOT_BIASES[bot.name];
  if (bias) {
    if (bias.mustHave === card.name) {
      maxBid *= 1.5;
    } else if (bias.likes.includes(card.name)) {
      maxBid *= 1.15;
    } else if (bias.dislikes.includes(card.name)) {
      maxBid *= 0.5;
    }
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
  maxBid = Math.floor(maxBid / 10) * 10;
  return Math.max(0, maxBid);
}

function willStartBid(bot, card) {
  const bias = BOT_BIASES[bot.name];
  if (bias && bias.dislikes.includes(card.name)) return false;
  return true;
}

module.exports = { calculateMaxBid, willStartBid };
