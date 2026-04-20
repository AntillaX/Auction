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

// ── Analytics ──
// Thin wrapper around gtag so calls are safe even if GA hasn't
// loaded yet (ad blocker, offline, script still fetching). All
// events funnel through here so we have one place to tweak or
// disable tracking.
function track(eventName, params) {
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params || {});
    }
  } catch (_) { /* never let analytics break the game */ }
}

// Virtual page view for the SPA — fired whenever the active screen
// changes so GA's Realtime + Funnel reports see each screen as its
// own "page".
function trackScreen(screenId) {
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', {
        page_title: `Auction — ${screenId}`,
        page_location: `${location.origin}${location.pathname}#${screenId}`,
        page_path: `${location.pathname}#${screenId}`,
      });
    }
  } catch (_) {}
}

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
  // Single "Ready" button in the study overlay — server decides
  // whether it's a study-phase or play-again ready based on state.
  $('ready-btn').addEventListener('click', () => {
    send({ type: 'ready' });
    const btn = $('ready-btn');
    btn.disabled = true;
    btn.textContent = 'Ready \u2713';
  });

  // Bid buttons — we blur the tapped button right after firing so the
  // mobile :focus ring doesn't linger on the "last bid I pressed"
  // button between auctions (it otherwise looks pre-selected).
  const bidTap = (action) => (e) => {
    placeBidAction(action);
    if (e.currentTarget && e.currentTarget.blur) e.currentTarget.blur();
  };
  $('bid-min').addEventListener('click', bidTap('min'));
  $('bid-plus10').addEventListener('click', bidTap('+10'));
  $('bid-plus50').addEventListener('click', bidTap('+50'));
  $('bid-plus100').addEventListener('click', bidTap('+100'));
  $('custom-bid-btn').addEventListener('click', (e) => {
    placeCustomBid();
    if (e.currentTarget && e.currentTarget.blur) e.currentTarget.blur();
  });
  $('custom-bid-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') placeCustomBid();
  });

  $('more-time-btn').addEventListener('click', () => send({ type: 'extend_time' }));

  $('play-again-btn').addEventListener('click', () => {
    send({ type: 'ready' });
    const btn = $('play-again-btn');
    btn.disabled = true;
    btn.textContent = 'Ready \u2713';
  });
  $('back-to-lobby-btn').addEventListener('click', backToLobby);

  // Top-left "← Home" button on the Room screen — no confirm needed
  // since nobody has sunk time into the match yet.
  $('room-leave-btn').addEventListener('click', backToLobby);

  // Top-left "←" button on the in-game screen. Uses confirm() so a
  // mis-tap mid-auction doesn't nuke the player's seat. We explicitly
  // check that the element exists before binding so a stale cached
  // HTML without this button won't throw and kill the rest of init().
  const leaveBtn = $('leave-game-btn');
  if (leaveBtn) {
    leaveBtn.addEventListener('click', () => {
      const msg = 'Leave this game? You will lose your seat at the table.';
      if (window.confirm(msg)) {
        backToLobby();
      }
    });
  }

  $('how-to-play-btn').addEventListener('click', () => showScreen('instructions-screen'));
  $('instructions-back-btn').addEventListener('click', () => showScreen('lobby-screen'));

  $('help-btn').addEventListener('click', () => {
    $('help-overlay').classList.remove('hidden');
  });
  $('help-overlay-close').addEventListener('click', () => {
    $('help-overlay').classList.add('hidden');
  });

  $('deck-peek-btn').addEventListener('click', () => {
    renderDeckOverlay();
    $('deck-overlay').classList.remove('hidden');
  });
  $('deck-overlay-close').addEventListener('click', () => {
    $('deck-overlay').classList.add('hidden');
  });

  $('room-code-display').addEventListener('click', () => {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode).then(() => showToast('Code copied!', 'success'));
    }
  });

  // Fire the initial virtual page view. The lobby screen is marked
  // .active in the HTML so showScreen() is never called for it on
  // load — we emit the page_view manually here.
  trackScreen('lobby-screen');

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
function wsUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Use the directory of the current page as the WS base path so the client
  // works whether the app is served at `/` (local dev) or under a sub-path
  // like `/auction/` (production behind nginx). location.pathname ends in
  // either `/` or the name of the served file — strip the trailing filename.
  const basePath = location.pathname.replace(/[^/]*$/, '');
  return `${protocol}//${location.host}${basePath}`;
}

