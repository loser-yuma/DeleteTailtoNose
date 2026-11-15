import Peer from 'peerjs';

const WORDS = [
  'あいどり','いぬ','うさぎ','えんぴつ','おかず','かえる','がっこう','きりん','くま','ぐりむ','けしごむ','こま','さくら','しろ','すし','せき','そら','たこ','ちょうちょ','つき','てんとう虫','どら焼き','なす','にほん','ぬりえ','ねこ','のこぎり','はやし','ひかり','ふくろう','へび','ほし','まつ','みず','むし','めがね','もも','やぎ','ゆき','よる','らっぱ','りんご','るすばん','れもん','ろうか','わに','ゐんか', 'うんち', 'ちょう','おうち','ちいさな','かなかな','なべ','べんとう','とうもろこし','しっぽ','ぽっぽ','ぴかぴか','かたつむり','むしとり','りす','すいか','かき','きのこ','こおり','りょうり','やさい','いちご','ごりら','らいおん','おに','にんじん','じゅうたん','たんぽぽ','ぽてと','とんぼ','ぼうし','しおかぜ','ぜんぶ','ぶどう','うどん','どんぐり','りゅう','ゆうひ','ひつじ','じてんしゃ','しゃぼん','ん'
];

const BASE_HIRAGANA = [
  'あ','い','う','え','お',
  'か','き','く','け','こ',
  'さ','し','す','せ','そ',
  'た','ち','つ','て','と',
  'な','に','ぬ','ね','の',
  'は','ひ','ふ','へ','ほ',
  'ま','み','む','め','も',
  'や','ゆ','よ',
  'ら','り','る','れ','ろ',
  'わ','を','ん'
];

const BASE_MAP = {
  'が':'か','ぎ':'き','ぐ':'く','げ':'け','ご':'こ',
  'ざ':'さ','じ':'し','ず':'す','ぜ':'せ','ぞ':'そ',
  'だ':'た','ぢ':'ち','づ':'つ','で':'て','ど':'と',
  'ば':'は','び':'ひ','ぶ':'ふ','べ':'へ','ぼ':'ほ',
  'ぱ':'は','ぴ':'ひ','ぷ':'ふ','ぺ':'へ','ぽ':'ほ',
  'ぁ':'あ','ぃ':'い','ぅ':'う','ぇ':'え','ぉ':'お',
  'ゃ':'や','ゅ':'ゆ','ょ':'よ','っ':'つ','ゎ':'わ','ゕ':'か','ゖ':'け',
};

const DICTIONARY_URL = `${import.meta.env.BASE_URL}dictionary.data`;
const DICTIONARY_LOAD_TIMEOUT_MS = 15000;

const MAX_PLAYERS = 4;
const ONLINE_ROOM_KEY = 'delete-tailto-nose-room';

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function createOnlineConnection() {
  return {
    peer: null,
    connections: new Map(),
    room: '',
    isHost: false,
    connected: false,
    error: '',
    name: '',
  };
}

