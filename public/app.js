/* ─────────────────────────────────────────────
   AUCTION — Client
   ───────────────────────────────────────────── */

// ── State ──
let ws = null;
let myPlayerId = null;
let roomCode = null;
let isHost = false;
let gameState = null;
let localTimerStart = 0;
let localTimerDuration = 0;
let timerRaf = null;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let toastTimeout = null;
let resultBannerTimeout = null;
let lastCardWonBy = null;

// ── DOM refs ──
const $ = (id) => document.getElementById(id);

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  $('create-btn').addEventListener('click', createRoom);
  $('join-btn').addEventListener('click', joinRoom);
  $('player-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createRoom();
  });
  $('room-code-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  $('start-btn').addEventListener('click', () => send({ type: 'start_game' }));
  $('begin-auctions-btn').addEventListener('click', () => send({ type: 'start_auctions' }));

  $('bid-min').addEventListener('click', () => placeBidAction('min'));
  $('bid-plus10').addEventListener('click', () => placeBidAction('+10'));
  $('bid-plus50').addEventListener('click', () => placeBidAction('+50'));
  $('bid-plus100').addEventListener('click', () => placeBidAction('+100'));
  $('custom-bid-btn').addEventListener('click', placeCustomBid);
  $('custom-bid-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') placeCustomBid();
  });

  $('play-again-btn').addEventListener('click', () => send({ type: 'play_again' }));
  $('back-to-lobby-btn').addEventListener('click', backToLobby);

  $('room-code-display').addEventListener('click', () => {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode).then(() => showToast('Code copied!', 'success'));
    }
  });

  const savedRoom = sessionStorage.getItem('auction_room');
  const savedPlayer = sessionStorage.getItem('auction_player');
  if (savedRoom && savedPlayer) {
    roomCode = savedRoom;
    myPlayerId = savedPlayer;
    connect(() => {
      send({ type: 'reconnect', roomCode, playerId: myPlayerId });
    });
  }
});

// ── WebSocket ──
function connect(onOpen) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    reconnectAttempts = 0;
    $('reconnect-overlay').classList.add('hidden');
    if (onOpen) onOpen();
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = () => {
    if (roomCode && myPlayerId) attemptReconnect();
  };

  ws.onerror = () => {};
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function attemptReconnect() {
  if (reconnectAttempts >= 10) {
    $('reconnect-overlay').classList.add('hidden');
    showToast('Connection lost. Please refresh.', 'error');
    return;
  }
  $('reconnect-overlay').classList.remove('hidden');
  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 15000);
  reconnectAttempts++;
  reconnectTimeout = setTimeout(() => {
    connect(() => {
      send({ type: 'reconnect', roomCode, playerId: myPlayerId });
    });
  }, delay);
}

// ── Message Handler ──
function handleMessage(msg) {
  switch (msg.type) {
    case 'room_created':
    case 'room_joined':
      roomCode = msg.roomCode;
      myPlayerId = msg.playerId;
      isHost = msg.hostId === myPlayerId;
      sessionStorage.setItem('auction_room', roomCode);
      sessionStorage.setItem('auction_player', myPlayerId);
      renderRoom(msg);
      showScreen('room-screen');
      break;

    case 'player_joined':
    case 'player_left':
    case 'player_disconnected':
    case 'player_reconnected':
      isHost = msg.hostId === myPlayerId;
      renderRoom(msg);
      break;

    case 'reconnected':
      isHost = msg.hostId === myPlayerId;
      if (msg.gameState === 'finished') {
        gameState = msg;
        renderGameOver();
        showScreen('gameover-screen');
      } else if (msg.gameState && msg.gameState !== 'study') {
        gameState = msg;
        renderGame();
        showScreen('game-screen');
        if (msg.gameState === 'auction') {
          startLocalTimer(msg.timerRemaining, msg.timerStartedAt);
        }
      } else if (msg.gameState === 'study') {
        gameState = msg;
        showScreen('game-screen');
        showStudyPhase();
      } else if (msg.roomState === 'lobby') {
        renderRoom(msg);
        showScreen('room-screen');
      }
      break;

    case 'game_started':
      gameState = msg;
      showScreen('game-screen');
      showStudyPhase();
      break;

    case 'new_auction':
      gameState = msg;
      lastCardWonBy = null;
      hideResultBanner();
      hideStudyOverlay();
      renderGame();
      startLocalTimer(msg.timerRemaining, msg.timerStartedAt);
      break;

    case 'bid_placed':
      gameState = msg;
      renderGame();
      startLocalTimer(msg.timerRemaining, msg.timerStartedAt);
      highlightBidder(msg.playerId);
      break;

    case 'card_won': {
      gameState = msg;
      lastCardWonBy = msg.playerId;
      stopTimer();
      animateCardWon(msg.playerId);
      showResultBanner('won', msg.playerName, msg.amount, msg.cardValue, msg.playerId === myPlayerId);
      // Delay render so card animation plays first
      setTimeout(() => renderGame(), 300);
      break;
    }

    case 'card_passed':
      gameState = msg;
      lastCardWonBy = null;
      stopTimer();
      animateCardPassed();
      showResultBanner('passed', null, null, msg.cardValue, false);
      setTimeout(() => renderGame(), 300);
      break;

    case 'game_over':
      gameState = msg;
      stopTimer();
      hideResultBanner();
      renderGameOver();
      showScreen('gameover-screen');
      break;

    case 'error':
      showToast(msg.message);
      break;
  }
}

