const BOARD_SIZE = 10;
const LETTERS = "ABCDEFGHIJ".split("");
const FLEET = [
  { id: "battleship", name: "Линкор", size: 4, count: 1 },
  { id: "cruiser", name: "Крейсер", size: 3, count: 2 },
  { id: "destroyer", name: "Эсминец", size: 2, count: 3 },
  { id: "submarine", name: "Подлодка", size: 1, count: 4 },
];

const el = (id) => document.getElementById(id);
const randomId = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
const nowTime = () => new Date().toLocaleTimeString();
const defaultWsUrl = () => "wss://free.blr2.piesocket.com/v3/1?api_key=DEMOKEY&notify_self=1";

const createBoard = () => {
  const grid = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  return {
    grid,
    ships: {},
    shots: new Set(),
    sunk: new Set(),
  };
};

const cloneFleetState = () =>
  FLEET.map((ship) => ({ ...ship, placed: 0, cells: [] }));

const coordToText = ([r, c]) => `${LETTERS[c]}${r + 1}`;
const cellKey = (r, c) => `${r}:${c}`;

class BroadcastBridge {
  constructor(room, id, onMessage, onStatus) {
    this.room = room;
    this.id = id;
    this.channel = new BroadcastChannel(`battleship-room-${room}`);
    this.channel.onmessage = (evt) => {
      const payload = evt.data;
      if (payload.room !== this.room || payload.sender === this.id) return;
      onMessage(payload);
    };
    onStatus("connected-local");
  }

  send(message) {
    this.channel.postMessage({ ...message, room: this.room, sender: this.id });
  }

  close() {
    this.channel.close();
  }
}

class WebSocketBridge {
  constructor(url, room, id, onMessage, onStatus, onClose) {
    this.socket = new WebSocket(url);
    this.room = room;
    this.id = id;
    this.onClose = onClose;
    this.socket.addEventListener("open", () => onStatus("connected-ws"));
    this.socket.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.room !== this.room || data.sender === this.id) return;
        onMessage(data);
      } catch (err) {
        console.warn("Неверный пакет", err);
      }
    });
    this.socket.addEventListener("close", () => {
      onStatus("closed");
      if (this.onClose) this.onClose();
    });
    this.socket.addEventListener("error", () => {
      onStatus("closed");
      if (this.onClose) this.onClose();
    });
  }

  send(message) {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  close() {
    this.socket.close();
  }
}

class LocalRelayBridge {
  constructor(room, id, onMessage, onStatus) {
    this.room = room;
    this.id = id;
    this.listeners = [];
    onStatus("connected-localstorage");
    const handler = this.handleEvent.bind(this, onMessage);
    window.addEventListener("storage", handler);
    this.listeners.push(() => window.removeEventListener("storage", handler));
  }

  handleEvent(onMessage, event) {
    if (event.key !== `battleship-${this.room}` || !event.newValue) return;
    try {
      const payload = JSON.parse(event.newValue);
      if (payload.sender === this.id) return;
      onMessage(payload);
    } catch (err) {
      console.warn("Invalid relay packet", err);
    }
  }

  send(message) {
    localStorage.setItem(`battleship-${this.room}`, JSON.stringify({ ...message, room: this.room, sender: this.id, ts: Date.now() }));
  }

  close() {
    this.listeners.forEach((fn) => fn());
  }
}

class Transport {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.clientId = randomId();
    this.bridge = null;
    this.mode = "local";
    this.lastUrl = "";
  }

  connect(room, options = {}) {
    this.room = room;
    this.mode = options.mode || "local";
    if (this.bridge) this.bridge.close();

    if (this.mode === "ws" && options.url) {
      try {
        this.lastUrl = options.url;
        this.bridge = new WebSocketBridge(
          options.url,
          room,
          this.clientId,
          this.onMessage,
          this.onStatus,
          () => this.switchToLocal("ws-closed")
        );
        setTimeout(() => {
          if (!this.bridge || this.bridge.socket.readyState !== WebSocket.OPEN) {
            this.switchToLocal("ws-timeout");
          }
        }, 1500);
        return;
      } catch (err) {
        console.warn("WS недоступен, переходим в локальный режим", err);
      }
    }

    this.switchToLocal("no-ws");
  }

  switchToLocal(reason) {
    this.bridge?.close?.();
    try {
      this.bridge = new BroadcastBridge(this.room, this.clientId, this.onMessage, this.onStatus);
    } catch (err) {
      this.bridge = new LocalRelayBridge(this.room, this.clientId, this.onMessage, this.onStatus);
    }
    this.mode = "local";
    if (reason) {
      this.onStatus(`fallback:${reason}`);
    }
  }

  send(payload) {
    if (!this.bridge) return;
    this.bridge.send({ ...payload, sender: this.clientId, room: this.room });
  }
}

