/* ─────────────────────────────────────────────
   AUCTION — Client
   ───────────────────────────────────────────── */

// ── State ──
let ws = null;
let myPlayerId = null;
let roomCode = null;
let isHost = false;
let gameState = null;   // full state from server
let localTimerStart = 0;
let localTimerDuration = 0;
let timerRaf = null;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let toastTimeout = null;

// ── DOM refs ──
const $ = (id) => document.getElementById(id);

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  // Lobby buttons
  $('create-btn').addEventListener('click', createRoom);
  $('join-btn').addEventListener('click', joinRoom);
  $('player-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createRoom();
  });
  $('room-code-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });

  // Room buttons
  $('start-btn').addEventListener('click', () => send({ type: 'start_game' }));

  // Study phase
  $('begin-auctions-btn').addEventListener('click', () => send({ type: 'start_auctions' }));

  // Bid buttons
  $('bid-min').addEventListener('click', () => placeBidAction('min'));
  $('bid-plus10').addEventListener('click', () => placeBidAction('+10'));
  $('bid-plus50').addEventListener('click', () => placeBidAction('+50'));
  $('bid-plus100').addEventListener('click', () => placeBidAction('+100'));
  $('custom-bid-btn').addEventListener('click', placeCustomBid);
  $('custom-bid-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') placeCustomBid();
  });

  // Game over
  $('play-again-btn').addEventListener('click', () => send({ type: 'play_again' }));
  $('back-to-lobby-btn').addEventListener('click', backToLobby);

  // Room code copy
  $('room-code-display').addEventListener('click', () => {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode).then(() => showToast('Code copied!', 'success'));
    }
  });

  // Try reconnect from session
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
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleMessage(msg);
  };

  ws.onclose = () => {
    if (roomCode && myPlayerId) {
      attemptReconnect();
    }
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
      if (msg.gameState && msg.gameState !== 'study') {
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
      } else if (msg.gameState === 'finished') {
        gameState = msg;
        renderGameOver();
        showScreen('gameover-screen');
      }
      break;

    case 'game_started':
      gameState = msg;
      showScreen('game-screen');
      showStudyPhase();
      break;

    case 'new_auction':
      gameState = msg;
      hideStudyOverlay();
      renderGame();
      startLocalTimer(msg.timerRemaining, msg.timerStartedAt);
      break;

    case 'bid_placed':
      gameState = msg;
      renderGame();
      startLocalTimer(msg.timerRemaining, msg.timerStartedAt);
      // Pulse the bidder's card
      highlightBidder(msg.playerId);
      break;

    case 'card_won':
      gameState = msg;
      animateCardWon(msg.playerId);
      renderGame();
      stopTimer();
      break;

    case 'card_passed':
      gameState = msg;
      animateCardPassed();
      renderGame();
      stopTimer();
      break;

    case 'game_over':
      gameState = msg;
      stopTimer();
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

// ── Lobby Actions ──
function createRoom() {
  const name = $('player-name').value.trim() || 'Player';
  connect(() => {
    send({ type: 'create_room', playerName: name });
  });
}

function joinRoom() {
  const name = $('player-name').value.trim() || 'Player';
  const code = $('room-code-input').value.trim().toUpperCase();
  if (!code || code.length < 4) {
    showToast('Enter a 4-letter room code');
    return;
  }
  connect(() => {
    send({ type: 'join_room', playerName: name, roomCode: code });
  });
}

function backToLobby() {
  sessionStorage.removeItem('auction_room');
  sessionStorage.removeItem('auction_player');
  roomCode = null;
  myPlayerId = null;
  gameState = null;
  if (ws) ws.close();
  showScreen('lobby-screen');
}

// ── Room Rendering ──
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

  // Show/hide start button
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
    card.style.animationDelay = `${i * 30}ms`;
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
    if (gameState.highestBidderId === p.id) cls += ' is-winning';
    if (p.budget < 50) cls += ' is-broke';
    if (!p.connected) cls += ' disconnected';
    card.className = cls;
    card.id = `opponent-${p.id}`;

    const budgetPct = Math.round((p.budget / 1000) * 100);
    card.innerHTML = `
      <span class="opponent-name">${esc(p.name)}</span>
      <span class="opponent-budget">$${p.budget.toLocaleString()}</span>
      <span class="opponent-score">${p.score} pts</span>
      <span class="opponent-cards-won">${p.cardsWon.length} cards</span>
      <div class="opponent-budget-bar">
        <div class="opponent-budget-fill" style="width:${budgetPct}%"></div>
      </div>
    `;
    bar.appendChild(card);
  });
}