// ── Screens ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(id).classList.add('active');
}

// ── Lobby ──
function createRoom() {
  const name = $('player-name').value.trim() || 'Player';
  connect(() => { send({ type: 'create_room', playerName: name }); });
}

function joinRoom() {
  const name = $('player-name').value.trim() || 'Player';
  const code = $('room-code-input').value.trim().toUpperCase();
  if (!code || code.length < 4) { showToast('Enter a 4-letter room code'); return; }
  connect(() => { send({ type: 'join_room', playerName: name, roomCode: code }); });
}

function backToLobby() {
  sessionStorage.removeItem('auction_room');
  sessionStorage.removeItem('auction_player');
  roomCode = null; myPlayerId = null; gameState = null;
  if (ws) ws.close();
  showScreen('lobby-screen');
}

// ── Room ──
function renderRoom(state) {
  $('room-code-display').textContent = state.roomCode || roomCode;
  const list = $('players-list');
  list.innerHTML = '';

  const players = state.players || [];
  players.forEach((p) => {
    const slot = document.createElement('div');
    slot.className = 'player-slot' + (p.id === state.hostId ? ' is-host' : '');
    slot.innerHTML = `
      <div class="player-dot ${p.connected ? '' : 'disconnected'}"></div>
      <span class="player-slot-name">${esc(p.name)}${p.id === myPlayerId ? ' (you)' : ''}</span>
      ${p.id === state.hostId ? '<span class="player-slot-badge">Host</span>' : ''}
    `;
    list.appendChild(slot);
  });

  const startBtn = $('start-btn');
  const waitMsg = $('waiting-msg');
  if (state.hostId === myPlayerId) {
    startBtn.classList.remove('hidden');
    startBtn.disabled = players.length < 2;
    waitMsg.classList.add('hidden');
  } else {
    startBtn.classList.add('hidden');
    waitMsg.classList.remove('hidden');
  }
}

// ── Study Phase ──
function showStudyPhase() {
  const overlay = $('study-overlay');
  overlay.classList.remove('hidden');
  const deckDiv = $('study-deck');
  deckDiv.innerHTML = '';

  const deck = gameState.originalDeck || gameState.deck || [];
  deck.forEach((val, i) => {
    const card = createCardElement(val, 'card-small');
    card.style.animationDelay = `${i * 60}ms`;
    deckDiv.appendChild(card);
  });

  if (isHost) {
    $('begin-auctions-btn').classList.remove('hidden');
    $('study-waiting').classList.add('hidden');
  } else {
    $('begin-auctions-btn').classList.add('hidden');
    $('study-waiting').classList.remove('hidden');
  }
}

function hideStudyOverlay() {
  $('study-overlay').classList.add('hidden');
}

// ── Result Banner ──
function showResultBanner(type, playerName, amount, cardValue, isMe) {
  hideResultBanner();
  const banner = $('result-banner');
  const inner = $('result-banner-inner');

  if (type === 'won') {
    const who = isMe ? 'You won' : `${esc(playerName)} won`;
    inner.className = 'result-banner-inner won';
    inner.innerHTML = `
      <div class="result-title won">${who} the ${cardValue}!</div>
      <div class="result-detail">for <span class="result-price">$${amount.toLocaleString()}</span></div>
    `;
  } else {
    inner.className = 'result-banner-inner passed';
    inner.innerHTML = `
      <div class="result-title passed">No bids</div>
      <div class="result-detail">The ${cardValue} goes to the discard pile</div>
    `;
  }

  banner.classList.remove('hidden');

  if (resultBannerTimeout) clearTimeout(resultBannerTimeout);
  resultBannerTimeout = setTimeout(() => hideResultBanner(), 2200);
}

