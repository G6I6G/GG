const BOARD_SIZE = 10;
const SHIPS = [5, 4, 3, 3, 2];

const playerBoardEl = document.getElementById("player-board");
const opponentBoardEl = document.getElementById("opponent-board");
const rotateBtn = document.getElementById("rotate-btn");
const resetBtn = document.getElementById("reset-btn");
const readyBtn = document.getElementById("ready-btn");
const newGameBtn = document.getElementById("new-game-btn");
const connectBtn = document.getElementById("connect-btn");
const clearLogBtn = document.getElementById("clear-log");
const shipProgressEl = document.getElementById("ship-progress");
const turnIndicatorEl = document.getElementById("turn-indicator");
const opponentStatusEl = document.getElementById("opponent-status");
const statusEl = document.getElementById("connection-status");
const statusDotEl = document.getElementById("connection-dot");
const serverUrlInput = document.getElementById("server-url");
const logEl = document.getElementById("log");

let socket;
let orientation = "horizontal";
let placedShips = [];
let occupiedCells = new Set();
let placementIndex = 0;
let shotsFired = new Set();
let playerCells = [];
let opponentCells = [];
let myTurn = false;
let ready = false;
let opponentReady = false;
let gameOver = false;
let connected = false;

const setConnectionState = (state, text) => {
  statusEl.textContent = text;
  statusDotEl.className = `dot ${state}`;
};

const log = (text) => {
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
};

const updateShipProgress = () => {
  shipProgressEl.textContent = `Корабли: ${placementIndex} / ${SHIPS.length}`;
  readyBtn.disabled = placementIndex !== SHIPS.length || ready;
};

const updateTurnIndicator = (text) => {
  turnIndicatorEl.textContent = text;
};

const updateOpponentStatus = (text) => {
  opponentStatusEl.textContent = text;
};

const resetBoards = () => {
  playerCells.forEach((cell) => {
    cell.className = "cell";
  });
  opponentCells.forEach((cell) => {
    cell.className = "cell";
  });
};

const resetClientState = () => {
  placedShips = [];
  occupiedCells = new Set();
  placementIndex = 0;
  shotsFired = new Set();
  myTurn = false;
  ready = false;
  opponentReady = false;
  gameOver = false;
  resetBoards();
  updateShipProgress();
  updateTurnIndicator("Ход: ожидание матча");
  updateOpponentStatus("Соперник не подключен");
  readyBtn.disabled = true;
};

const orientationLabel = () => (orientation === "horizontal" ? "Горизонтально" : "Вертикально");

const toggleOrientation = () => {
  orientation = orientation === "horizontal" ? "vertical" : "horizontal";
  rotateBtn.textContent = `Ориентация: ${orientationLabel()}`;
};

const coordsFromIndex = (index) => ({
  row: Math.floor(index / BOARD_SIZE),
  col: index % BOARD_SIZE,
});

const buildBoard = (container, onClick) => {
  const cells = [];
  for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.index = i;
    cell.addEventListener("click", () => onClick(i, cell));
    cells.push(cell);
    container.appendChild(cell);
  }
  return cells;
};

const canPlaceShip = (startIndex, size) => {
  const { row, col } = coordsFromIndex(startIndex);
  if (orientation === "horizontal") {
    if (col + size > BOARD_SIZE) return false;
    for (let offset = 0; offset < size; offset++) {
      const idx = startIndex + offset;
      if (occupiedCells.has(idx)) return false;
    }
    return true;
  }

  if (row + size > BOARD_SIZE) return false;
  for (let offset = 0; offset < size; offset++) {
    const idx = startIndex + offset * BOARD_SIZE;
    if (occupiedCells.has(idx)) return false;
  }
  return true;
};

const placeShip = (startIndex) => {
  if (placementIndex >= SHIPS.length || ready || gameOver) return;
  const size = SHIPS[placementIndex];
  if (!canPlaceShip(startIndex, size)) {
    log(`Нельзя поставить корабль размером ${size} сюда.`);
    return;
  }

  const cells = [];
  for (let offset = 0; offset < size; offset++) {
    const idx = orientation === "horizontal" ? startIndex + offset : startIndex + offset * BOARD_SIZE;
    cells.push(idx);
    occupiedCells.add(idx);
    playerCells[idx].classList.add("ship");
  }

  placedShips.push(cells);
  placementIndex += 1;
  updateShipProgress();
};

const sendPlacement = () => {
  if (!socket || !connected) {
    log("Нет соединения с сервером.");
    return;
  }
  if (placementIndex !== SHIPS.length) {
    log("Разместите все корабли перед подтверждением.");
    return;
  }
  ready = true;
  readyBtn.disabled = true;
  socket.emit("place-ships", { ships: placedShips });
  log("Расстановка отправлена. Ждём соперника.");
};