function kanaToHiragana(text) {
  return text
    .normalize('NFKC')
    .replace(/[ァ-ヶヷ-ヺ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/ー/g, '')
    .replace(/\s+/g, '')
    .replace(/[！-／：-＠［-｀｛-～]/g, '')
    .replace(/[\u3000]/g, '');
}

function baseKana(ch) {
  return BASE_MAP[ch] || ch;
}

function sanitizePlayerName(name, fallback) {
  const cleanName = String(name || '').replace(/[<>&"'`]/g, '').trim().slice(0, 12);
  return cleanName || fallback;
}

function normalizeWord(word) {
  const normalized = kanaToHiragana(word)
    .replace(/[\uFF01-\uFF5E]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/\r|\n/g, '');

  return normalized;
}

let dictionary = new Map();

async function loadDictionary() {
  const controller = new AbortController();
  let timeout;
  const load = (async () => {
    const response = await fetch(DICTIONARY_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`辞書データを読み込めませんでした: ${response.status}`);
    }

    const compressed = await response.arrayBuffer();
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    return JSON.parse(text);
  })();
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('辞書データの読み込みがタイムアウトしました。')), DICTIONARY_LOAD_TIMEOUT_MS);
  });

  try {
    dictionary = new Map(await Promise.race([load, deadline]));
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function lookupDictionaryEntry(word) {
  const reading = dictionary.get(normalizeWord(word));
  return reading ? { found: true, reading } : { found: false, reading: null };
}

function countChars(chars) {
  return chars.reduce((result, ch) => {
    result[ch] = (result[ch] || 0) + 1;
    return result;
  }, {});
}

function removeTilesFromHand(hand, word, allowLead = true) {
  const nextHand = [...hand];
  const counts = countChars(nextHand.map(baseKana));
  const normalized = normalizeWord(word);

  for (let i = allowLead ? 1 : 0; i < normalized.length; i += 1) {
    const key = baseKana(normalized[i]);
    if ((counts[key] || 0) <= 0) {
      return null;
    }
    counts[key] -= 1;
    const index = nextHand.findIndex(tile => baseKana(tile) === key);
    if (index === -1) {
      return null;
    }
    nextHand.splice(index, 1);
  }

  return nextHand;
}

function canUseWord(word, hand, lead) {
  const normalized = normalizeWord(word);
  if (!normalized) {
    return { valid: false, reason: '単語を入力してください。' };
  }

  if (lead && baseKana(normalized[0]) !== baseKana(lead)) {
    return { valid: false, reason: `先頭は「${lead}」で始める必要があります。` };
  }

  const counts = countChars(hand.map(baseKana));
  for (let i = lead ? 1 : 0; i < normalized.length; i += 1) {
    const key = baseKana(normalized[i]);
    if ((counts[key] || 0) <= 0) {
      return { valid: false, reason: `「${key}」は持ち駒にありません。` };
    }
    counts[key] -= 1;
  }

  return { valid: true, reason: 'OK' };
}

function getValidMoves(lead, hand) {
  return WORDS.filter(word => {
    const normalized = normalizeWord(word);
    if (!normalized) return false;
    if (lead && baseKana(normalized[0]) !== baseKana(lead)) return false;
    return canUseWord(normalized, hand, lead).valid;
  });
}

function getSafeValidMoves(lead, hand) {
  return getValidMoves(lead, hand).filter(word => !normalizeWord(word).endsWith('ん'));
}

function chooseBestCpuMove(lead, hand, opponentHand) {
  const candidates = getSafeValidMoves(lead, hand);
  if (!candidates.length) return null;

  return candidates
    .map(word => {
      const normalized = normalizeWord(word);
      const nextHand = removeTilesFromHand(hand, normalized, Boolean(lead));
      const nextLead = normalized.slice(-1);
      const opponentMoves = getSafeValidMoves(nextLead, opponentHand).length;
      const ownMoves = nextHand ? getSafeValidMoves(nextLead, nextHand).length : 0;
      const score = (nextHand?.length === 0 ? 20000 : 0)
        + (opponentMoves === 0 ? 10000 : 0)
        - opponentMoves * 20
        + Math.min(ownMoves, 10) * 3
        + normalized.length * 2;
      return { word: normalized, score };
    })
    .sort((a, b) => b.score - a.score)[0].word;
}

function randomHand() {
  return [...BASE_HIRAGANA];
}

function makePlayer(name, isHuman) {
  return {
    id: crypto.randomUUID(),
    name,
    isHuman,
    hand: randomHand(),
  };
}

function stateFactory(mode = 'cpu') {
  const players = [
    makePlayer('プレイヤー1', true),
    ...(mode === 'cpu'
      ? [makePlayer('CPU', false)]
      : mode === 'local'
        ? [makePlayer('プレイヤー2', true)]
        : [])
  ];

  return {
    mode,
    players,
    history: [],
    currentLead: null,
    activeIndex: 0,
    gameOver: false,
    winner: null,
    status: '好きな単語からどうぞ。',
    lastError: '',
    selectedWord: '',
    pending: false,
    showRules: false,
    online: createOnlineConnection(),
    room: '',
    lobby: mode === 'online',
  };
}

function getActivePlayer(state) {
  return state.players[state.activeIndex];
}

function getOpponentPlayer(state) {
  return state.players[(state.activeIndex + 1) % state.players.length];
}

function renderHand(hand) {
  if (!hand.length) {
    return '<div class="empty-hand">駒なし</div>';
  }

  return hand
    .map(tile => `<span class="tile">${tile}</span>`)
    .join('');
}

function onlineSnapshot(state) {
  return {
    type: 'state',
    state: {
      mode: 'online',
      players: state.players.map(({ isHuman, ...player }) => ({ ...player })),
      history: state.history,
      currentLead: state.currentLead,
      activeIndex: state.activeIndex,
      gameOver: state.gameOver,
      winner: state.winner,
      status: state.status,
      lastError: state.lastError,
      selectedWord: '',
      pending: false,
      showRules: false,
      room: state.room,
      lobby: state.lobby,
    },
  };
}

function broadcastOnlineState(state) {
  if (!state.online.isHost || !state.online.connections.size || state.lobby) return;
  const message = onlineSnapshot(state);
  state.online.connections.forEach(connection => connection.send(message));
}

function renderOnlineLobby(app, state) {
  const online = state.online;
  const players = state.players.map(player => `<li>${player.name}${player.peerId === online.peerId ? '（あなた）' : ''}</li>`).join('');
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand"><h1>消去しりとり</h1></div>
        <div class="toolbar">
          <label>対戦モード
            <select id="mode-select">
              <option value="cpu">CPU対戦</option>
              <option value="local">ローカル対戦</option>
              <option value="online" selected>オンライン対戦</option>
            </select>
          </label>
          <button id="new-game" class="primary">最初から</button>
        </div>
      </header>
      <main class="online-lobby">
        <h2>オンライン対戦（最大4人）</h2>
        <p class="status-text">名前を入力してルームを作成するか、招待コードで参加してください。</p>
        <label for="online-name">プレイヤー名</label>
        <input id="online-name" type="text" maxlength="12" value="${online.name}" placeholder="プレイヤー1" />
        <div class="online-actions">
          <button id="create-room" class="primary">ルームを作成</button>
          <input id="room-input" type="text" maxlength="6" placeholder="招待コード" aria-label="招待コード" />
          <button id="join-room" class="secondary">参加する</button>
        </div>
        ${online.room ? `
          <div class="room-card">
            <strong>招待コード: ${online.room}</strong>
            <p>このコードを友だちに共有してください。</p>
            <ol>${players || '<li>参加者を待っています…</li>'}</ol>
            ${online.isHost ? '<button id="start-online" class="primary">対戦を開始</button>' : '<p>ホストが対戦を開始するまでお待ちください。</p>'}
          </div>
        ` : ''}
        ${online.error ? `<p class="status-error" role="alert">${online.error}</p>` : ''}
      </main>
    </div>
  `;

  const nameInput = document.querySelector('#online-name');
  nameInput?.addEventListener('input', event => { online.name = event.target.value; });
  document.querySelector('#create-room')?.addEventListener('click', () => createOnlineRoom(state));
  document.querySelector('#join-room')?.addEventListener('click', () => {
    joinOnlineRoom(state, document.querySelector('#room-input')?.value || '');
  });
  document.querySelector('#start-online')?.addEventListener('click', () => {
    if (!online.isHost || state.players.length < 2) {
      online.error = '参加者が1人以上必要です。';
      renderState(app, state);
      return;
    }
    state.lobby = false;
    state.status = `${getActivePlayer(state).name}の番です。`;
    broadcastOnlineState(state);
    renderState(app, state);
  });
  document.querySelector('#mode-select')?.addEventListener('change', event => {
    const nextState = stateFactory(event.target.value);
    state = nextState;
    renderState(app, state);
  });
  document.querySelector('#new-game')?.addEventListener('click', () => {
    state = stateFactory(document.querySelector('#mode-select')?.value || 'online');
    renderState(app, state);
  });
}

function attachOnlineConnection(state, connection) {
  state.online.connections.set(connection.peer, connection);
  connection.on('data', message => {
    if (state.online.isHost && message?.type === 'hello') {
      if (state.players.length >= MAX_PLAYERS) {
        connection.send({ type: 'error', message: 'このルームは満員です。' });
        connection.close();
        return;
      }
      const player = makePlayer(sanitizePlayerName(message.name, `プレイヤー${state.players.length + 1}`), false);
      player.peerId = connection.peer;
      state.players.push(player);
      connection.send(onlineSnapshot(state));
      renderState(app, state);
      return;
    }

    if (state.online.isHost && message?.type === 'move') {
      const index = state.players.findIndex(player => player.peerId === connection.peer);
      if (index !== state.activeIndex || state.lobby) return;
      requestMove(state, message.word);
      return;
    }

    if (state.online.isHost && message?.type === 'giveup') {
      const index = state.players.findIndex(player => player.peerId === connection.peer);
      if (index !== state.activeIndex || state.lobby || state.gameOver) return;
      const player = state.players[index];
      const winner = getOpponentPlayer(state);
      state.gameOver = true;
      state.winner = winner.name;
      state.status = `${player.name}がギブアップしました。${winner.name}の勝ちです。`;
      renderState(app, state);
      return;
    }

    if (!state.online.isHost && message?.type === 'state') {
      const snapshot = message.state;
      Object.assign(state, snapshot, { online: state.online, pending: false });
      state.players = snapshot.players.map(player => ({
        ...player,
        isHuman: player.peerId === state.online.peerId,
      }));
      renderState(app, state);
    }
  });
  connection.on('close', () => {
    state.online.connections.delete(connection.peer);
    if (state.online.isHost) {
      const removedIndex = state.players.findIndex(player => player.peerId === connection.peer);
      if (removedIndex !== -1) {
        state.players.splice(removedIndex, 1);
        if (state.activeIndex >= state.players.length) state.activeIndex = 0;
        renderState(app, state);
      }
    }
  });
}

function createOnlineRoom(state) {
  const room = makeRoomCode();
  const peer = new Peer(`shiri-${room.toLowerCase()}`);
  state.online = { ...createOnlineConnection(), peer, isHost: true, room, name: state.online.name || 'プレイヤー1' };
  state.room = room;
  state.online.name = sanitizePlayerName(state.online.name, 'プレイヤー1');
  state.players[0].name = state.online.name;
  state.players[0].peerId = `shiri-${room.toLowerCase()}`;
  peer.on('open', () => {
    state.online.connected = true;
    state.online.peerId = peer.id;
    state.online.error = '';
    renderState(app, state);
  });
  peer.on('connection', connection => attachOnlineConnection(state, connection));
  peer.on('error', error => {
    state.online.error = error.type === 'unavailable-id'
      ? 'そのルームコードは使用中です。もう一度作成してください。'
      : '接続に失敗しました。時間をおいて再度お試しください。';
    renderState(app, state);
  });
  renderState(app, state);
}

function joinOnlineRoom(state, rawRoom) {
  const room = rawRoom.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(room)) {
    state.online.error = '6桁の招待コードを入力してください。';
    renderState(app, state);
    return;
  }
  const peer = new Peer();
  state.online = { ...createOnlineConnection(), peer, room, name: sanitizePlayerName(state.online.name, 'プレイヤー') };
  state.room = room;
  peer.on('open', () => {
    state.online.peerId = peer.id;
    const connection = peer.connect(`shiri-${room.toLowerCase()}`, { reliable: true });
    connection.on('open', () => {
      attachOnlineConnection(state, connection);
      connection.send({ type: 'hello', name: state.online.name });
      state.online.connected = true;
      renderState(app, state);
    });
  });
  peer.on('error', () => {
    state.online.error = 'ルームに接続できませんでした。コードを確認してください。';
    renderState(app, state);
  });
  renderState(app, state);
}

function renderState(app, state) {
  if (state.mode === 'online' && state.lobby) {
    renderOnlineLobby(app, state);
    return;
  }
  broadcastOnlineState(state);
  const active = getActivePlayer(state);
  const opponent = getOpponentPlayer(state);
  const canHumanAct = !state.gameOver && !state.pending && active.isHuman;
  const validMoves = state.currentLead ? getValidMoves(state.currentLead, active.hand) : WORDS.filter(word => canUseWord(normalizeWord(word), active.hand, null).valid);

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <h1>消去しりとり</h1>
        </div>
        <div class="toolbar">
          <label>
            対戦モード
            <select id="mode-select">
              <option value="cpu" ${state.mode === 'cpu' ? 'selected' : ''}>CPU対戦</option>
              <option value="local" ${state.mode === 'local' ? 'selected' : ''}>ローカル対戦</option>
              <option value="online" ${state.mode === 'online' ? 'selected' : ''}>オンライン対戦</option>
            </select>
          </label>
          <button id="new-game" class="primary">最初から</button>
          <button
            id="rules-toggle"
            class="secondary"
            type="button"
            aria-expanded="${state.showRules}"
            aria-controls="rules-panel"
          >${state.showRules ? '遊び方を閉じる' : '遊び方'}</button>
        </div>
      </header>

      ${state.showRules ? `
        <section id="rules-panel" class="rules-panel" aria-labelledby="rules-title">
          <div class="rules-heading">
            <h2 id="rules-title">遊び方</h2>
          </div>
          <ol class="rules-list">
            <li>最初の単語は自由です。次の単語は、前の単語の最後の文字から始めます。</li>
            <li>単語の先頭以外の文字は、持ち駒から使います。使った駒は戻りません。</li>
            <li>「ん」で終わる単語を言うと負けです。持ち駒を先に使い切るか、相手が単語を作れなくなると勝ちです。</li>
          </ol>
          <p class="rules-note">JMdictとSudachiDictを元にした内蔵辞書で単語を確認します。</p>
        </section>
      ` : ''}

      <main class="board">
        <section class="arena ${state.mode === 'online' ? 'online-arena' : ''}">
          ${state.players.map((player, index) => `
            <div class="player-card ${state.activeIndex === index ? 'is-active' : ''}" role="group" aria-label="${player.name}の持ち駒">
              <div class="player-header">
                <span>${player.name}${player.isHuman && state.mode === 'online' ? '（あなた）' : ''}</span>
                <span class="badge">${player.hand.length}枚${state.activeIndex === index ? '・手番' : ''}</span>
              </div>
              <div class="hand" role="group" aria-label="持ち駒 ${player.hand.length}枚">${renderHand(player.hand)}</div>
            </div>
          `).join('')}

          <div class="status-panel ${state.gameOver ? 'is-game-over' : ''}">
            <div class="lead-box">
              <span class="lead-label">次の文字</span>
              <strong>${state.currentLead ? state.currentLead : '自由'}</strong>
            </div>
            <p class="status-text" role="status" aria-live="polite">${state.status}</p>
            ${state.lastError ? `<p class="status-error" role="alert">${state.lastError}</p>` : ''}
            ${state.gameOver ? `<p class="winner-box">勝者: ${state.winner}</p>` : ''}
          </div>

        </section>

        <section class="controls">
          <label for="word-input">単語</label>
          <div class="input-row">
              <input id="word-input" type="text" value="${state.selectedWord}" placeholder="例: りんご" maxlength="20" autocomplete="off" aria-label="単語を入力" ${canHumanAct ? '' : 'disabled'} />
            <button id="play-button" class="primary" ${canHumanAct ? '' : 'disabled'}>${state.pending ? '確認中…' : '単語を使う'}</button>
            <button id="give-up" class="secondary" ${canHumanAct ? '' : 'disabled'}>ギブアップ</button>
          </div>

          <div class="suggestions">
            <p>作れる単語</p>
            <div class="suggestion-list">
              ${validMoves.slice(0, 8).map(word => `<button type="button" class="suggestion" data-word="${word}" ${canHumanAct ? '' : 'disabled'}>${word}</button>`).join('') || '<span class="muted">候補なし</span>'}
            </div>
          </div>
        </section>

        <section class="history-panel">
          <h2>履歴</h2>
          <ol>
            ${state.history.length
              ? state.history.map(item => `<li>${item.player}: ${item.word}</li>`).join('')
              : '<li>まだありません</li>'}
          </ol>
        </section>
      </main>
    </div>
  `;

  const input = document.querySelector('#word-input');
  if (input && canHumanAct) {
    input.addEventListener('input', event => {
      state.selectedWord = event.target.value;
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        requestMove(state, input.value);
      }
    });
  }

  document.querySelector('#rules-toggle')?.addEventListener('click', () => {
    state.showRules = !state.showRules;
    renderState(app, state);
  });

  document.querySelector('#play-button')?.addEventListener('click', () => {
    const value = input?.value || '';
    requestMove(state, value);
  });

  document.querySelector('#give-up')?.addEventListener('click', () => {
    if (state.gameOver || state.pending || !getActivePlayer(state).isHuman) return;

    if (state.mode === 'online' && !state.online.isHost) {
      const connection = [...state.online.connections.values()][0];
      if (connection?.open) {
        state.pending = true;
        connection.send({ type: 'giveup' });
        renderState(app, state);
      }
      return;
    }

    const player = getActivePlayer(state);
    const winner = getOpponentPlayer(state);
    state.gameOver = true;
    state.winner = winner.name;
    state.status = `${player.name}がギブアップしました。${winner.name}の勝ちです。`;
    state.lastError = '';
    state.selectedWord = '';
    renderState(app, state);
  });

  document.querySelector('#new-game')?.addEventListener('click', () => {
    const nextMode = document.querySelector('#mode-select')?.value || 'cpu';
    const nextState = stateFactory(nextMode);
    renderState(app, nextState);
    state.mode = nextMode;
    state = nextState;
  });

  document.querySelector('#mode-select')?.addEventListener('change', event => {
    const nextMode = event.target.value;
    const nextState = stateFactory(nextMode);
    renderState(app, nextState);
    state.mode = nextMode;
    state = nextState;
  });

  document.querySelectorAll('.suggestion').forEach(button => {
    button.addEventListener('click', () => {
      const value = button.dataset.word || '';
      const wordInput = document.querySelector('#word-input');
      if (wordInput) {
        wordInput.value = value;
        state.selectedWord = value;
      }
    });
  });
}

  async function requestMove(currentState, rawValue) {
    if (currentState.gameOver || currentState.pending) return;

  const player = getActivePlayer(currentState);
    if (currentState.mode === 'online' && !currentState.online.isHost) {
      const connection = [...currentState.online.connections.values()][0];
      if (!connection?.open || !player.isHuman) return;
      currentState.pending = true;
      currentState.lastError = '';
      connection.send({ type: 'move', word: rawValue });
      renderState(app, currentState);
      return;
    }
  let normalized = normalizeWord(rawValue);
  const lead = currentState.currentLead;

  if (!normalized) {
    currentState.lastError = '単語を入力してください。';
    renderState(app, currentState);
    return;
  }

  if (player.isHuman || currentState.mode === 'online') {
    currentState.pending = true;
    currentState.lastError = '';
    renderState(app, currentState);

    try {
      await dictionaryReady;
      if (dictionaryLoadError) throw dictionaryLoadError;
      const entry = lookupDictionaryEntry(rawValue.trim());
      if (state !== currentState) return;
      currentState.pending = false;
      if (!entry.found) {
        currentState.lastError = '辞書に登録されていない単語です。';
        renderState(app, currentState);
        return;
      }
      normalized = entry.reading;
    } catch {
      if (state !== currentState) return;
      currentState.pending = false;
      currentState.lastError = '辞書データを読み込めませんでした。ページを再読み込みしてください。';
      renderState(app, currentState);
      return;
    }
  }

  const validation = canUseWord(normalized, player.hand, lead);
  if (!validation.valid) {
    currentState.lastError = validation.reason;
    renderState(app, currentState);
    return;
  }

  const nextHand = removeTilesFromHand(player.hand, normalized, Boolean(lead));
  if (!nextHand) {
    currentState.lastError = 'その単語は持ち駒では作れません。';
    renderState(app, currentState);
    return;
  }

  player.hand = nextHand;
  currentState.history.push({ player: player.name, word: normalized });
  currentState.currentLead = normalizeWord(normalized).slice(-1) || null;
  currentState.lastError = '';
  currentState.selectedWord = '';

  if (normalized.endsWith('ん')) {
    const opponent = getOpponentPlayer(currentState);
    currentState.gameOver = true;
    currentState.winner = opponent.name;
    currentState.status = `${player.name}は「ん」で終わる単語を言ったため敗北。${opponent.name}の勝利です。`;
    renderState(app, currentState);
    return;
  }

  if (player.hand.length === 0) {
    currentState.gameOver = true;
    currentState.winner = player.name;
    currentState.status = `${player.name}が駒を使い切りました。`;
    renderState(app, currentState);
    return;
  }

  currentState.activeIndex = (currentState.activeIndex + 1) % currentState.players.length;
  const nextPlayer = getActivePlayer(currentState);
  const nextMoves = nextPlayer.isHuman
    ? getValidMoves(currentState.currentLead, nextPlayer.hand)
    : getSafeValidMoves(currentState.currentLead, nextPlayer.hand);

  if (!nextMoves.length) {
    currentState.gameOver = true;
    currentState.winner = player.name;
    currentState.status = `${nextPlayer.name}は作れる単語がありません。${player.name}の勝ちです。`;
    renderState(app, currentState);
    return;
  }

  currentState.status = `${nextPlayer.name}の番です。`;
  renderState(app, currentState);

  if (!nextPlayer.isHuman) {
    setTimeout(() => {
      if (state !== currentState || currentState.gameOver) return;
      const cpuWord = chooseBestCpuMove(currentState.currentLead, nextPlayer.hand, player.hand);
      if (!cpuWord) {
        currentState.gameOver = true;
        currentState.winner = player.name;
        currentState.status = `${nextPlayer.name}は作れる単語がありません。${player.name}の勝ちです。`;
        renderState(app, currentState);
        return;
      }
      requestMove(currentState, cpuWord);
    }, 500);
  }
}

let app;
let state;
let dictionaryLoadError;
const dictionaryReady = new Promise(resolve => {
  setTimeout(async () => {
    try {
      await loadDictionary();
    } catch (error) {
      dictionaryLoadError = error;
    } finally {
      resolve();
    }
  }, 100);
});

function init() {
  app = document.querySelector('#app');
  state = stateFactory('cpu');
  renderState(app, state);
}

init();
