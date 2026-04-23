const MIN_OPENING_BID = 50;
const MIN_BID_INCREMENT = 5;
const TEAM_SIZE = 11;
const MIN_SCORE = 1000;
const TEAM_REQS = { gk: 1, def: 3, mid: 3, att: 2 };
const MAX_GK = 2;

const BOT_BIASES = {
  Allegri: {
    mustHave: ['Buffon', 'Beckham'],
    likes: ['Ronaldo', 'Ramos'],
    dislikes: ['Neymar', 'Ronaldinho', 'Bellingham', 'Lingard', 'Ter Stegen', 'Maguire', 'Maradona'],
  },
  Conte: {
    mustHave: ['Haaland', 'Marcelo'],
    likes: ['Beckham', 'Van Dijk'],
    dislikes: ['Jordi Alba', 'Piqué', 'Bellingham', 'Lingard', 'Maguire', 'De Gea', 'Puyol'],
  },
  Simeone: {
    mustHave: ['Ramos', 'Marcelo'],
    likes: ['Casillas', 'Carvajal'],
    dislikes: ['Ronaldinho', 'Neymar', 'Lingard', 'Maguire', 'Ter Stegen', 'Bellingham', 'Cruyff'],
  },
  Ancelotti: {
    mustHave: ['Modric', 'Beckham', 'Marcelo'],
    likes: ['Ronaldo', 'Courtois'],
    dislikes: ['Lingard', 'Piqué', 'Jordi Alba', 'Maguire', 'Bellingham', 'De Gea', 'Puyol'],
  },
  Mourinho: {
    mustHave: ['Neuer', 'Beckham'],
    likes: ['Xavi', 'Ramos'],
    dislikes: ['Iniesta', 'Neymar', 'Lingard', 'Ter Stegen', 'Maguire', 'Puyol', 'Bellingham'],
  },
};

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

function positionalNeedMultiplier(bot, card) {
  const counts = countCategories(bot.cardsWon);
  const cat = posCategory(card.position);
  const need = TEAM_REQS[cat] || 0;
  const have = counts[cat] || 0;

  if (cat === 'gk' && have >= MAX_GK) return 0.3;
  if (have < need) return 1.3;
  const totalCards = bot.cardsWon.length;
  const flex = totalCards - (Object.values(TEAM_REQS).reduce((a, b) => a + b, 0));
  if (have >= need && flex >= (TEAM_SIZE - Object.values(TEAM_REQS).reduce((a, b) => a + b, 0))) {
    return 0.6;
  }
  return 1.0;
}

function calculateMaxBid(bot, card, game) {
  const cardsNeeded = TEAM_SIZE - bot.cardsWon.length;
  if (cardsNeeded <= 0) return 0;

  if (cardsNeeded === 1) {
    const counts = countCategories(bot.cardsWon);
    const cat = posCategory(card.position);
    const wouldComplete = counts.gk >= TEAM_REQS.gk && counts.def >= TEAM_REQS.def &&
      counts.mid >= TEAM_REQS.mid && counts.att >= TEAM_REQS.att;
    const catNeed = TEAM_REQS[cat] - counts[cat];
    if (catNeed > 0 || wouldComplete) {
      if (bot.score + card.value >= MIN_SCORE) return bot.budget;
    }
  }

  let maxBid = (card.value / (MIN_SCORE - bot.score || 1)) * bot.budget;
  maxBid = Math.min(maxBid, bot.budget / cardsNeeded * 1.5);

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
  }

  const reserve = Math.max(0, (cardsNeeded - 1)) * MIN_OPENING_BID;
  maxBid = Math.min(maxBid, bot.budget - reserve);

  maxBid *= positionalNeedMultiplier(bot, card);

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
    if (p.cardsWon.length >= TEAM_SIZE - 1 && p.budget >= MIN_OPENING_BID) {
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
  if (bot.cardsWon.some((c) => c.name === card.name)) return false;
  const bias = BOT_BIASES[bot.name];
  if (bias && bias.dislikes.includes(card.name)) return false;
  return true;
}

module.exports = { calculateMaxBid, willStartBid };