const state = {
  name: "Адмирал",
  room: "public",
  orientation: "horizontal",
  fleet: cloneFleetState(),
  selectedShipId: null,
  playerBoard: createBoard(),
  opponentBoard: createBoard(),
  ready: false,
  opponentReady: false,
  phase: "placement",
  turn: "",
  opponent: null,
  transport: null,
  localBot: false,
  joinTimer: null,
  autoConnect: false,
};

const logStream = el("log-stream");
const log = (text, variant = "") => {
  const row = document.createElement("div");
  row.className = "log-entry";
  const time = document.createElement("span");
  time.className = "time";
  time.textContent = nowTime();
  const body = document.createElement("span");
  body.className = `text ${variant}`;
  body.textContent = text;
  row.append(time, body);
  logStream.append(row);
  logStream.scrollTop = logStream.scrollHeight;
};

const renderFleet = () => {
  const container = el("shipyard");
  container.innerHTML = "";
  state.fleet.forEach((ship) => {
    const remaining = ship.count - ship.placed;
    const card = document.createElement("div");
    card.className = "ship-card" + (state.selectedShipId === ship.id ? " active" : "");
    card.dataset.ship = ship.id;
    card.innerHTML = `
      <div class="badge">${ship.name}</div>
      <div class="meta">Размер: ${ship.size} | Осталось: ${remaining}</div>
    `;
    card.addEventListener("click", () => {
      state.selectedShipId = ship.id;
      renderFleet();
    });
    container.appendChild(card);
  });
};

const buildGrid = (container, isOpponent) => {
  container.innerHTML = "";
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.title = `${LETTERS[c]}${r + 1}`;
      if (isOpponent) {
        cell.addEventListener("click", () => tryAttack(r, c));
      } else {
        cell.addEventListener("click", () => tryPlaceShip(r, c));
      }
      container.appendChild(cell);
    }
  }
};

const placeable = (board, r, c, size, orientation) => {
  if (orientation === "horizontal" && c + size > BOARD_SIZE) return false;
  if (orientation === "vertical" && r + size > BOARD_SIZE) return false;
  for (let i = 0; i < size; i++) {
    const rr = r + (orientation === "vertical" ? i : 0);
    const cc = c + (orientation === "horizontal" ? i : 0);
    if (board.grid[rr][cc]) return false;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = rr + dr;
        const nc = cc + dc;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
        if (board.grid[nr][nc]) return false;
      }
    }
  }
  return true;
};

const commitPlacement = (ship, r, c) => {
  const board = state.playerBoard;
  const cells = [];
  const shipKey = `${ship.id}-${ship.placed}`;
  for (let i = 0; i < ship.size; i++) {
    const rr = r + (state.orientation === "vertical" ? i : 0);
    const cc = c + (state.orientation === "horizontal" ? i : 0);
    board.grid[rr][cc] = shipKey;
    cells.push([rr, cc]);
  }
  board.ships[shipKey] = { name: ship.name, cells, hits: new Set(), sunkCells: new Set() };
  ship.placed += 1;
};

const tryPlaceShip = (r, c) => {
  if (state.phase !== "placement") return;
  const ship = state.fleet.find((s) => s.id === state.selectedShipId);
  if (!ship) return;
  if (ship.placed >= ship.count) return;
  if (!placeable(state.playerBoard, r, c, ship.size, state.orientation)) return;
  commitPlacement(ship, r, c);
  renderBoard("player");
  renderFleet();
  checkReady();
};

