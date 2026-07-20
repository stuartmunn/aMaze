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
  player: { x: 0, y: 0 }, // logical cell — authoritative for movement/win checks
  displayPlayer: { x: 0, y: 0 }, // animated position (can be mid-cell) — used for rendering only
  exit: { x: 0, y: 0 },
  fogRadius: null,
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

// Fog of war: only cells within this many steps (Chebyshev distance) of the
// player are revealed. null means no fog — everything's visible.
const FOG_START_LEVEL = 3;
const FOG_MIN_RADIUS = 3;

function getFogRadius(level) {
  if (level < FOG_START_LEVEL) return null;
  return Math.max(FOG_MIN_RADIUS, 8 - (level - FOG_START_LEVEL));
}

function isVisible(x, y) {
  if (state.fogRadius === null) return true;
  const { displayPlayer } = state;
  return Math.max(Math.abs(x - displayPlayer.x), Math.abs(y - displayPlayer.y)) <= state.fogRadius;
}

function drawWalls() {
  const { grid, cols, rows, cellSize } = state;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * cellSize;
      const py = y * cellSize;

      if (!isVisible(x, y)) {
        ctx.fillStyle = '#161622'; // unrevealed cell — solid fog
        ctx.fillRect(px, py, cellSize, cellSize);
        continue;
      }

      const cell = grid[y][x];
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';

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
  const { displayPlayer, cellSize } = state;
  const cx = displayPlayer.x * cellSize + cellSize / 2;
  const cy = displayPlayer.y * cellSize + cellSize / 2;

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

// The two walls at right angles to a given direction of travel — used to
// spot side passages so a run can stop at a junction.
const PERPENDICULAR = {
  [WALL.TOP]: [WALL.LEFT, WALL.RIGHT],
  [WALL.BOTTOM]: [WALL.LEFT, WALL.RIGHT],
  [WALL.LEFT]: [WALL.TOP, WALL.BOTTOM],
  [WALL.RIGHT]: [WALL.TOP, WALL.BOTTOM],
};

/**
 * Works out the run along (dx, dy) one cell at a time until the player
 * can't go any further — either a wall blocks the way ahead, or the cell
 * just entered has a side passage open (a choice) — and returns every cell
 * stepped through, start included, for the caller to animate along.
 * Updates state.player (the logical position) to the final cell.
 */
function computeMovePath(dx, dy, wall) {
  const { grid, exit } = state;
  const perpWalls = PERPENDICULAR[wall];
  let x = state.player.x;
  let y = state.player.y;
  const path = [{ x, y }];

  while (true) {
    const cell = grid[y][x];
    if (cell.walls & wall) break; // wall ahead — stop

    x += dx;
    y += dy;
    path.push({ x, y });

    if (x === exit.x && y === exit.y) break; // stop at exit

    const nextCell = grid[y][x];
    if (perpWalls.some((w) => !(nextCell.walls & w))) break; // junction — let player choose
  }

  state.player = { x, y };
  return path;
}

const MS_PER_CELL = 70; // animation speed for sliding between cells

// Tweens state.displayPlayer from `from` to `to`, redrawing every frame,
// then calls onComplete. This is what makes a run look like a slide rather
// than an instant jump.
function animateSegment(from, to, onComplete) {
  const start = performance.now();

  function frame(now) {
    const t = Math.min((now - start) / MS_PER_CELL, 1);
    state.displayPlayer = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    render();

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      onComplete();
    }
  }

  requestAnimationFrame(frame);
}

// Walks the animation through each segment of a path in turn, cell by cell.
function animatePath(path, index, onDone) {
  if (index >= path.length - 1) {
    onDone();
    return;
  }
  animateSegment(path[index], path[index + 1], () => animatePath(path, index + 1, onDone));
}

function handleKeyDown(event) {
  const move = KEY_MOVES[event.key];
  if (!move) return;

  event.preventDefault(); // stop the page scrolling on arrow keys

  const path = computeMovePath(move.dx, move.dy, move.wall);
  if (path.length <= 1) return; // blocked immediately — nothing to animate

  window.removeEventListener('keydown', handleKeyDown); // block input mid-slide
  animatePath(path, 0, () => {
    window.addEventListener('keydown', handleKeyDown);

    if (state.player.x === state.exit.x && state.player.y === state.exit.y) {
      onLevelComplete();
    }
  });
}

function onLevelComplete() {
  levelDisplay.textContent = `Level ${state.level} complete!`;
  window.removeEventListener('keydown', handleKeyDown); // pause input during the flash

  setTimeout(() => {
    startLevel(state.level + 1);
    render();
    window.addEventListener('keydown', handleKeyDown);
  }, 800);
}

window.addEventListener('keydown', handleKeyDown);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const STARTING_SIZE = 8;
const SIZE_GROWTH_PER_LEVEL = 2;

function startLevel(level) {
  state.level = level;
  state.cols = STARTING_SIZE + (level - 1) * SIZE_GROWTH_PER_LEVEL;
  state.rows = STARTING_SIZE + (level - 1) * SIZE_GROWTH_PER_LEVEL;
  state.grid = generateMaze(state.cols, state.rows);
  state.player = { x: 0, y: 0 }; // fixed start: top-left
  state.displayPlayer = { x: 0, y: 0 };
  state.exit = { x: state.cols - 1, y: state.rows - 1 }; // opposite corner
  state.fogRadius = getFogRadius(level);
}

startLevel(1);
render();