function renderAuctionArea() {
  const state = gameState.gameState;

  // Round info
  $('round-info').textContent = gameState.roundNumber
    ? `Round ${gameState.roundNumber}${gameState.inDiscardPhase ? ' (Discard)' : ''}`
    : '';

  // Current card
  const container = $('current-card-container');
  container.innerHTML = '';
  if (gameState.currentCard && (state === 'auction' || state === 'between_rounds')) {
    const card = createCardElement(gameState.currentCard, 'card-large');
    card.id = 'current-card';
    container.appendChild(card);
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
      bidStatus.innerHTML = `<span style="color:var(--text-secondary)">No bids yet &mdash; minimum $50</span>`;
    }
  } else if (state === 'between_rounds') {
    // Keep showing last state
  } else {
    bidStatus.innerHTML = '';
  }
}

function renderDeckSequence() {
  const container = $('deck-sequence');
  container.innerHTML = '';

  const remaining = gameState.remainingCards || [];
  if (remaining.length === 0 && gameState.discardPile && gameState.discardPile.length > 0) {
    // Show discard pile if no more main cards
    const label = $('deck-area').querySelector('.deck-label');
    if (label) label.textContent = 'Discard Pile';
    gameState.discardPile.forEach((val) => {
      container.appendChild(createCardElement(val, 'card-small'));
    });
  } else {
    const label = $('deck-area').querySelector('.deck-label');
    if (label) label.textContent = `Upcoming (${remaining.length})`;
    remaining.forEach((val) => {
      container.appendChild(createCardElement(val, 'card-small'));
    });
  }
}

function renderMyInfo() {
  const me = getMyPlayer();
  if (!me) return;

  $('my-budget').textContent = `$${me.budget.toLocaleString()}`;
  $('my-score').textContent = `${me.score} / 655`;
}

function updateBidControls() {
  const me = getMyPlayer();
  const isAuction = gameState.gameState === 'auction';
  const minBid = gameState.minimumBid || 50;
  const canBid = isAuction && me && me.budget >= minBid && gameState.highestBidderId !== myPlayerId;

  // Update button labels and states
  const btnMin = $('bid-min');
  const btn10 = $('bid-plus10');
  const btn50 = $('bid-plus50');
  const btn100 = $('bid-plus100');

  btnMin.textContent = `$${minBid}`;
  btnMin.disabled = !canBid;

  const plus10 = gameState.highestBid > 0 ? gameState.highestBid + 10 : 50;
  const plus50 = gameState.highestBid > 0 ? gameState.highestBid + 50 : 100;
  const plus100 = gameState.highestBid > 0 ? gameState.highestBid + 100 : 150;

  btn10.textContent = `$${plus10}`;
  btn10.disabled = !canBid || !me || me.budget < plus10;

  btn50.textContent = `$${plus50}`;
  btn50.disabled = !canBid || !me || me.budget < plus50;

  btn100.textContent = `$${plus100}`;
  btn100.disabled = !canBid || !me || me.budget < plus100;

  const customInput = $('custom-bid-input');
  const customBtn = $('custom-bid-btn');
  customInput.min = minBid;
  customInput.max = me ? me.budget : 0;
  customInput.disabled = !isAuction || !me || me.budget < minBid;
  customBtn.disabled = !isAuction || !me || me.budget < minBid;

  // If we're the highest bidder, show that on the min button
  if (isAuction && gameState.highestBidderId === myPlayerId) {
    btnMin.textContent = 'Winning!';
    btnMin.disabled = true;
  }
}

