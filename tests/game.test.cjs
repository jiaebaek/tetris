// 추가 라이브러리 없이 Node의 내장 테스트 도구로 게임 규칙을 검증합니다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../script.js"), "utf8");

// 실제 DOM·시간 대신 작은 대체 환경을 사용해 동일한 상태를 재현합니다.
function setup() {
  const timers = new Map();
  const events = {};
  let timerId = 0;
  const context = {
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  };
  const elements = {
    "game-board": { width: 300, height: 600, getContext: () => context },
    score: { textContent: "" },
    "game-status": { textContent: "" },
    "restart-button": { addEventListener: (type, fn) => { events.click = fn; }, blur() {} },
  };
  const math = Object.create(Math);
  math.random = () => 0;
  const sandbox = {
    Math: math,
    document: {
      getElementById: (id) => elements[id],
      addEventListener: (type, fn) => { events[type] = fn; },
    },
    window: { addEventListener: (type, fn) => { events[type] = fn; } },
    setInterval: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearInterval: (id) => timers.delete(id),
  };
  vm.createContext(sandbox);
  const run = (code) => vm.runInContext(code, sandbox);
  run(source);
  const key = (code, repeat = false, target = null) => {
    let prevented = false;
    events.keydown({ code, repeat, target, preventDefault() { prevented = true; } });
    return prevented;
  };
  return { run, timers, events, elements, key };
}

test("초기 보드·7종 데이터·0.5초 자동 하강", () => {
  const { run, timers } = setup();
  assert.equal(run("board.length"), 20);
  assert.equal(run("board.every(row => row.length === 10 && row.every(cell => cell === 0))"), true);
  assert.equal(run("new Set(board).size"), 20);
  assert.equal(run("Object.keys(TETROMINOES).length"), 7);
  assert.equal(run("Object.values(TETROMINOES).every(piece => piece.shape.flat().filter(cell => cell === 1).length === 4)"), true);
  assert.equal(run("currentPiece.x"), 3);
  assert.equal(timers.size, 1);
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 500);
  timer.fn();
  assert.equal(run("currentPiece.y"), 1);
});

test("충돌은 점유 칸의 경계와 다른 블록만 검사", () => {
  const { run } = setup();
  assert.equal(run("hasCollision(board, [[1]], 0, 0)"), false);
  assert.equal(run("hasCollision(board, [[1]], 9, 19)"), false);
  for (const [x, y] of [[-1, 0], [10, 0], [0, -1], [0, 20]]) {
    assert.equal(run(`hasCollision(board, [[1]], ${x}, ${y})`), true);
  }
  run('board[0][0] = "O"');
  assert.equal(run("hasCollision(board, [[1]], 0, 0)"), true);
  assert.equal(run("hasCollision(board, [[0, 1]], 0, 0)"), false);
});

test("좌우 키 이동과 벽·고정 블록에서 이동 취소", () => {
  const { run, key } = setup();
  assert.equal(key("ArrowLeft"), true);
  assert.equal(run("currentPiece.x"), 2);
  key("ArrowRight");
  assert.equal(run("currentPiece.x"), 3);
  run("currentPiece.x = 0");
  key("ArrowLeft");
  assert.equal(run("currentPiece.x"), 0);
  run('board[0][4] = "O"');
  key("ArrowRight");
  assert.equal(run("currentPiece.x"), 0);
});

test("시계 방향 회전·4회 복원과 벽·바닥·블록 회전 취소", () => {
  const { run, key } = setup();
  assert.equal(run("JSON.stringify(rotateShape([[1,0],[1,1]]))"), "[[1,1],[1,0]]");
  assert.equal(run("Object.values(TETROMINOES).every(p => { let s = p.shape; for(let i=0;i<4;i++) s=rotateShape(s); return JSON.stringify(s)===JSON.stringify(p.shape); })"), true);
  key("ArrowUp");
  assert.equal(run("currentPiece.shape.length"), 4);
  run("currentPiece.x = 9");
  const before = run("JSON.stringify(currentPiece)");
  key("ArrowUp");
  assert.equal(run("JSON.stringify(currentPiece)"), before);
  run("currentPiece.x=3; currentPiece.y=0; currentPiece.shape=[[1,1,1,1]]; board[1][3]='O'");
  const blocked = run("JSON.stringify(currentPiece)");
  key("ArrowUp");
  assert.equal(run("JSON.stringify(currentPiece)"), blocked);
  run("board=createBoard(); currentPiece.y=19");
  key("ArrowUp");
  assert.equal(run("currentPiece.shape.length"), 1);
});

