"use strict";

// 게임 좌표는 픽셀 대신 '열 x · 행 y' 단위로 관리합니다.
// 왼쪽 위가 (0, 0), 오른쪽 아래가 (9, 19)입니다.
const BOARD_COLUMNS = 10;
const BOARD_ROWS = 20;

const DROP_INTERVAL = 500;
const SOFT_DROP_INTERVAL = 50;
const LINE_SCORES = [0, 100, 300, 500, 800];

// 0은 빈 칸, 문자열은 고정된 블록의 종류입니다. 행마다 독립된 배열을 만듭니다.
function createBoard() {
  return Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLUMNS).fill(0));
}

// 1은 블록이 차지하는 칸, 0은 모양 안의 빈 칸입니다.
// 모든 종류는 각각 4칸을 차지하며, 모양과 색을 한곳에서 관리합니다.
const TETROMINOES = {
  I: { shape: [[1, 1, 1, 1]], color: "#22d3ee" },
  O: { shape: [[1, 1], [1, 1]], color: "#facc15" },
  T: { shape: [[0, 1, 0], [1, 1, 1]], color: "#a855f7" },
  S: { shape: [[0, 1, 1], [1, 1, 0]], color: "#4ade80" },
  Z: { shape: [[1, 1, 0], [0, 1, 1]], color: "#f87171" },
  J: { shape: [[1, 0, 0], [1, 1, 1]], color: "#60a5fa" },
  L: { shape: [[0, 0, 1], [1, 1, 1]], color: "#fb923c" },
};

// 재시작 시 교체되는 게임 상태와 반복 실행 핸들을 분리해 관리합니다.
let board = createBoard();
let currentPiece = null;
let score = 0;
let gameOver = false;
let dropTimer = null;
let softDropTimer = null;

// HTML의 defer 설정에 따라 캔버스 요소가 생성된 뒤 이 스크립트가 실행됩니다.
const canvas = document.getElementById("game-board");
const context = canvas.getContext("2d");
const cellWidth = canvas.width / BOARD_COLUMNS;
const cellHeight = canvas.height / BOARD_ROWS;
const scoreElement = document.getElementById("score");
const statusElement = document.getElementById("game-status");
const restartButton = document.getElementById("restart-button");

// 실제 점유 칸만 검사합니다. 보드 밖이거나 고정된 칸과 겹치면 충돌입니다.
// 화면·타이머에 의존하지 않아 준비한 보드와 좌표로 독립적으로 테스트할 수 있습니다.
function hasCollision(grid, shape, x, y) {
  return shape.some((row, rowIndex) => row.some((occupied, columnIndex) => {
    if (occupied === 0) return false;
    const boardX = x + columnIndex;
    const boardY = y + rowIndex;
    return boardX < 0 || boardX >= BOARD_COLUMNS ||
      boardY < 0 || boardY >= BOARD_ROWS || grid[boardY][boardX] !== 0;
  }));
}

// 직사각형 모양도 회전할 수 있도록 새로운 배열을 만듭니다. 원본은 유지합니다.
function rotateShape(shape) {
  return Array.from({ length: shape[0].length }, (_, x) =>
    Array.from({ length: shape.length }, (_, y) => shape[shape.length - 1 - y][x])
  );
}

// 완성 줄을 한 번에 걸러내므로 인접한 여러 줄도 빠짐없이 제거됩니다.
// 남은 줄의 순서는 그대로 두고, 제거한 수만큼 상단에 빈 줄을 추가합니다.
function clearLines(grid) {
  const remaining = grid.filter((row) => row.some((cell) => cell === 0));
  const cleared = BOARD_ROWS - remaining.length;
  const emptyRows = Array.from({ length: cleared }, () => Array(BOARD_COLUMNS).fill(0));
  return { board: [...emptyRows, ...remaining], cleared };
}

function stopSoftDrop() {
  clearInterval(softDropTimer);
  softDropTimer = null;
}

function stopTimers() {
  clearInterval(dropTimer);
  dropTimer = null;
  stopSoftDrop();
}

// 기존 자동 낙하를 먼저 해제합니다. 새 블록은 온전한 0.5초 뒤에 내려옵니다.
function startAutoDrop() {
  clearInterval(dropTimer);
  dropTimer = setInterval(stepDown, DROP_INTERVAL);
}

// 무작위로 선택한 모양을 복사해 상단 중앙에 생성합니다.
// 공간이 막혔으면 겹쳐 그리지 않고 종료하며 모든 반복 실행을 정리합니다.
function spawnPiece() {
  const types = Object.keys(TETROMINOES);
  const type = types[Math.floor(Math.random() * types.length)];
  const definition = TETROMINOES[type];
  const piece = {
    type,
    shape: definition.shape.map((row) => [...row]),
    color: definition.color,
    x: Math.floor((BOARD_COLUMNS - definition.shape[0].length) / 2),
    y: 0,
  };
  if (hasCollision(board, piece.shape, piece.x, piece.y)) {
    currentPiece = null;
    gameOver = true;
    stopTimers();
    return;
  }
  currentPiece = piece;
}