const autoPlace = () => {
  state.playerBoard = createBoard();
  state.fleet = cloneFleetState();
  FLEET.forEach((ship) => {
    for (let i = 0; i < ship.count; i++) {
      let placed = false;
      let guard = 0;
      while (!placed && guard < 400) {
        guard += 1;
        const orientation = Math.random() > 0.5 ? "horizontal" : "vertical";
        const r = Math.floor(Math.random() * BOARD_SIZE);
        const c = Math.floor(Math.random() * BOARD_SIZE);
        if (placeable(state.playerBoard, r, c, ship.size, orientation)) {
          state.orientation = orientation;
          const fleetShip = state.fleet.find((s) => s.id === ship.id);
          state.selectedShipId = ship.id;
          commitPlacement(fleetShip, r, c);
          placed = true;
        }
      }
    }
  });
  renderBoard("player");
  renderFleet();
  checkReady();
};

const checkReady = () => {
  const allPlaced = state.fleet.every((s) => s.placed === s.count);
  el("ready-btn").disabled = !allPlaced || state.phase !== "placement";
  if (allPlaced && !state.selectedShipId) state.selectedShipId = state.fleet[0].id;
};

const renderBoard = (side) => {
  const board = side === "player" ? state.playerBoard : state.opponentBoard;
  const gridEl = side === "player" ? el("player-grid") : el("opponent-grid");
  gridEl.querySelectorAll(".cell").forEach((cell) => {
    const r = Number(cell.dataset.row);
    const c = Number(cell.dataset.col);
    cell.className = "cell";
    const mark = board.grid[r][c];
    const key = cellKey(r, c);
    if (side === "player" && mark) cell.classList.add("ship");
    if (board.shots.has(key)) {
      const content = mark ? "hit" : "miss";
      cell.classList.add(content);
    }
    if (side === "player" && mark && board.ships[mark]?.sunkCells?.has(key)) {
      cell.classList.add("sunk");
    }
    if (side === "opponent" && board.sunk.has(key)) {
      cell.classList.add("sunk");
    }
  });
};

const toggleOrientation = () => {
  state.orientation = state.orientation === "horizontal" ? "vertical" : "horizontal";
  el("orientation-btn").textContent = state.orientation === "horizontal" ? "Горизонтально" : "Вертикально";
};

const applyIncomingAttack = (r, c) => {
  const board = state.playerBoard;
  const key = cellKey(r, c);
  if (board.shots.has(key)) return { result: "repeat" };
  board.shots.add(key);
  const shipId = board.grid[r][c];
  if (!shipId) return { result: "miss" };
  const shipEntry = board.ships[shipId];
  shipEntry.hits.add(key);
  const allHit = shipEntry.hits.size === shipEntry.cells.length;
  if (allHit) {
    shipEntry.sunkCells = new Set(shipEntry.cells.map(([rr, cc]) => cellKey(rr, cc)));
    shipEntry.cells.forEach(([rr, cc]) => board.sunk.add(cellKey(rr, cc)));
    const finished = Object.values(board.ships).every((s) => s.hits.size === s.cells.length);
    return { result: finished ? "defeat" : "sunk", ship: shipEntry.name, cells: shipEntry.cells };
  }
  return { result: "hit" };
};

const tryAttack = (r, c) => {
  if (state.phase !== "playing" || state.turn !== "you" || (state.localBot === true && state.opponentReady === false)) return;
  const key = cellKey(r, c);
  if (state.opponentBoard.shots.has(key)) return;
  state.opponentBoard.shots.add(key);

  if (state.localBot) {
    const outcome = resolveAttackAgainstBot(r, c);
    handleAttackResult({ r, c, ...outcome, from: "self" });
    return;
  }

  if (!state.transport) return;
  state.turn = "opponent";
  updateTurn();
  state.transport.send({
    type: "attack",
    payload: { r, c, name: state.name },
  });
};

const resolveAttackAgainstBot = (r, c) => {
  const board = state.opponentBoard;
  const key = cellKey(r, c);
  const shipId = board.grid[r][c];
  if (!shipId) return { result: "miss" };
  const shipEntry = board.ships[shipId];
  shipEntry.hits.add(key);
  const sunk = shipEntry.hits.size === shipEntry.cells.length;
  if (sunk) {
    shipEntry.sunkCells = new Set(shipEntry.cells.map(([rr, cc]) => cellKey(rr, cc)));
    shipEntry.cells.forEach(([rr, cc]) => board.sunk.add(cellKey(rr, cc)));
    const finished = Object.values(board.ships).every((s) => s.hits.size === s.cells.length);
    return { result: finished ? "victory" : "sunk", ship: shipEntry.name, cells: shipEntry.cells };
  }
  return { result: "hit" };
};

