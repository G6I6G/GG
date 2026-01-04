const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const FLEET = [5, 4, 3, 3, 2];
const TOTAL_SHIP_CELLS = FLEET.reduce((sum, size) => sum + size, 0);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(express.static(path.join(__dirname, "public")));

const games = new Map();
let waitingGameId = null;

const createGame = () => {
  const id = `game-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const game = {
    id,
    players: [],
    boards: new Map(),
    ready: new Set(),
    turn: null,
    winner: null,
  };
  games.set(id, game);
  return game;
};

const getOpponentId = (game, playerId) => game.players.find((id) => id !== playerId);

const cleanupGame = (gameId, { notifyOpponent } = { notifyOpponent: true }) => {
  const game = games.get(gameId);
  if (!game) return;

  game.players.forEach((playerId) => {
    const socket = io.sockets.sockets.get(playerId);
    if (socket && notifyOpponent) {
      socket.emit("opponent-left");
      socket.leave(gameId);
      socket.data.gameId = null;
    }
  });

  if (waitingGameId === gameId) {
    waitingGameId = null;
  }
  games.delete(gameId);
};

const assignGame = (socket) => {
  let game =
    waitingGameId && games.has(waitingGameId) && games.get(waitingGameId).players.length < 2
      ? games.get(waitingGameId)
      : createGame();

  if (game.players.length === 0) {
    waitingGameId = game.id;
  } else {
    waitingGameId = null;
  }

  game.players.push(socket.id);
  socket.data.gameId = game.id;
  socket.join(game.id);

  if (game.players.length === 1) {
    socket.emit("waiting-for-opponent");
  } else if (game.players.length === 2) {
    io.to(game.id).emit("match-ready", { gameId: game.id });
  }
};

const startMatchIfReady = (game) => {
  if (game.ready.size < 2 || game.turn) return;
  const startingIndex = Math.floor(Math.random() * 2);
  game.turn = game.players[startingIndex];
  const other = game.players[1 - startingIndex];
  io.to(game.turn).emit("turn", { yourTurn: true, message: "Ваш ход!" });
  io.to(other).emit("turn", { yourTurn: false, message: "Ход соперника." });
  io.to(game.id).emit("both-ready");
};

const validatePlacement = (ships) => {
  if (!Array.isArray(ships) || ships.length !== FLEET.length) return null;

  const flat = [];
  for (const ship of ships) {
    if (!Array.isArray(ship)) return null;
    ship.forEach((cell) => flat.push(Number(cell)));
  }

  if (flat.some((cell) => Number.isNaN(cell) || cell < 0 || cell >= 100)) return null;

  const unique = new Set(flat);
  if (unique.size !== flat.length) return null;
  if (flat.length !== TOTAL_SHIP_CELLS) return null;

  return unique;
};

io.on("connection", (socket) => {
  assignGame(socket);

  socket.on("place-ships", (payload = {}) => {
    const game = games.get(socket.data.gameId);
    if (!game) return;

    const ships = validatePlacement(payload.ships);
    if (!ships) {
      socket.emit("placement-error", { message: "Размещение некорректно. Проверьте корабли." });
      return;
    }

    game.boards.set(socket.id, {
      ships,
      hits: new Set(),
      misses: new Set(),
      totalCells: ships.size,
    });
    game.ready.add(socket.id);

    socket.emit("ships-confirmed");
    socket.to(game.id).emit("opponent-ready");
    startMatchIfReady(game);
  });

  socket.on("fire", (payload = {}) => {
    const game = games.get(socket.data.gameId);
    if (!game || game.winner) return;
    if (game.turn !== socket.id) {
      socket.emit("turn", { yourTurn: false, message: "Сейчас ход соперника." });
      return;
    }

    const cell = Number(payload.cell);
    if (Number.isNaN(cell) || cell < 0 || cell >= 100) return;

    const opponentId = getOpponentId(game, socket.id);
    const opponentBoard = opponentId ? game.boards.get(opponentId) : null;
    if (!opponentBoard) return;

    if (opponentBoard.hits.has(cell) || opponentBoard.misses.has(cell)) {
      socket.emit("shot-result", {
        cell,
        hit: opponentBoard.hits.has(cell),
        yourTurn: true,
        repeat: true,
      });
      return;
    }

    const hit = opponentBoard.ships.has(cell);
    if (hit) {
      opponentBoard.hits.add(cell);
    } else {
      opponentBoard.misses.add(cell);
    }

    const remaining = opponentBoard.totalCells - opponentBoard.hits.size;
    const winner = hit && opponentBoard.hits.size >= opponentBoard.totalCells ? socket.id : null;
    game.winner = winner;

    if (!winner) {
      const nextTurn = hit ? socket.id : opponentId;
      game.turn = nextTurn;
    }

    const payloadForShooter = {
      cell,
      hit,
      yourTurn: !winner && game.turn === socket.id,
      remaining,
    };
    const payloadForDefender = {
      cell,
      hit,
      yourTurn: !winner && game.turn === opponentId,
      remaining,
    };

    io.to(socket.id).emit("shot-result", payloadForShooter);
    if (opponentId) io.to(opponentId).emit("incoming-fire", payloadForDefender);

    if (winner) {
      io.to(game.id).emit("game-over", { winner });
      game.turn = null;
    }
  });

  socket.on("queue-again", () => {
    const currentGame = games.get(socket.data.gameId);
    if (currentGame) {
      const opponentId = getOpponentId(currentGame, socket.id);
      cleanupGame(currentGame.id, { notifyOpponent: true });
      if (opponentId) {
        const opponent = io.sockets.sockets.get(opponentId);
        if (opponent) {
          assignGame(opponent);
        }
      }
    }
    assignGame(socket);
  });

  socket.on("disconnect", () => {
    const gameId = socket.data.gameId;
    if (!gameId) return;
    const game = games.get(gameId);
    if (!game) return;

    const opponentId = getOpponentId(game, socket.id);
    if (opponentId) {
      io.to(opponentId).emit("opponent-left");
      const opponent = io.sockets.sockets.get(opponentId);
      if (opponent) {
        opponent.leave(gameId);
        opponent.data.gameId = null;
        waitingGameId = null;
      }
    }

    cleanupGame(gameId, { notifyOpponent: false });
  });
});

server.listen(PORT, () => {
  console.log(`Battleship сервер запущен: http://localhost:${PORT}`);
});