// 고정 → 줄 제거 → 점수 반영 → 새 블록 생성 순서를 반드시 지킵니다.
function lockPiece() {
  if (gameOver || !currentPiece) return;
  currentPiece.shape.forEach((row, y) => row.forEach((occupied, x) => {
    if (occupied === 1) board[currentPiece.y + y][currentPiece.x + x] = currentPiece.type;
  }));
  currentPiece = null;
  const result = clearLines(board);
  board = result.board;
  score += LINE_SCORES[result.cleared];
  spawnPiece();
  if (!gameOver) startAutoDrop();
}

function stepDown() {
  if (gameOver || !currentPiece) return;
  if (hasCollision(board, currentPiece.shape, currentPiece.x, currentPiece.y + 1)) {
    lockPiece();
  } else {
    currentPiece.y += 1;
  }
  draw();
}

function movePiece(direction) {
  if (gameOver || !currentPiece) return;
  const nextX = currentPiece.x + direction;
  if (!hasCollision(board, currentPiece.shape, nextX, currentPiece.y)) {
    currentPiece.x = nextX;
    draw();
  }
}

function rotatePiece() {
  if (gameOver || !currentPiece) return;
  const rotated = rotateShape(currentPiece.shape);
  // 회전 위치를 옮기는 보정 없이, 충돌하면 원래 모양과 위치를 그대로 유지합니다.
  if (!hasCollision(board, rotated, currentPiece.x, currentPiece.y)) {
    currentPiece.shape = rotated;
    draw();
  }
}

function hardDrop() {
  if (gameOver || !currentPiece) return;
  while (!hasCollision(board, currentPiece.shape, currentPiece.x, currentPiece.y + 1)) {
    currentPiece.y += 1;
  }
  lockPiece();
  draw();
}

function restartGame() {
  stopTimers();
  board = createBoard();
  score = 0;
  gameOver = false;
  currentPiece = null;
  spawnPiece();
  if (!gameOver) startAutoDrop();
  draw();
}

// 보드 좌표를 캔버스의 픽셀 좌표로 변환해 한 칸을 채웁니다.
function drawCell(x, y, color) {
  context.fillStyle = color;
  context.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
}

// 매번 배경을 지운 뒤 고정 블록, 현재 블록, 격자 순서로 그립니다.
// 그리기는 화면 표시만 담당하며 board나 currentPiece의 값을 바꾸지 않습니다.
function draw() {
  context.fillStyle = "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);

  // 고정된 블록은 보드에 저장된 종류에 해당하는 색으로 표시합니다.
  board.forEach((row, y) => {
    row.forEach((type, x) => {
      if (type !== 0) {
        drawCell(x, y, TETROMINOES[type].color);
      }
    });
  });

  // 모양에서 1인 칸만 현재 위치를 기준으로 상대 좌표를 더해 그립니다.
  if (currentPiece) currentPiece.shape.forEach((row, y) => {
    row.forEach((occupied, x) => {
      if (occupied === 1) {
        drawCell(currentPiece.x + x, currentPiece.y + y, currentPiece.color);
      }
    });
  });

  // 마지막에 옅은 격자를 겹쳐 빈 칸과 블록의 경계를 구분하기 쉽게 합니다.
  // 가장자리 선도 캔버스 안에 배치하고 가는 선을 픽셀 경계에 맞춥니다.
  context.strokeStyle = "#2b3038";
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x <= BOARD_COLUMNS; x += 1) {
    const pixelX = Math.min(x * cellWidth + 0.5, canvas.width - 0.5);
    context.moveTo(pixelX, 0);
    context.lineTo(pixelX, canvas.height);
  }
  for (let y = 0; y <= BOARD_ROWS; y += 1) {
    const pixelY = Math.min(y * cellHeight + 0.5, canvas.height - 0.5);
    context.moveTo(0, pixelY);
    context.lineTo(canvas.width, pixelY);
  }
  context.stroke();
  scoreElement.textContent = String(score);
  statusElement.textContent = gameOver ? "게임 오버" : "";
}

// 리스너는 한 번만 등록합니다. 재시작해도 입력 처리가 중복되지 않습니다.
document.addEventListener("keydown", (event) => {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space"];
  if (!keys.includes(event.code)) return;
  // 버튼에 초점이 있으면 스페이스의 기본 버튼 클릭 동작을 유지합니다.
  if (event.code === "Space" && event.target === restartButton) return;
  event.preventDefault();
  if (gameOver) return;
  if (event.code === "ArrowLeft") movePiece(-1);
  if (event.code === "ArrowRight") movePiece(1);
  if (event.code === "ArrowUp" && !event.repeat) rotatePiece();
  if (event.code === "Space" && !event.repeat) hardDrop();
  if (event.code === "ArrowDown" && !event.repeat && softDropTimer === null) {
    stepDown();
    if (!gameOver) softDropTimer = setInterval(stepDown, SOFT_DROP_INTERVAL);
  }
});

document.addEventListener("keyup", (event) => {
  if (event.code === "ArrowDown") stopSoftDrop();
});
window.addEventListener("blur", stopSoftDrop);
restartButton.addEventListener("click", () => {
  restartGame();
  // 마우스로 재시작한 뒤 바로 스페이스 하강을 사용할 수 있게 합니다.
  restartButton.blur();
});

restartGame();