// ── Bid Actions ──
function placeBidAction(action) {
  if (!gameState) return;
  const minBid = gameState.minimumBid || 50;
  let amount;

  switch (action) {
    case 'min':
      amount = minBid;
      break;
    case '+10':
      amount = gameState.highestBid > 0 ? gameState.highestBid + 10 : 50;
      break;
    case '+50':
      amount = gameState.highestBid > 0 ? gameState.highestBid + 50 : 100;
      break;
    case '+100':
      amount = gameState.highestBid > 0 ? gameState.highestBid + 100 : 150;
      break;
  }

  if (amount) {
    // Round to nearest 10
    amount = Math.ceil(amount / 10) * 10;
    send({ type: 'place_bid', amount });
  }
}

function placeCustomBid() {
  const input = $('custom-bid-input');
  let amount = parseInt(input.value, 10);
  if (isNaN(amount) || amount <= 0) {
    showToast('Enter a valid bid amount');
    return;
  }
  // Round to nearest $10
  amount = Math.round(amount / 10) * 10;
  if (amount < 50) amount = 50;
  send({ type: 'place_bid', amount });
  input.value = '';
}

// ── Timer ──
function startLocalTimer(serverRemaining, serverStartedAt) {
  stopTimer();

  // Calculate how much time has already elapsed since the server started the timer
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

  if (remaining > 0) {
    timerRaf = requestAnimationFrame(tickTimer);
  } else {
    timerText.textContent = '0.0s';
  }
}

function stopTimer() {
  if (timerRaf) {
    cancelAnimationFrame(timerRaf);
    timerRaf = null;
  }
}

// ── Animations ──
function highlightBidder(playerId) {
  const el = document.getElementById(`opponent-${playerId}`);
  if (el) {
    el.classList.remove('anim-bid-pulse');
    void el.offsetWidth; // force reflow
    el.classList.add('anim-bid-pulse');
  }
}

function animateCardWon(playerId) {
  const card = $('current-card');
  if (card) {
    card.classList.add('anim-card-awarded');
  }
  // Pop the score
  const scoreEl = playerId === myPlayerId
    ? $('my-score')
    : document.querySelector(`#opponent-${playerId} .opponent-score`);
  if (scoreEl) {
    scoreEl.classList.remove('anim-score-pop');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('anim-score-pop');
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
  el.textContent = value;
  return el;
}

// ── Game Over ──
function renderGameOver() {
  if (!gameState) return;

  const winnerName = gameState.winnerName || 'Unknown';
  $('winner-announce').textContent = `${winnerName} wins!`;

  let reasonText = '';
  switch (gameState.reason) {
    case 'threshold':
      reasonText = 'Reached 655 points!';
      break;
    case 'deck_exhausted':
      reasonText = 'All cards auctioned — highest score wins';
      break;
    case 'stalemate':
      reasonText = 'No bids in two passes — highest score wins';
      break;
    case 'all_broke':
      reasonText = 'All players out of funds — highest score wins';
      break;
    default:
      reasonText = 'Game over';
  }
  $('win-reason').textContent = reasonText;

  // Sort players by score descending
  const players = [...(gameState.players || [])].sort((a, b) => b.score - a.score);
  const scoresDiv = $('final-scores');
  scoresDiv.innerHTML = '';

  players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'score-row' + (p.id === gameState.winnerId ? ' is-winner' : '');
    row.innerHTML = `
      <span class="score-rank">${i + 1}</span>
      <span class="score-name">${esc(p.name)}${p.id === myPlayerId ? ' (you)' : ''}</span>
      <span class="score-points">${p.score} pts</span>
      <span class="score-budget">$${p.budget.toLocaleString()} left</span>
    `;
    scoresDiv.appendChild(row);
  });

  // Play again button for host
  if (isHost) {
    $('play-again-btn').classList.remove('hidden');
  } else {
    $('play-again-btn').classList.add('hidden');
  }
}

// ── Helpers ──
function getMyPlayer() {
  if (!gameState || !gameState.players) return null;
  return gameState.players.find((p) => p.id === myPlayerId);
}

function getBidderName(id) {
  if (!gameState || !gameState.players) return '???';
  const p = gameState.players.find((p) => p.id === id);
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