test("바닥과 쌓인 블록에 고정 후 새 블록 생성", () => {
  const { run, timers } = setup();
  run("currentPiece.y=19; stepDown()");
  assert.equal(run("board[19].filter(cell => cell === 'I').length"), 4);
  assert.equal(run("currentPiece.y"), 0);
  run("hardDrop()");
  assert.equal(run("board[18].filter(cell => cell === 'I').length"), 4);
  assert.equal(timers.size, 1);
});

for (const [lines, points] of [[1, 100], [2, 300], [3, 500], [4, 800]]) {
  test(`${lines}줄 동시 제거, ${points}점 누적, 상단 행 이동`, () => {
    const { run, elements } = setup();
    run(`board=createBoard(); board[3][9]='T'; score=50;
      for(let y=20-${lines}; y<20; y++) { board[y].fill('J'); board[y][0]=0; }
      currentPiece={type:'I',shape:[[1],[1],[1],[1]],color:TETROMINOES.I.color,x:0,y:16};
      lockPiece(); draw();`);
    assert.equal(run("score"), 50 + points);
    assert.equal(elements.score.textContent, String(50 + points));
    assert.equal(run(`board[3+${lines}][9]`), "T");
    assert.equal(run("board.length"), 20);
    assert.equal(run("new Set(board).size"), 20);
    assert.equal(run("gameOver"), false);
  });
}

test("떨어진 위치의 완성 줄도 제거하고 빈 줄은 유지", () => {
  const { run } = setup();
  run("board[17].fill('T'); board[19].fill('J'); board[18][2]='S'");
  assert.equal(run("clearLines(board).cleared"), 2);
  assert.equal(run("clearLines(board).board[19][2]"), "S");
  assert.equal(run("clearLines(createBoard()).cleared"), 0);
});

test("Soft Drop 반복·해제·포커스 상실과 Hard Drop 키 반복 방지", () => {
  const { run, timers, key, events } = setup();
  key("ArrowDown");
  assert.equal(run("currentPiece.y"), 1);
  assert.equal(timers.size, 2);
  key("ArrowDown", true);
  assert.equal(timers.size, 2);
  [...timers.values()].find(timer => timer.delay === 50).fn();
  assert.equal(run("currentPiece.y"), 2);
  events.keyup({ code: "ArrowDown" });
  assert.equal(timers.size, 1);
  key("ArrowDown"); events.blur();
  assert.equal(timers.size, 1);
  key("Space");
  assert.equal(run("board.flat().filter(cell => cell !== 0).length"), 4);
  key("Space", true);
  assert.equal(run("board.flat().filter(cell => cell !== 0).length"), 4);
});

test("생성 충돌 시 종료·조작 중지·반복 재시작 상태와 타이머 초기화", () => {
  const { run, timers, key, events, elements } = setup();
  key("ArrowDown");
  // 완성 줄은 먼저 제거되므로, 줄을 완성하지 않고 생성 위치만 막습니다.
  run("board[0][3]='J'; currentPiece.y=19; stepDown()");
  assert.equal(run("gameOver"), true);
  assert.equal(run("currentPiece"), null);
  assert.equal(elements["game-status"].textContent, "게임 오버");
  assert.equal(timers.size, 0);
  const ended = run("JSON.stringify(board)");
  for (const code of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"]) key(code);
  assert.equal(run("JSON.stringify(board)"), ended);
  for (let i=0; i<5; i++) events.click();
  assert.equal(run("board.flat().every(cell => cell === 0)"), true);
  assert.equal(run("score"), 0);
  assert.equal(run("gameOver"), false);
  assert.equal(elements["game-status"].textContent, "");
  assert.equal(timers.size, 1);
});

test("반복 그리기는 게임 상태를 변경하지 않음", () => {
  const { run } = setup();
  const before = run("JSON.stringify({board,currentPiece,score,gameOver})");
  run("draw(); draw()");
  assert.equal(run("JSON.stringify({board,currentPiece,score,gameOver})"), before);
});