function hideResultBanner() {
  $('result-banner').classList.add('hidden');
  if (resultBannerTimeout) { clearTimeout(resultBannerTimeout); resultBannerTimeout = null; }
}

// ── Game Rendering ──
function renderGame() {
  if (!gameState) return;
  renderOpponents();
  renderAuctionArea();
  renderDeckSequence();
  renderMyInfo();
  updateBidControls();
}

function renderOpponents() {
  const bar = $('opponents-bar');
  bar.innerHTML = '';

  const players = gameState.players || [];
  players.forEach((p) => {
    if (p.id === myPlayerId) return;

    const card = document.createElement('div');
    let cls = 'opponent-card';
    if (gameState.highestBidderId === p.id && gameState.gameState === 'auction') cls += ' is-winning';
    if (p.budget < 50) cls += ' is-broke';
    if (!p.connected) cls += ' disconnected';
    if (lastCardWonBy === p.id) cls += ' just-won-card';
    card.className = cls;
    card.id = `opponent-${p.id}`;

    const scorePct = Math.min(100, Math.round((p.score / 655) * 100));
    const progressCls = scorePct >= 70 ? 'high' : scorePct >= 40 ? 'mid' : 'low';
    card.innerHTML = `
      <span class="opponent-name">${esc(p.name)}</span>
      <span class="opponent-budget">$${p.budget.toLocaleString()}</span>
      <span class="opponent-score">${p.score} pts</span>
      <span class="opponent-cards-won">${p.cardsWon.length} card${p.cardsWon.length !== 1 ? 's' : ''}</span>
      <div class="opponent-progress">
        <div class="opponent-progress-fill ${progressCls}" style="width:${scorePct}%"></div>
      </div>
    `;
    bar.appendChild(card);
  });
}

function renderAuctionArea() {
  const state = gameState.gameState;

  // Round info
  $('round-info').textContent = gameState.roundNumber
    ? `Round ${gameState.roundNumber}${gameState.inDiscardPhase ? ' \u2014 Discard' : ''}`
    : '';

  // Current card
  const container = $('current-card-container');
  if (gameState.currentCard && (state === 'auction' || state === 'between_rounds')) {
    // Only rebuild if card changed or doesn't exist
    const existing = container.querySelector('.card-large');
    const existingVal = existing ? existing.getAttribute('data-value') : null;
    if (existingVal !== String(gameState.currentCard)) {
      container.innerHTML = '';
      const card = createCardElement(gameState.currentCard, 'card-large');
      card.id = 'current-card';
      card.classList.add('card-enter');
      container.appendChild(card);
    }
  } else if (state !== 'between_rounds') {
    container.innerHTML = '';
  }

  // Bid info
  const bidStatus = $('bid-status');
  if (state === 'auction') {
    if (gameState.highestBid > 0) {
      const bidderName = getBidderName(gameState.highestBidderId);
      const isMe = gameState.highestBidderId === myPlayerId;
      bidStatus.innerHTML = `
        <span class="bid-amount">$${gameState.highestBid.toLocaleString()}</span>
        <div class="bid-leader ${isMe ? 'bid-you-winning' : ''}">
          ${isMe ? 'You are winning!' : `${esc(bidderName)} is winning`}
        </div>
      `;
    } else {
      bidStatus.innerHTML = `<span class="no-bids-prompt">No bids yet &mdash; minimum $50</span>`;
    }
  } else if (state === 'between_rounds') {
    // Keep showing last bid state
  } else {
    bidStatus.innerHTML = '';
  }
}

function renderDeckSequence() {
  const container = $('deck-sequence');
  container.innerHTML = '';

  const remaining = gameState.remainingCards || [];
  const label = $('deck-area').querySelector('.deck-label');

  if (remaining.length === 0 && gameState.discardPile && gameState.discardPile.length > 0) {
    if (label) label.textContent = `Discard (${gameState.discardPile.length})`;
    gameState.discardPile.forEach((val) => {
      container.appendChild(createCardElement(val, 'card-small'));
    });
  } else {
    if (label) label.textContent = `Upcoming (${remaining.length})`;
    remaining.forEach((val) => {
      container.appendChild(createCardElement(val, 'card-small'));
    });
  }
}

function renderMyInfo() {
  const me = getMyPlayer();
  if (!me) return;

  const budgetEl = $('my-budget');
  budgetEl.textContent = `$${me.budget.toLocaleString()}`;
  budgetEl.className = 'stat-value budget-value';
  if (me.budget === 0) budgetEl.classList.add('broke');
  else if (me.budget < 100) budgetEl.classList.add('low-budget');

  $('my-score').textContent = `${me.score} / 655`;

  const scorePct = Math.min(100, Math.round((me.score / 655) * 100));
  $('my-score-fill').style.width = `${scorePct}%`;
}