const handleAttackResult = (data) => {
  const { r, c, result, ship, cells } = data;
  const board = state.opponentBoard;
  if (result === "repeat") return;
  const key = cellKey(r, c);
  if (!board.shots.has(key)) board.shots.add(key);

  if (result === "hit" || result === "sunk" || result === "victory") {
    board.grid[r][c] = board.grid[r][c] || "hit";
    if (cells) {
      cells.forEach(([rr, cc]) => {
        board.grid[rr][cc] = board.grid[rr][cc] || "hit";
        board.sunk.add(cellKey(rr, cc));
      });
    }
  }

  renderBoard("opponent");

  if (result === "miss") {
    log(`Промах по ${coordToText([r, c])}.`, "miss");
    state.turn = "opponent";
  } else if (result === "hit") {
    log(`Попадание по ${coordToText([r, c])}!`, "hit");
    state.turn = "you";
  } else if (result === "sunk") {
    log(`Корабль противника потоплен: ${ship || ""}!`, "sunk");
    state.turn = "you";
  } else if (result === "victory") {
    log("Все корабли противника потоплены. Победа!", "sunk");
    state.phase = "finished";
    el("turn-indicator").textContent = "Победа";
    el("opponent-status").textContent = "Вы выиграли";
    return;
  }
  updateTurn();
  if (state.localBot && state.phase === "playing" && state.turn === "opponent") {
    setTimeout(botTurn, 650);
  }
};

const botTurn = () => {
  if (state.phase !== "playing" || state.turn !== "opponent") return;
  const attempts = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      attempts.push([r, c]);
    }
  }
  while (attempts.length) {
    const idx = Math.floor(Math.random() * attempts.length);
    const [r, c] = attempts.splice(idx, 1)[0];
    const key = cellKey(r, c);
    if (state.playerBoard.shots.has(key)) continue;
    const outcome = applyIncomingAttack(r, c);
    renderBoard("player");
    if (outcome.result === "miss") {
      log(`Бот промахнулся по ${coordToText([r, c])}.`, "miss");
      state.turn = "you";
    } else if (outcome.result === "hit") {
      log(`Бот попал в ${coordToText([r, c])}!`, "hit");
      state.turn = "opponent";
      setTimeout(botTurn, 750);
    } else if (outcome.result === "sunk") {
      log(`Бот потопил ваш корабль (${outcome.ship}).`, "sunk");
      state.turn = "opponent";
      setTimeout(botTurn, 750);
    } else if (outcome.result === "defeat") {
      log("Ваш флот потоплен. Поражение.", "hit");
      state.phase = "finished";
      el("turn-indicator").textContent = "Поражение";
      el("opponent-status").textContent = "Бот победил";
      return;
    }
    updateTurn();
    break;
  }
};

const updateTurn = () => {
  const tag = el("turn-indicator");
  if (state.phase === "placement") {
    tag.textContent = "Размещаемся";
  } else if (state.phase === "waiting") {
    tag.textContent = "Ожидание оппонента";
  } else if (state.phase === "playing") {
    tag.textContent = state.turn === "you" ? "Ваш ход" : "Ход соперника";
  } else if (state.phase === "finished") {
    // handled elsewhere
  }
};

const setStatus = (text) => {
  el("status-label").textContent = text;
};

const announcePresence = () => {
  if (!state.transport) return;
  state.transport.send({ type: "join", payload: { name: state.name } });
};

const buildShareLink = () => {
  const params = new URLSearchParams();
  params.set("room", state.room);
  params.set("mode", document.querySelector('input[name="link-mode"]:checked')?.value || "local");
  const wsVal = el("ws-url").value.trim();
  if (wsVal) params.set("ws", wsVal);
  params.set("name", state.name || "Адмирал");
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
};

const copyShareLink = async () => {
  const link = buildShareLink();
  try {
    await navigator.clipboard.writeText(link);
    log("Ссылка на комнату скопирована в буфер обмена.");
  } catch (err) {
    log("Не удалось скопировать автоматически. Скопируйте вручную:", "miss");
    prompt("Скопируйте ссылку вручную:", link); // graceful fallback
  }
};