function connect(onOpen) {
  ws = new WebSocket(wsUrl());

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
      track(msg.type, { player_count: (msg.players || []).length });
      break;

    case 'player_joined':
      isHost = msg.hostId === myPlayerId;
      if (msg.player && msg.player.id !== myPlayerId) {
        showToast(`${msg.player.name} joined`, 'success');
      }
      renderRoom(msg);
      if (gameState) { gameState.players = msg.players; renderGame(); }
      break;

    case 'player_left':
      isHost = msg.hostId === myPlayerId;
      if (msg.playerName && msg.playerId !== myPlayerId) {
        showToast(`${msg.playerName} left`);
      }
      renderRoom(msg);
      if (gameState) { gameState.players = msg.players; renderGame(); }
      break;

    case 'player_disconnected':
      isHost = msg.hostId === myPlayerId;
      if (msg.playerName && msg.playerId !== myPlayerId) {
        showToast(`${msg.playerName} disconnected`);
      }
      renderRoom(msg);
      if (gameState) { gameState.players = msg.players; renderGame(); }
      break;

    case 'player_reconnected':
      isHost = msg.hostId === myPlayerId;
      if (msg.playerId !== myPlayerId) {
        const rp = (msg.players || []).find((p) => p.id === msg.playerId);
        if (rp) showToast(`${rp.name} reconnected`, 'success');
      }
      renderRoom(msg);
      if (gameState) { gameState.players = msg.players; renderGame(); }
      break;

    case 'last_player_warning':
      startLastPlayerCountdown(msg.graceMs || 10000);
      break;

    case 'last_player_cleared':
      stopLastPlayerCountdown();
      if (gameState) { gameState.players = msg.players; renderGame(); }
      break;

    case 'ready_update':
      if (gameState) {
        gameState.readyIds = msg.readyIds;
        gameState.connectedIds = msg.connectedIds;
        if (msg.studyAutoStartAt) gameState.studyAutoStartAt = msg.studyAutoStartAt;
      }
      if (msg.phase === 'study') {
        renderStudyReady(msg);
      } else if (msg.phase === 'play_again') {
        renderPlayAgainReady(msg);
      }
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
      track('game_started', { player_count: (msg.players || []).length });
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
      // Only track bids that *I* placed — otherwise every player
      // logs every other player's bid and the numbers double up.
      if (msg.playerId === myPlayerId) {
        track('auction_bid', {
          amount: msg.amount,
          card_name: msg.currentCard && msg.currentCard.name,
          round: msg.roundNumber,
        });
      }
      break;

    case 'time_extended':
      gameState = msg;
      renderGame();
      startLocalTimer(msg.timerRemaining, msg.timerStartedAt);
      if (msg.playerId !== myPlayerId) {
        showToast(`${msg.playerName} used More Time`, 'success');
      }
      break;

    case 'card_won': {
      gameState = msg;
      lastCardWonBy = msg.playerId;
      stopTimer();
      animateCardWon(msg.playerId);
      showResultBanner('won', msg.playerName, msg.amount, msg.cardValue, msg.playerId === myPlayerId);
      // Delay render so card animation plays first
      setTimeout(() => renderGame(), 300);
      // Only log when I'm the winner so one auction = one event
      // per player perspective, not one per viewer.
      if (msg.playerId === myPlayerId) {
        track('card_won', {
          card_name: msg.cardValue && msg.cardValue.name,
          card_value: msg.cardValue && msg.cardValue.value,
          amount: msg.amount,
        });
      }
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
      stopLastPlayerCountdown();
      hideResultBanner();
      $('deck-overlay').classList.add('hidden');
      $('help-overlay').classList.add('hidden');
      renderGameOver();
      showScreen('gameover-screen');
      track('game_finished', {
        reason: msg.reason,
        won_by_me: msg.winnerId === myPlayerId,
        player_count: (msg.players || []).length,
        rounds: msg.roundNumber,
      });
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
  trackScreen(id);
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
  // Log where the player was when they bailed so we can see the
  // drop-off points in GA (lobby vs room vs mid-game vs game-over).
  track('player_left', { from_state: (gameState && gameState.gameState) || 'lobby' });
  sessionStorage.removeItem('auction_room');
  sessionStorage.removeItem('auction_player');
  roomCode = null; myPlayerId = null; gameState = null;
  stopLastPlayerCountdown();
  if (ws) ws.close();
  // Clear the room code input so the last-used code doesn't linger
  // in the field the next time the user hits the lobby.
  const codeInput = $('room-code-input');
  if (codeInput) codeInput.value = '';
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
      ${p.isBot ? '<span class="player-slot-badge bot-badge">Bot</span>' : ''}
      ${p.id === state.hostId ? '<span class="player-slot-badge">Host</span>' : ''}
    `;
    list.appendChild(slot);
  });

  const startBtn = $('start-btn');
  const waitMsg = $('waiting-msg');
  if (state.hostId === myPlayerId) {
    startBtn.classList.remove('hidden');
    const humanCount = players.filter((p) => !p.isBot).length;
    const botCount = 5 - humanCount;
    startBtn.textContent = botCount > 0
      ? `Start Game (+${botCount} Bot${botCount !== 1 ? 's' : ''})`
      : 'Start Game';
    startBtn.disabled = false;
    waitMsg.classList.add('hidden');
  } else {
    startBtn.classList.add('hidden');
    waitMsg.classList.remove('hidden');
  }
}

// ── Study Phase ──
let studyCountdownInterval = null;

function showStudyPhase() {
  const overlay = $('study-overlay');
  overlay.classList.remove('hidden');
  const deckDiv = $('study-deck');
  deckDiv.innerHTML = '';

  const deck = gameState.originalDeck || gameState.deck || [];
  deck.forEach((card, i) => {
    const el = createCardElement(card, 'card-small');
    el.style.animationDelay = `${i * 60}ms`;
    deckDiv.appendChild(el);
  });

  // Reset the Ready button state for this phase
  const btn = $('ready-btn');
  btn.disabled = false;
  btn.textContent = "I'm Ready";

  renderStudyReady({
    readyIds: gameState.readyIds || [],
    connectedIds: gameState.connectedIds || [],
    studyAutoStartAt: gameState.studyAutoStartAt || 0,
  });
  startStudyCountdown(gameState.studyAutoStartAt || 0);
}

function renderStudyReady(msg) {
  const ready = (msg.readyIds || []).length;
  const total = (msg.connectedIds || []).length;
  $('ready-count').textContent = `Ready ${ready}/${total}`;

  // If I'm already in the ready set (e.g. reconnected), lock the btn.
  if (msg.readyIds && msg.readyIds.includes(myPlayerId)) {
    const btn = $('ready-btn');
    btn.disabled = true;
    btn.textContent = 'Ready \u2713';
  }
}

function startStudyCountdown(autoStartAt) {
  stopStudyCountdown();
  if (!autoStartAt) {
    $('ready-countdown').textContent = '';
    return;
  }
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((autoStartAt - Date.now()) / 1000));
    $('ready-countdown').textContent = `Auto-start ${remaining}s`;
    if (remaining <= 0) stopStudyCountdown();
  };
  tick();
  studyCountdownInterval = setInterval(tick, 250);
}

function stopStudyCountdown() {
  if (studyCountdownInterval) {
    clearInterval(studyCountdownInterval);
    studyCountdownInterval = null;
  }
}

function hideStudyOverlay() {
  $('study-overlay').classList.add('hidden');
  stopStudyCountdown();
}

function renderPlayAgainReady(msg) {
  const ready = (msg.readyIds || []).length;
  const total = (msg.connectedIds || []).length;
  const btn = $('play-again-btn');
  const countEl = $('play-again-count');

  // Rematches need at least 2 connected players. If someone's
  // gone solo on the game-over screen, hide Play Again entirely
  // and show a waiting message instead.
  if (total < 2) {
    btn.classList.add('hidden');
    countEl.textContent = 'Need 2+ players for a rematch';
    return;
  }

  btn.classList.remove('hidden');
  countEl.textContent = `Ready ${ready}/${total}`;
  if (msg.readyIds && msg.readyIds.includes(myPlayerId)) {
    btn.disabled = true;
    btn.textContent = 'Ready \u2713';
  }
}

// ── Result Banner ──
function showResultBanner(type, playerName, amount, card, isMe) {
  hideResultBanner();
  const banner = $('result-banner');
  const inner = $('result-banner-inner');
  const cardName = card && typeof card === 'object' ? card.name : String(card);
  const cardPts = card && typeof card === 'object' ? card.value : card;

  if (type === 'won') {
    const who = isMe ? 'You won' : `${esc(playerName)} won`;
    inner.className = 'result-banner-inner won';
    inner.innerHTML = `
      <div class="result-title won">${who} ${esc(cardName)}!</div>
      <div class="result-detail">${cardPts}pts for <span class="result-price">$${amount.toLocaleString()}</span></div>
    `;
  } else {
    inner.className = 'result-banner-inner passed';
    inner.innerHTML = `
      <div class="result-title passed">No bids</div>
      <div class="result-detail">${esc(cardName)} (${cardPts}pts) &mdash; discarded</div>
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
  renderMyInfo();
  updateBidControls();
  // If deck overlay is open, keep it in sync with latest state
  if (!$('deck-overlay').classList.contains('hidden')) {
    renderDeckOverlay();
  }
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
      <span class="opponent-name">${esc(p.name)}${p.isBot ? ' <span class="bot-tag">Bot</span>' : ''}</span>
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
    // Check if we need to rebuild: no card exists, or it has an exit animation, or it's a new_auction
    const existing = container.querySelector('.card-large');
    const needsRebuild = !existing
      || existing.classList.contains('anim-card-awarded')
      || existing.classList.contains('anim-card-passed')
      || existing.getAttribute('data-round') !== String(gameState.roundNumber);
    if (needsRebuild) {
      container.innerHTML = '';
      const card = createCardElement(gameState.currentCard, 'card-large');
      card.id = 'current-card';
      card.setAttribute('data-round', gameState.roundNumber);
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

function renderDeckOverlay() {
  if (!gameState) return;

  // Upcoming (current + remaining in this pass)
  const upcomingContainer = $('deck-upcoming');
  upcomingContainer.innerHTML = '';
  const upcoming = [];
  if (gameState.gameState === 'auction' && gameState.currentCard) {
    upcoming.push(gameState.currentCard);
  }
  (gameState.remainingCards || []).forEach((c) => upcoming.push(c));

  $('deck-upcoming-label').textContent =
    `Upcoming (${upcoming.length})${gameState.inDiscardPhase ? ' — Discard Pass' : ''}`;

  if (upcoming.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'deck-empty-msg';
    msg.textContent = 'No cards left in this pass.';
    upcomingContainer.appendChild(msg);
  } else {
    upcoming.forEach((card) => {
      upcomingContainer.appendChild(createCardElement(card, 'card-small'));
    });
  }

  // Discard pile (cards that went with no bid, waiting for next pass)
  const discardContainer = $('deck-discard');
  discardContainer.innerHTML = '';
  const discard = gameState.discardPile || [];
  $('deck-discard-label').textContent = `Discard (${discard.length})`;

  if (discard.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'deck-empty-msg';
    msg.textContent = 'Nothing discarded yet.';
    discardContainer.appendChild(msg);
  } else {
    discard.forEach((card) => {
      const el = createCardElement(card, 'card-small');
      el.classList.add('card-discarded');
      discardContainer.appendChild(el);
    });
  }

  // Claimed — grouped by player
  const claimedContainer = $('deck-claimed');
  claimedContainer.innerHTML = '';
  const players = gameState.players || [];
  const anyClaimed = players.some((p) => p.cardsWon && p.cardsWon.length > 0);

  if (!anyClaimed) {
    const msg = document.createElement('div');
    msg.className = 'deck-empty-msg';
    msg.textContent = 'No cards claimed yet.';
    claimedContainer.appendChild(msg);
  } else {
    players.forEach((p) => {
      if (!p.cardsWon || p.cardsWon.length === 0) return;
      const row = document.createElement('div');
      row.className = 'deck-claimed-row';
      const total = p.cardsWon.reduce((s, c) => s + (c.value || 0), 0);
      const header = document.createElement('div');
      header.className = 'deck-claimed-header';
      header.innerHTML = `
        <span class="deck-claimed-name">${esc(p.name)}${p.id === myPlayerId ? ' (you)' : ''}</span>
        <span class="deck-claimed-pts">${p.cardsWon.length} cards · ${total} pts</span>
      `;
      row.appendChild(header);
      const cardsWrap = document.createElement('div');
      cardsWrap.className = 'deck-claimed-cards';
      p.cardsWon.forEach((card) => {
        cardsWrap.appendChild(createCardElement(card, 'card-small'));
      });
      row.appendChild(cardsWrap);
      claimedContainer.appendChild(row);
    });
  }
}

function renderMyInfo() {
  const me = getMyPlayer();
  if (!me) return;

  const budgetEl = $('my-budget');
  budgetEl.textContent = `$${me.budget.toLocaleString()}`;
  budgetEl.className = 'stat-value budget-value';
  if (me.budget < 100) budgetEl.classList.add('broke');
  else if (me.budget < 300) budgetEl.classList.add('low-budget');

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

  // More Time button — hidden when not auctioning or when you're the leading bidder
  const moreTimeBtn = $('more-time-btn');
  const isLeading = gameState.highestBidderId === myPlayerId;
  if (isAuction && !isLeading) {
    moreTimeBtn.classList.remove('hidden');
    const alreadyUsed = (gameState.extendedBy || []).includes(myPlayerId);
    moreTimeBtn.disabled = alreadyUsed;
    moreTimeBtn.textContent = alreadyUsed ? 'Time Used' : 'More Time';
  } else {
    moreTimeBtn.classList.add('hidden');
  }
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
function createCardElement(card, sizeClass) {
  const el = document.createElement('div');
  el.className = `card ${sizeClass} card-tier-${card.value}`;
  el.setAttribute('data-value', card.value);
  el.setAttribute('data-name', card.name);
  if (sizeClass === 'card-large') {
    el.innerHTML = `<span class="card-player-name${nameShrinkClass(card.name)}">${esc(card.name)}</span><span class="card-player-value">${card.value}<span class="card-pts-label">pts</span></span>`;
  } else {
    el.innerHTML = `<span class="card-sm-name">${esc(card.name)}</span><span class="card-sm-value">${card.value}</span>`;
  }
  return el;
}

// Pick a shrink class for card-large names based on the longest single
// word so long names (Lewandowski, Ibrahimovic) fit on one line while
// multi-word names (Lamine Yamal, Dani Carvajal) wrap naturally at the space.
function nameShrinkClass(name) {
  if (!name) return '';
  const longestWord = name.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
  if (longestWord >= 11) return ' name-shrink-lg';
  if (longestWord >= 10) return ' name-shrink-md';
  if (longestWord >= 9) return ' name-shrink-sm';
  return '';
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
    case 'last_player_standing': reasonText = 'Last player standing \u2014 everyone else disconnected'; break;
    case 'all_left': reasonText = 'All players left \u2014 highest score wins'; break;
    default: reasonText = 'Game over';
  }
  $('win-reason').textContent = reasonText;

  const players = [...(gameState.players || [])].sort((a, b) => b.score - a.score);
  const scoresDiv = $('final-scores');
  scoresDiv.innerHTML = '';

  players.forEach((p, i) => {
    const entry = document.createElement('div');
    entry.className = 'score-entry';

    const row = document.createElement('div');
    row.className = 'score-row' + (p.id === gameState.winnerId ? ' is-winner' : '');
    const rankIcon = i === 0 ? '\u2654' : `${i + 1}`;
    const hasCards = p.cardsWon && p.cardsWon.length > 0;
    const startOpen = hasCards && p.id === myPlayerId;

    row.innerHTML = `
      <span class="score-rank">${rankIcon}</span>
      <span class="score-name">${esc(p.name)}${p.isBot ? ' <span class="bot-tag">Bot</span>' : ''}${p.id === myPlayerId ? ' (you)' : ''}</span>
      <span class="score-points">${p.score} pts</span>
      <span class="score-budget">$${p.budget.toLocaleString()} left</span>
      ${hasCards ? `<span class="score-toggle">${startOpen ? '\u25b4' : '\u25be'}</span>` : ''}
    `;
    entry.appendChild(row);

    if (hasCards) {
      const teamDiv = document.createElement('div');
      teamDiv.className = 'score-team' + (startOpen ? ' expanded' : '');
      if (startOpen) row.classList.add('team-open');
      p.cardsWon.forEach((card) => {
        teamDiv.appendChild(createCardElement(card, 'card-small'));
      });
      entry.appendChild(teamDiv);

      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        const open = teamDiv.classList.toggle('expanded');
        row.classList.toggle('team-open', open);
        row.querySelector('.score-toggle').textContent = open ? '\u25b4' : '\u25be';
      });
    }

    scoresDiv.appendChild(entry);
  });

  // Play Again is now a ready button that every player presses.
  // Reset it each time the game-over screen is rendered so stale
  // "Ready ✓" state from the previous round doesn't bleed through.
  // renderPlayAgainReady also hides the button entirely when there
  // aren't enough connected players for a rematch.
  const playAgainBtn = $('play-again-btn');
  playAgainBtn.disabled = false;
  playAgainBtn.textContent = 'Play Again';
  renderPlayAgainReady({
    readyIds: gameState.readyIds || [],
    connectedIds: gameState.connectedIds || [],
  });

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

// ── Last-player-standing countdown ──
// When everyone else has disconnected mid-game, the server starts a
// grace timer. We overlay a live countdown so the lone survivor knows
// they're about to win by default (unless somebody reconnects).
let lastPlayerCountdownInterval = null;
let lastPlayerCountdownEl = null;

function startLastPlayerCountdown(graceMs) {
  stopLastPlayerCountdown();
  const endAt = Date.now() + graceMs;

  let el = document.getElementById('last-player-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'last-player-overlay';
    el.className = 'last-player-overlay';
    el.innerHTML = `
      <div class="last-player-card">
        <div class="last-player-title">You're the last one standing</div>
        <div class="last-player-sub">Waiting for others to reconnect&hellip;</div>
        <div class="last-player-count"><span id="last-player-seconds">10</span>s</div>
        <div class="last-player-hint">If nobody returns, you win by default.</div>
      </div>
    `;
    document.body.appendChild(el);
  }
  el.classList.remove('hidden');
  lastPlayerCountdownEl = el;

  const tick = () => {
    const remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    const span = document.getElementById('last-player-seconds');
    if (span) span.textContent = String(remaining);
    if (remaining <= 0) {
      clearInterval(lastPlayerCountdownInterval);
      lastPlayerCountdownInterval = null;
    }
  };
  tick();
  lastPlayerCountdownInterval = setInterval(tick, 250);
}

function stopLastPlayerCountdown() {
  if (lastPlayerCountdownInterval) {
    clearInterval(lastPlayerCountdownInterval);
    lastPlayerCountdownInterval = null;
  }
  if (lastPlayerCountdownEl) {
    lastPlayerCountdownEl.classList.add('hidden');
  }
}