function updateBidControls() {
  const me = getMyPlayer();
  const isAuction = gameState.gameState === 'auction';
  const minBid = gameState.minimumBid || 50;
  const canBid = isAuction && me && me.budget >= minBid && gameState.highestBidderId !== myPlayerId;

  const btnMin = $('bid-min');
  const btn10 = $('bid-plus10');
  const btn50 = $('bid-plus50');
  const btn100 = $('bid-plus100');

  const plus10 = gameState.highestBid > 0 ? gameState.highestBid + 10 : 50;
  const plus50 = gameState.highestBid > 0 ? gameState.highestBid + 50 : 100;
  const plus100 = gameState.highestBid > 0 ? gameState.highestBid + 100 : 150;

  if (isAuction && gameState.highestBidderId === myPlayerId) {
    btnMin.textContent = 'Winning!';
    btnMin.disabled = true;
    btn10.textContent = `$${plus10}`;
    btn10.disabled = true;
    btn50.textContent = `$${plus50}`;
    btn50.disabled = true;
    btn100.textContent = `$${plus100}`;
    btn100.disabled = true;
  } else {
    btnMin.textContent = `$${minBid}`;
    btnMin.disabled = !canBid;

    btn10.textContent = `$${plus10}`;
    btn10.disabled = !canBid || !me || me.budget < plus10;

    btn50.textContent = `$${plus50}`;
    btn50.disabled = !canBid || !me || me.budget < plus50;

    btn100.textContent = `$${plus100}`;
    btn100.disabled = !canBid || !me || me.budget < plus100;
  }

  const customInput = $('custom-bid-input');
  const customBtn = $('custom-bid-btn');
  customInput.min = minBid;
  customInput.max = me ? me.budget : 0;
  customInput.disabled = !isAuction || !me || me.budget < minBid;
  customBtn.disabled = !isAuction || !me || me.budget < minBid;
}

// ── Bid Actions ──
function placeBidAction(action) {
  if (!gameState) return;
  const minBid = gameState.minimumBid || 50;
  let amount;
  switch (action) {
    case 'min': amount = minBid; break;
    case '+10': amount = gameState.highestBid > 0 ? gameState.highestBid + 10 : 50; break;
    case '+50': amount = gameState.highestBid > 0 ? gameState.highestBid + 50 : 100; break;
    case '+100': amount = gameState.highestBid > 0 ? gameState.highestBid + 100 : 150; break;
  }
  if (amount) {
    amount = Math.ceil(amount / 10) * 10;
    send({ type: 'place_bid', amount });
  }
}

function placeCustomBid() {
  const input = $('custom-bid-input');
  let amount = parseInt(input.value, 10);
  if (isNaN(amount) || amount <= 0) { showToast('Enter a valid bid amount'); return; }
  amount = Math.round(amount / 10) * 10;
  if (amount < 50) amount = 50;
  send({ type: 'place_bid', amount });
  input.value = '';
}

// ── Timer ──
function startLocalTimer(serverRemaining, serverStartedAt) {
  stopTimer();
  const elapsed = Date.now() - serverStartedAt;
  const remaining = Math.max(0, serverRemaining - elapsed);
  localTimerDuration = serverRemaining;
  localTimerStart = Date.now() - (serverRemaining - remaining);
  tickTimer();
}

function tickTimer() {
  const elapsed = Date.now() - localTimerStart;
  const remaining = Math.max(0, localTimerDuration - elapsed);
  const pct = (remaining / localTimerDuration) * 100;

  const timerBar = $('timer-bar');
  const timerText = $('timer-text');

  timerBar.style.setProperty('--timer-pct', `${pct}%`);
  timerText.textContent = `${(remaining / 1000).toFixed(1)}s`;

  // Color shift
  let color;
  if (remaining > 7000) color = 'var(--success)';
  else if (remaining > 4000) color = 'var(--warning)';
  else color = 'var(--danger)';
  timerBar.style.setProperty('--timer-color', color);

  // Critical pulse in last 3 seconds
  if (remaining <= 3000 && remaining > 0) {
    timerBar.classList.add('timer-critical');
    timerText.classList.add('timer-critical-text');
  } else {
    timerBar.classList.remove('timer-critical');
    timerText.classList.remove('timer-critical-text');
  }

  if (remaining > 0) {
    timerRaf = requestAnimationFrame(tickTimer);
  } else {
    timerText.textContent = '0.0s';
    timerBar.classList.remove('timer-critical');
    timerText.classList.remove('timer-critical-text');
  }
}