const onRemoteMessage = (msg) => {
  const { type, payload, sender } = msg;
  if (sender === state.transport?.clientId) return;
  if (type === "join") {
    if (!state.opponent) {
      state.opponent = { id: sender, name: payload?.name || "Соперник" };
      el("opponent-status").textContent = `Подключен ${state.opponent.name}`;
      log(`${state.opponent.name} зашёл в комнату.`);
      state.transport.send({ type: "hello", payload: { name: state.name } });
    }
  }
  if (type === "hello" && !state.opponent) {
    state.opponent = { id: sender, name: payload?.name || "Соперник" };
    el("opponent-status").textContent = `Подключен ${state.opponent.name}`;
    log(`${state.opponent.name} на связи.`);
    if (state.joinTimer) {
      clearInterval(state.joinTimer);
      state.joinTimer = null;
    }
  }
  if (type === "ready") {
    state.opponentReady = true;
    el("opponent-status").textContent = `${state.opponent?.name || "Соперник"} готов`;
    log(`${state.opponent?.name || "Соперник"} готов к бою.`);
    maybeStartBattle(sender);
  }
  if (type === "attack") {
    if (state.phase !== "playing") state.phase = "playing";
    const { r, c, name } = payload;
    const outcome = applyIncomingAttack(r, c);
    renderBoard("player");
    if (outcome.result === "miss") {
      log(`${name || "Соперник"} промахнулся по ${coordToText([r, c])}.`, "miss");
      state.turn = "you";
    } else if (outcome.result === "hit") {
      log(`${name || "Соперник"} попал в ${coordToText([r, c])}!`, "hit");
      state.turn = "opponent";
    } else if (outcome.result === "sunk") {
      log(`${name || "Соперник"} потопил ваш корабль (${outcome.ship}).`, "sunk");
      state.turn = "opponent";
    } else if (outcome.result === "defeat") {
      log("Ваш флот уничтожен.", "hit");
      state.phase = "finished";
      el("turn-indicator").textContent = "Поражение";
      el("opponent-status").textContent = "Ваш флот потоплен";
    }
    updateTurn();
    state.transport.send({
      type: "attack-result",
      payload: { r, c, ...outcome },
    });
  }
  if (type === "attack-result") {
    handleAttackResult({ ...payload, from: "remote" });
  }
};

const maybeStartBattle = (sender) => {
  if (!state.ready || !state.opponentReady) return;
  state.phase = "playing";
  const host = [state.transport.clientId, sender || state.opponent?.id].sort()[0];
  state.turn = host === state.transport.clientId ? "you" : "opponent";
  updateTurn();
  el("opponent-status").textContent = `Противник готов. ${state.turn === "you" ? "Ваш ход" : "Ожидание"}.`;
};

const connect = (localDemo = false) => {
  state.name = el("name-input").value.trim() || "Адмирал";
  state.room = el("room-input").value.trim() || "public";
  state.localBot = localDemo;
  const chosenMode = document.querySelector('input[name="link-mode"]:checked')?.value || "local";
  const wsUrlInput = el("ws-url").value.trim() || defaultWsUrl();
  state.transport = new Transport(onRemoteMessage, (status) => {
    const pill = el("connection-pill");
    if (status === "connected-ws") {
      pill.textContent = "WebSocket";
      pill.classList.remove("offline");
      setStatus("Сервер подключен");
      log(`Подключение по WebSocket: ${wsUrlInput}`);
    } else if (status === "connected-local") {
      pill.textContent = "Локальный канал";
      pill.classList.remove("offline");
      setStatus("Локальный канал (BroadcastChannel)");
    } else if (status === "connected-localstorage") {
      pill.textContent = "Локальный (storage)";
      pill.classList.remove("offline");
      setStatus("Локальный мост через localStorage");
    } else if (status.startsWith("fallback:")) {
      pill.textContent = "Локальный канал";
      pill.classList.remove("offline");
      setStatus("WebSocket недоступен, активирован локальный режим");
      log("WebSocket недоступен, переключились на локальный режим.", "miss");
    } else {
      pill.textContent = "Оффлайн";
      pill.classList.add("offline");
      setStatus("Нет соединения");
    }
  });
  state.transport.connect(state.room, { mode: chosenMode === "ws" && !localDemo ? "ws" : "local", url: wsUrlInput || undefined });
  el("room-label").textContent = state.room;
  el("player-label").textContent = state.name;
  setStatus("Подключаемся...");
  if (!localDemo) {
    log(`Вы в комнате ${state.room}. Ожидание соперника...`);
    announcePresence();
    if (state.joinTimer) clearInterval(state.joinTimer);
    state.joinTimer = setInterval(() => {
      if (state.opponent) {
        clearInterval(state.joinTimer);
        state.joinTimer = null;
        return;
      }
      announcePresence();
    }, 2500);
  } else {
    setupBot();
    log("Локальный спарринг активирован. Флот соперника расставлен автоматически.");
  }
};

const loadSettingsFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  const name = params.get("name");
  const mode = params.get("mode");
  const ws = params.get("ws");
  const auto = params.get("autoconnect");

  if (room) {
    state.room = room;
    el("room-input").value = room;
  }
  if (name) {
    state.name = name;
    el("name-input").value = name;
  }
  if (mode && (mode === "ws" || mode === "local")) {
    const radio = document.querySelector(`input[name="link-mode"][value="${mode}"]`);
    if (radio) radio.checked = true;
  }
  if (ws) {
    el("ws-url").value = ws;
  } else if (!el("ws-url").value) {
    el("ws-url").value = defaultWsUrl();
  }
  state.autoConnect = auto === "1";
};

const setupBot = () => {
  state.opponentReady = true;
  state.opponent = { id: "bot", name: "Бот" };
  state.opponentBoard = createBoard();
  autoPlaceForBoard(state.opponentBoard);
  state.phase = "placement";
  state.turn = "you";
  updateTurn();
};

const autoPlaceForBoard = (board) => {
  const fleet = cloneFleetState();
  fleet.forEach((ship) => {
    for (let i = 0; i < ship.count; i++) {
      const shipKey = `${ship.id}-${i}`;
      let placed = false;
      while (!placed) {
        const orientation = Math.random() > 0.5 ? "horizontal" : "vertical";
        const r = Math.floor(Math.random() * BOARD_SIZE);
        const c = Math.floor(Math.random() * BOARD_SIZE);
        if (!placeable({ grid: board.grid }, r, c, ship.size, orientation)) continue;
        const cells = [];
        for (let k = 0; k < ship.size; k++) {
          const rr = r + (orientation === "vertical" ? k : 0);
          const cc = c + (orientation === "horizontal" ? k : 0);
          board.grid[rr][cc] = shipKey;
          cells.push([rr, cc]);
        }
        board.ships[shipKey] = { name: ship.name, cells, hits: new Set(), sunkCells: new Set() };
        placed = true;
      }
    }
  });
};

const readyUp = () => {
  if (state.phase !== "placement") return;
  state.ready = true;
  state.phase = state.opponentReady || state.localBot ? "playing" : "waiting";
  el("placement-tag").textContent = "Готов";
  if (state.transport && !state.localBot) {
    state.transport.send({ type: "ready", payload: { name: state.name } });
  }
  if (state.localBot) {
    state.turn = "you";
    state.opponentReady = true;
    updateTurn();
    log("Вы готовы. Ход за вами.");
  } else {
    log("Вы готовы. Ждём соперника...");
  }
};

const attachUI = () => {
  buildGrid(el("player-grid"), false);
  buildGrid(el("opponent-grid"), true);
  renderBoard("player");
  renderBoard("opponent");
  renderFleet();
  checkReady();

  el("orientation-btn").addEventListener("click", toggleOrientation);
  el("auto-btn").addEventListener("click", autoPlace);
  el("ready-btn").addEventListener("click", readyUp);
  el("connect-btn").addEventListener("click", () => connect(false));
  el("code-join-btn").addEventListener("click", () => {
    el("ws-url").value = el("ws-url").value.trim() || defaultWsUrl();
    const wsRadio = document.querySelector('input[name="link-mode"][value="ws"]');
    if (wsRadio) wsRadio.checked = true;
    connect(false);
  });
  el("local-demo").addEventListener("click", () => connect(true));
  el("share-btn").addEventListener("click", copyShareLink);
  el("demo-ws").addEventListener("click", () => {
    el("ws-url").value = defaultWsUrl();
    const wsRadio = document.querySelector('input[name="link-mode"][value="ws"]');
    if (wsRadio) wsRadio.checked = true;
    log("Вставлен demo WebSocket. Нажмите «Быстрое подключение», чтобы проверить мультиплеер.");
  });
};

attachUI();
loadSettingsFromUrl();
if (state.autoConnect) {
  setTimeout(() => connect(false), 200);
}