const handleFire = (index) => {
  if (!socket || !connected || !ready || !opponentReady || gameOver) return;
  if (!myTurn) {
    log("Сейчас ход соперника.");
    return;
  }
  if (shotsFired.has(index)) {
    log("Эта клетка уже обстреляна.");
    return;
  }
  shotsFired.add(index);
  socket.emit("fire", { cell: index });
};

const handleShotResult = ({ cell, hit, yourTurn }) => {
  if (typeof cell !== "number") return;
  const targetCell = opponentCells[cell];
  if (!targetCell) return;
  targetCell.classList.add(hit ? "hit" : "miss");
  myTurn = Boolean(yourTurn);
  updateTurnIndicator(myTurn ? "Ваш ход" : "Ход соперника");
  log(hit ? "Попадание!" : "Промах. Ход уходит сопернику.");
};

const handleIncomingFire = ({ cell, hit, yourTurn }) => {
  if (typeof cell !== "number") return;
  const targetCell = playerCells[cell];
  if (!targetCell) return;
  targetCell.classList.add(hit ? "hit" : "miss");
  myTurn = Boolean(yourTurn);
  updateTurnIndicator(myTurn ? "Ваш ход" : "Ход соперника");
  log(hit ? "Соперник попал в ваш корабль." : "Соперник промахнулся.");
};

const buildSocket = (serverUrl) => {
  if (socket) {
    socket.disconnect();
  }

  socket = io(serverUrl || undefined, { transports: ["websocket"] });

  socket.on("connect", () => {
    connected = true;
    setConnectionState("online", "Подключено");
    log("Соединение установлено, ищем соперника.");
    resetClientState();
  });

  socket.on("disconnect", () => {
    connected = false;
    setConnectionState("offline", "Оффлайн");
    log("Соединение разорвано.");
  });

  socket.on("waiting-for-opponent", () => {
    setConnectionState("idle", "Ожидаем соперника");
    updateOpponentStatus("Ждём второго игрока...");
    log("Вы в очереди. Как только подключится второй игрок — начнём.");
  });

  socket.on("match-ready", ({ gameId }) => {
    setConnectionState("online", "Матч найден");
    updateOpponentStatus(`Соперник подключился (матч ${gameId}). Разместите корабли.`);
    log("Матч найден. Расставьте корабли и нажмите «Готов».");
  });

  socket.on("ships-confirmed", () => {
    ready = true;
    readyBtn.disabled = true;
    log("Корабли зафиксированы. Ждём соперника.");
  });

  socket.on("opponent-ready", () => {
    opponentReady = true;
    updateOpponentStatus("Соперник готов. Ожидаем начала.");
    log("Соперник подтвердил расстановку.");
  });

  socket.on("both-ready", () => {
    updateOpponentStatus("Оба готовы. Ожидайте хода.");
    log("Игра началась!");
  });

  socket.on("turn", ({ yourTurn, message }) => {
    myTurn = Boolean(yourTurn);
    updateTurnIndicator(message || (myTurn ? "Ваш ход" : "Ход соперника"));
  });

  socket.on("shot-result", handleShotResult);
  socket.on("incoming-fire", handleIncomingFire);

  socket.on("game-over", ({ winner }) => {
    gameOver = true;
    const youWin = winner && socket && winner === socket.id;
    updateTurnIndicator(youWin ? "Вы победили!" : "Поражение");
    log(youWin ? "Поздравляем! Вы победили." : "Поражение. Попробуйте снова.");
  });

  socket.on("opponent-left", () => {
    opponentReady = false;
    updateOpponentStatus("Соперник покинул матч.");
    updateTurnIndicator("Матч прерван");
    log("Соперник вышел. Нажмите «Новая партия», чтобы найти новую игру.");
  });

  socket.on("placement-error", ({ message }) => {
    ready = false;
    readyBtn.disabled = placementIndex !== SHIPS.length;
    log(message || "Ошибка размещения кораблей.");
  });
};

const init = () => {
  playerCells = buildBoard(playerBoardEl, (idx) => placeShip(idx));
  opponentCells = buildBoard(opponentBoardEl, (idx) => handleFire(idx));

  rotateBtn.addEventListener("click", toggleOrientation);
  resetBtn.addEventListener("click", () => {
    resetBoards();
    placedShips = [];
    occupiedCells = new Set();
    placementIndex = 0;
    ready = false;
    updateShipProgress();
  });
  readyBtn.addEventListener("click", sendPlacement);
  newGameBtn.addEventListener("click", () => {
    if (!socket || !connected) return;
    resetClientState();
    socket.emit("queue-again");
    log("Запрошена новая партия.");
  });
  connectBtn.addEventListener("click", () => {
    buildSocket(serverUrlInput.value.trim() || undefined);
  });
  clearLogBtn.addEventListener("click", () => {
    logEl.innerHTML = "";
  });

  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "r") {
      toggleOrientation();
    }
  });

  serverUrlInput.placeholder = `${window.location.origin} (по умолчанию)`;
  buildSocket();
  updateShipProgress();
};

init();