function stopTimer() {
  if (timerRaf) { cancelAnimationFrame(timerRaf); timerRaf = null; }
}

// ── Animations ──
function highlightBidder(playerId) {
  const el = document.getElementById(`opponent-${playerId}`);
  if (el) {
    el.classList.remove('anim-bid-pulse');
    void el.offsetWidth;
    el.classList.add('anim-bid-pulse');
  }
}

function animateCardWon(playerId) {
  const card = $('current-card');
  if (card) {
    card.classList.add('anim-card-awarded');
  }
  // Pop the winner's score
  const scoreEl = playerId === myPlayerId
    ? $('my-score')
    : document.querySelector(`#opponent-${playerId} .opponent-score`);
  if (scoreEl) {
    scoreEl.classList.remove('anim-score-pop');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('anim-score-pop');
  }
  // Flash the winner's budget
  const budgetEl = playerId === myPlayerId
    ? $('my-budget')
    : document.querySelector(`#opponent-${playerId} .opponent-budget`);
  if (budgetEl) {
    budgetEl.classList.remove('anim-budget-flash');
    void budgetEl.offsetWidth;
    budgetEl.classList.add('anim-budget-flash');
  }
}

function animateCardPassed() {
  const card = $('current-card');
  if (card) {
    card.classList.add('anim-card-passed');
  }
}

// ── Card Element Builder ──
function createCardElement(value, sizeClass) {
  const el = document.createElement('div');
  el.className = `card ${sizeClass} card-value-${value}`;
  el.setAttribute('data-value', value);
  if (sizeClass === 'card-large') {
    el.innerHTML = `<span>${value}</span><span class="card-pts-label">pts</span>`;
  } else {
    el.textContent = value;
  }
  return el;
}

// ── Game Over ──
function renderGameOver() {
  if (!gameState) return;

  const winnerName = gameState.winnerName || 'Unknown';
  const isMe = gameState.winnerId === myPlayerId;
  $('winner-announce').textContent = isMe ? 'You win!' : `${winnerName} wins!`;

  let reasonText = '';
  switch (gameState.reason) {
    case 'threshold': reasonText = 'Reached 655 points!'; break;
    case 'deck_exhausted': reasonText = 'All cards auctioned \u2014 highest score wins'; break;
    case 'stalemate': reasonText = 'No bids in two passes \u2014 highest score wins'; break;
    case 'all_broke': reasonText = 'All players out of funds \u2014 highest score wins'; break;
    default: reasonText = 'Game over';
  }
  $('win-reason').textContent = reasonText;

  const players = [...(gameState.players || [])].sort((a, b) => b.score - a.score);
  const scoresDiv = $('final-scores');
  scoresDiv.innerHTML = '';

  players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'score-row' + (p.id === gameState.winnerId ? ' is-winner' : '');
    const rankIcon = i === 0 ? '\u2654' : `${i + 1}`;
    row.innerHTML = `
      <span class="score-rank">${rankIcon}</span>
      <span class="score-name">${esc(p.name)}${p.id === myPlayerId ? ' (you)' : ''}</span>
      <span class="score-points">${p.score} pts</span>
      <span class="score-budget">$${p.budget.toLocaleString()} left</span>
    `;
    scoresDiv.appendChild(row);
  });

  if (isHost) {
    $('play-again-btn').classList.remove('hidden');
  } else {
    $('play-again-btn').classList.add('hidden');
  }

  // Confetti
  spawnConfetti();
}

function spawnConfetti() {
  const container = $('confetti-container');
  container.innerHTML = '';
  const colors = ['#d4a843', '#e0b54e', '#2ecc71', '#e74c3c', '#3498db', '#9b59b6', '#f39c12'];

  for (let i = 0; i < 50; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = `${2 + Math.random() * 3}s`;
    piece.style.animationDelay = `${Math.random() * 1.5}s`;
    piece.style.width = `${4 + Math.random() * 8}px`;
    piece.style.height = `${4 + Math.random() * 8}px`;
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
    container.appendChild(piece);
  }
}

// ── Helpers ──
function getMyPlayer() {
  if (!gameState || !gameState.players) return null;
  return gameState.players.find((p) => p.id === myPlayerId);
}

function getBidderName(id) {
  if (!gameState || !gameState.players) return '???';
  const p = gameState.players.find((pl) => pl.id === id);
  return p ? p.name : '???';
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type) {
  const toast = $('toast');
  toast.textContent = message;
  toast.style.background = type === 'success' ? 'var(--success)' : 'var(--danger)';
  toast.classList.remove('hidden');
  toast.classList.add('visible');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2500);
}
