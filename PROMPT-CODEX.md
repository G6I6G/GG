# Battleship (Socket.io) Prompt for Codex

## Goal
Create a Battleship game with real-time multiplayer via Socket.io. Two players connect from the browser, place ships, and take turns. Frontend is hosted on GitHub Pages; backend is a Node.js + Socket.io service (Heroku/Vercel).

## Frontend (public/ for GitHub Pages)
- **index.html**: Two 10×10 boards (`#player-board`, `#enemy-board`), heading, and `#start-button`. Include `styles.css`, `script.js`, and the Socket.io client.
- **styles.css**: Centered layout, 10×10 grid of 50px cells, styles for `.hit`, `.miss`, `.ship`, button styling.
- **script.js**:
  - Build boards, randomly place 5 single-cell ships.
  - Handle clicks on the enemy board, emit `make-move` with `{ index, hit }`.
  - Apply opponent moves from `move-made` to the player board.
  - Reset/start on `start-game` and button click.

Example `index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Морской бой</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <h1>Морской бой</h1>
  <div id="game-container">
    <div id="player-board" class="board"></div>
    <div id="enemy-board" class="board"></div>
  </div>
  <button id="start-button">Начать игру</button>
  <script src="/socket.io/socket.io.js"></script>
  <script src="script.js"></script>
</body>
</html>
```

Example `styles.css` (key fragments):
```css
body {
  font-family: Arial, sans-serif;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100vh;
  margin: 0;
  background: #f0f0f0;
  text-align: center;
}
#game-container { display: flex; justify-content: space-around; margin: 20px; }
.board {
  display: grid;
  grid-template-columns: repeat(10, 50px);
  grid-template-rows: repeat(10, 50px);
  gap: 2px;
  background: #fff;
  border: 2px solid #000;
}
.board div { width: 50px; height: 50px; background: #9e9e9e; cursor: pointer; }
.hit { background: #e74c3c !important; }
.miss { background: #bdc3c7 !important; }
.ship { background: #2980b9; }
button { padding: 10px 20px; font-size: 1.2em; margin-top: 20px; cursor: pointer; }
```

Example `script.js` (core):
```javascript
const socket = io();
const startButton = document.getElementById('start-button');
const playerBoard = document.getElementById('player-board');
const enemyBoard = document.getElementById('enemy-board');
const boardSize = 10;
let isPlayerTurn = true;

function createBoard(boardEl) {
  boardEl.innerHTML = '';
  for (let i = 0; i < boardSize * boardSize; i++) {
    const cell = document.createElement('div');
    cell.addEventListener('click', () => handleCellClick(i, boardEl));
    boardEl.appendChild(cell);
  }
}

function placeShips(boardEl) {
  const cells = boardEl.children;
  const ships = new Set();
  while (ships.size < 5) {
    const pos = Math.floor(Math.random() * boardSize * boardSize);
    ships.add(pos);
    cells[pos].classList.add('ship');
  }
}

function handleCellClick(index, boardEl) {
  if (!isPlayerTurn || boardEl !== enemyBoard) return;
  const cell = boardEl.children[index];
  if (cell.classList.contains('hit') || cell.classList.contains('miss')) return;
  const hit = cell.classList.contains('ship');
  cell.classList.add(hit ? 'hit' : 'miss');
  isPlayerTurn = false;
  checkGameStatus();
  socket.emit('make-move', { index, hit });
}

socket.on('move-made', ({ index, hit }) => {
  const cell = playerBoard.children[index];
  if (cell.classList.contains('hit') || cell.classList.contains('miss')) return;
  cell.classList.add(hit ? 'hit' : 'miss');
  isPlayerTurn = true;
  checkGameStatus();
});

socket.on('start-game', () => resetGame());

function checkGameStatus() {
  const playerShipsLeft = [...playerBoard.children].filter(c => c.classList.contains('ship') && !c.classList.contains('hit')).length;
  const enemyShipsLeft = [...enemyBoard.children].filter(c => c.classList.contains('ship') && !c.classList.contains('hit')).length;
  if (playerShipsLeft === 0) { alert('Вы проиграли!'); resetGame(); }
  if (enemyShipsLeft === 0) { alert('Вы выиграли!'); resetGame(); }
}

function resetGame() {
  createBoard(playerBoard);
  createBoard(enemyBoard);
  placeShips(playerBoard);
  placeShips(enemyBoard);
  isPlayerTurn = true;
}

startButton.addEventListener('click', () => { resetGame(); socket.emit('start-game'); });
resetGame();
```

## Backend (Node.js + Socket.io for Heroku/Vercel)
- **server.js**: Express + Socket.io, track connected players; when two join, emit `start-game`. Broadcast moves (`make-move` → `move-made`).
```javascript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

let players = [];

app.use(express.static('public'));

io.on('connection', (socket) => {
  players.push(socket.id);
  if (players.length >= 2) io.emit('start-game');

  socket.on('make-move', (data) => io.emit('move-made', data));

  socket.on('disconnect', () => {
    players = players.filter(id => id !== socket.id);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server on http://localhost:${port}`));
```

- **package.json** (minimal):
```json
{
  "name": "battleship-socketio",
  "private": true,
  "scripts": { "start": "node server.js" },
  "dependencies": { "express": "^4.18.2", "socket.io": "^4.7.2" }
}
```

## Deploy
- **Client**: push `public/` to GitHub Pages (gh-pages or /docs).
- **Server**: deploy Node.js app to Heroku/Vercel; listen on `process.env.PORT`.
- In production, load Socket.io client from the server host, e.g.:
```html
<script src="https://<your-socket-host>/socket.io/socket.io.js"></script>
<script> const socket = io('https://<your-socket-host>'); </script>
```

## Summary of Requirements
- HTML/CSS/JS client with two boards, start button, hit/miss visuals.
- Socket.io for move exchange and game start.
- Node.js server relays moves and starts the match when 2 players are connected.
- Client on GitHub Pages, server on Heroku/Vercel.
