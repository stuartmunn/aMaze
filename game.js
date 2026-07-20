// aMaze — game logic
//
// Sections: State, Maze generation, Rendering, Input, Level progression.
// Everything lives here per the project's "no build step" constraint.

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const canvas = document.getElementById('maze-canvas');
const ctx = canvas.getContext('2d');
const levelDisplay = document.getElementById('level-display');

const MAX_CANVAS_SIZE = 640; // px — grid scales down to fit within this

const state = {
  level: 1,
  grid: null,
  cols: 0,
  rows: 0,
  cellSize: 0,
  player: { x: 0, y: 0 },
  exit: { x: 0, y: 0 },
};

// ---------------------------------------------------------------------------
// Maze generation
// ---------------------------------------------------------------------------

const WALL = { TOP: 1, RIGHT: 2, BOTTOM: 4, LEFT: 8 };

// Which wall to knock down on each side, and the opposite wall on the
// neighbour being entered.
const OPPOSITE = { [WALL.TOP]: WALL.BOTTOM, [WALL.RIGHT]: WALL.LEFT, [WALL.BOTTOM]: WALL.TOP, [WALL.LEFT]: WALL.RIGHT };

function createCell() {
  return { walls: WALL.TOP | WALL.RIGHT | WALL.BOTTOM | WALL.LEFT, visited: false };
}

function createGrid(cols, rows) {
  const grid = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) row.push(createCell());
    grid.push(row);
  }
  return grid;
}

function getUnvisitedNeighbours(grid, x, y, cols, rows) {
  const candidates = [
    [x, y - 1, WALL.TOP],
    [x + 1, y, WALL.RIGHT],
    [x, y + 1, WALL.BOTTOM],
    [x - 1, y, WALL.LEFT],
  ];
  return candidates.filter(([nx, ny]) => nx >= 0 && nx < cols && ny >= 0 && ny < rows && !grid[ny][nx].visited);
}

/**
 * Generates a perfect maze (exactly one path between any two cells) via
 * randomised depth-first search, carving passages as it backtracks out of
 * dead-ends. That backtracking is what produces plenty of dead-end branches.
 */
function generateMaze(cols, rows) {
  const grid = createGrid(cols, rows);
  const stack = [[0, 0]];
  grid[0][0].visited = true;

  while (stack.length > 0) {
    const [x, y] = stack[stack.length - 1];
    const neighbours = getUnvisitedNeighbours(grid, x, y, cols, rows);

    if (neighbours.length === 0) {
      stack.pop();
      continue;
    }

    const [nx, ny, wall] = neighbours[Math.floor(Math.random() * neighbours.length)];
    grid[y][x].walls &= ~wall;
    grid[ny][nx].walls &= ~OPPOSITE[wall];
    grid[ny][nx].visited = true;
    stack.push([nx, ny]);
  }

  return grid;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawWalls() {
  const { grid, cols, rows, cellSize } = state;

  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = grid[y][x];
      const px = x * cellSize;
      const py = y * cellSize;

      ctx.beginPath();
      if (cell.walls & WALL.TOP) {
        ctx.moveTo(px, py);
        ctx.lineTo(px + cellSize, py);
      }
      if (cell.walls & WALL.RIGHT) {
        ctx.moveTo(px + cellSize, py);
        ctx.lineTo(px + cellSize, py + cellSize);
      }
      if (cell.walls & WALL.BOTTOM) {
        ctx.moveTo(px, py + cellSize);
        ctx.lineTo(px + cellSize, py + cellSize);
      }
      if (cell.walls & WALL.LEFT) {
        ctx.moveTo(px, py);
        ctx.lineTo(px, py + cellSize);
      }
      ctx.stroke();
    }
  }
}

function drawExit() {
  const { exit, cellSize } = state;
  const cx = exit.x * cellSize + cellSize / 2;
  const cy = exit.y * cellSize + cellSize / 2;

  ctx.fillStyle = '#4ade80';
  ctx.fillRect(cx - cellSize * 0.3, cy - cellSize * 0.3, cellSize * 0.6, cellSize * 0.6);
}

function drawPlayer() {
  const { player, cellSize } = state;
  const cx = player.x * cellSize + cellSize / 2;
  const cy = player.y * cellSize + cellSize / 2;

  ctx.fillStyle = '#f472b6';
  ctx.beginPath();
  ctx.arc(cx, cy, cellSize * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Sizes the canvas and redraws everything. Called on state changes only —
 * this isn't an animation loop, so there's no per-frame redraw.
 */
function render() {
  state.cellSize = Math.floor(MAX_CANVAS_SIZE / Math.max(state.cols, state.rows));
  canvas.width = state.cellSize * state.cols;
  canvas.height = state.cellSize * state.rows;
  levelDisplay.textContent = `Level ${state.level}`;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawWalls();
  drawExit();
  drawPlayer();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const KEY_MOVES = {
  ArrowUp: { dx: 0, dy: -1, wall: WALL.TOP },
  ArrowRight: { dx: 1, dy: 0, wall: WALL.RIGHT },
  ArrowDown: { dx: 0, dy: 1, wall: WALL.BOTTOM },
  ArrowLeft: { dx: -1, dy: 0, wall: WALL.LEFT },
};

function tryMovePlayer(dx, dy, wall) {
  const { player, grid } = state;
  const cell = grid[player.y][player.x];

  // Blocked if the wall on that side hasn't been carved away.
  if (cell.walls & wall) return;

  player.x += dx;
  player.y += dy;
}

function handleKeyDown(event) {
  const move = KEY_MOVES[event.key];
  if (!move) return;

  event.preventDefault(); // stop the page scrolling on arrow keys
  tryMovePlayer(move.dx, move.dy, move.wall);
  render();
}

window.addEventListener('keydown', handleKeyDown);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function startLevel(level) {
  state.level = level;
  state.cols = 8;
  state.rows = 8;
  state.grid = generateMaze(state.cols, state.rows);
  state.player = { x: 0, y: 0 }; // fixed start: top-left
  state.exit = { x: state.cols - 1, y: state.rows - 1 }; // opposite corner
}

startLevel(1);
render();
