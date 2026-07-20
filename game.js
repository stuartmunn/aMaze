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
const healthFill = document.getElementById('health-fill');
const healthText = document.getElementById('health-text');
const gameOverOverlay = document.getElementById('game-over-overlay');
const restartBtn = document.getElementById('restart-btn');

const MAX_CANVAS_SIZE = 640; // px — upper bound; actual size also shrinks to fit the viewport
const VIEWPORT_MARGIN = 40; // px — safety margin so the canvas never triggers scroll

// Largest square the canvas can be without pushing the page taller than the
// viewport (accounting for the heading/HUD above it) or wider than the window.
function getAvailableCanvasSize() {
  const availableHeight = window.innerHeight - canvas.getBoundingClientRect().top - VIEWPORT_MARGIN;
  const availableWidth = window.innerWidth - VIEWPORT_MARGIN;
  return Math.max(200, Math.min(MAX_CANVAS_SIZE, availableHeight, availableWidth));
}

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
  animating: false, // true while a corridor-run slide is in progress — blocks new input
  health: 100, // persists across levels; only resets on restart after game over
  traps: new Map(), // "x,y" -> { triggered: bool } — hidden dead-end traps for the current level
  gameOver: false,
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

const TRAP_MIN_RATIO = 0.1;
const TRAP_MAX_RATIO = 0.3;
const TRAP_MIN_DAMAGE = 5;
const TRAP_MAX_DAMAGE = 20;

// A dead-end is a cell with only one opening (three of its four walls up).
function findDeadEnds(grid, cols, rows, exit) {
  const deadEnds = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (x === 0 && y === 0) continue; // start
      if (x === exit.x && y === exit.y) continue;
      const walls = grid[y][x].walls;
      const openings = [WALL.TOP, WALL.RIGHT, WALL.BOTTOM, WALL.LEFT].filter((w) => !(walls & w));
      if (openings.length === 1) deadEnds.push({ x, y });
    }
  }
  return deadEnds;
}

// Seeds a random 10-30% (re-rolled per level) of this level's dead-ends with
// a hidden trap. Traps stay invisible until the player steps on them.
function placeTraps(grid, cols, rows, exit) {
  const deadEnds = findDeadEnds(grid, cols, rows, exit);
  const ratio = TRAP_MIN_RATIO + Math.random() * (TRAP_MAX_RATIO - TRAP_MIN_RATIO);
  const trapCount = Math.round(deadEnds.length * ratio);

  // Fisher-Yates shuffle, then take the first trapCount cells.
  for (let i = deadEnds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deadEnds[i], deadEnds[j]] = [deadEnds[j], deadEnds[i]];
  }

  const traps = new Map();
  for (const { x, y } of deadEnds.slice(0, trapCount)) {
    traps.set(`${x},${y}`, { triggered: false });
  }
  return traps;
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

// Masonry shades for wall blocks — picked deterministically per block (from
// cell coords + side + block index) so the texture is stable across redraws
// rather than flickering during the corridor-run slide animation.
const STONE_SHADES = ['#9a9aa2', '#86868f', '#72727b', '#5e5e66'];
const STONE_BLOCKS_PER_EDGE = 3;
const MORTAR_GAP_RATIO = 0.12; // fraction of block length left as a mortar gap

function stoneShade(seed, shades = STONE_SHADES) {
  return shades[((seed % shades.length) + shades.length) % shades.length];
}

// Draws one wall edge as a row of stone blocks with mortar gaps between them
// and a dark offset "shadow" stroke beneath each block for a bit of depth.
function drawStoneEdge(x1, y1, x2, y2, seedBase) {
  const dx = (x2 - x1) / STONE_BLOCKS_PER_EDGE;
  const dy = (y2 - y1) / STONE_BLOCKS_PER_EDGE;
  const len = Math.hypot(dx, dy) || 1;
  const gap = len * MORTAR_GAP_RATIO;
  const ux = dx / len;
  const uy = dy / len;

  for (let i = 0; i < STONE_BLOCKS_PER_EDGE; i++) {
    const sx = x1 + dx * i + ux * gap;
    const sy = y1 + dy * i + uy * gap;
    const ex = x1 + dx * (i + 1) - ux * gap;
    const ey = y1 + dy * (i + 1) - uy * gap;

    ctx.strokeStyle = '#33333d';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx + 1, sy + 1);
    ctx.lineTo(ex + 1, ey + 1);
    ctx.stroke();

    ctx.strokeStyle = stoneShade(seedBase + i);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
}

// Flagstone floor: each cell split into a 2x2 grid of tiles, shaded
// deterministically (from cell coords) so the pattern is stable across
// redraws rather than flickering during the corridor-run slide animation.
const FLAGSTONE_SHADES = ['#262635', '#2b2b3a', '#20202d', '#282838'];
const FLAGSTONE_GROUT = '#17171f';

function drawFlagstoneFloor(px, py, cellSize, seedBase) {
  const half = cellSize / 2;
  const grout = Math.max(1, cellSize * 0.03);

  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      ctx.fillStyle = FLAGSTONE_GROUT;
      ctx.fillRect(px + tx * half, py + ty * half, half, half);

      ctx.fillStyle = stoneShade(seedBase + tx * 5 + ty * 11, FLAGSTONE_SHADES);
      ctx.fillRect(px + tx * half + grout, py + ty * half + grout, half - grout * 2, half - grout * 2);
    }
  }
}

function drawWalls() {
  const { grid, cols, rows, cellSize } = state;
  ctx.lineCap = 'butt'; // square block ends, not rounded

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * cellSize;
      const py = y * cellSize;

      if (!isVisible(x, y)) {
        ctx.fillStyle = '#161622'; // unrevealed cell — solid fog
        ctx.fillRect(px, py, cellSize, cellSize);
        continue;
      }

      const seedBase = x * 31 + y * 17;
      drawFlagstoneFloor(px, py, cellSize, seedBase);

      const cell = grid[y][x];

      if (cell.walls & WALL.TOP) drawStoneEdge(px, py, px + cellSize, py, seedBase + WALL.TOP * 7);
      if (cell.walls & WALL.RIGHT) drawStoneEdge(px + cellSize, py, px + cellSize, py + cellSize, seedBase + WALL.RIGHT * 7);
      if (cell.walls & WALL.BOTTOM) drawStoneEdge(px, py + cellSize, px + cellSize, py + cellSize, seedBase + WALL.BOTTOM * 7);
      if (cell.walls & WALL.LEFT) drawStoneEdge(px, py, px, py + cellSize, seedBase + WALL.LEFT * 7);

      const trap = state.traps.get(`${x},${y}`);
      if (trap && trap.triggered) drawExplosion(px, py, cellSize);
    }
  }
}

// Triggered trap marker: a jagged orange/red burst, drawn once revealed and
// left in place permanently as a warning.
function drawExplosion(px, py, cellSize) {
  const cx = px + cellSize / 2;
  const cy = py + cellSize / 2;
  const outer = cellSize * 0.4;
  const inner = cellSize * 0.18;
  const points = 8;

  ctx.fillStyle = '#ff6a1f';
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / points;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(cx, cy, cellSize * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

// Steps shrink and darken toward the centre, giving a "receding downward"
// look for a top-down stairway.
const STAIR_STEP_SHADES = ['#a8a8a8', '#87877e', '#666660', '#454542', '#242220'];

function drawExit() {
  const { exit, cellSize } = state;
  const cx = exit.x * cellSize + cellSize / 2;
  const cy = exit.y * cellSize + cellSize / 2;
  const steps = STAIR_STEP_SHADES.length;
  const maxSize = cellSize * 0.7;

  for (let i = 0; i < steps; i++) {
    const size = maxSize * (1 - i / steps);
    ctx.fillStyle = STAIR_STEP_SHADES[i];
    ctx.fillRect(cx - size / 2, cy - size / 2, size, size * 0.6);
  }
}

function drawPlayer() {
  const { displayPlayer, cellSize } = state;
  const cx = displayPlayer.x * cellSize + cellSize / 2;
  const cy = displayPlayer.y * cellSize + cellSize / 2;
  const s = cellSize * 0.3; // base scale, matches the old circle's radius

  // Robe: a rounded triangle-ish body tapering from shoulders to feet.
  ctx.fillStyle = '#7c5cff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.1);
  ctx.lineTo(cx - s * 0.75, cy + s);
  ctx.quadraticCurveTo(cx, cy + s * 1.2, cx + s * 0.75, cy + s);
  ctx.closePath();
  ctx.fill();

  // Head.
  ctx.fillStyle = '#f2c9a0';
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.35, s * 0.35, 0, Math.PI * 2);
  ctx.fill();

  // Pointed wizard hat, with a star trim near the brim.
  ctx.fillStyle = '#7c5cff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 1.5);
  ctx.lineTo(cx - s * 0.55, cy - s * 0.25);
  ctx.lineTo(cx + s * 0.55, cy - s * 0.25);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#f4d35e';
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.6, s * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Sizes the canvas and redraws everything. Called on state changes only —
 * this isn't an animation loop, so there's no per-frame redraw.
 */
function render() {
  state.cellSize = Math.floor(getAvailableCanvasSize() / Math.max(state.cols, state.rows));
  canvas.width = state.cellSize * state.cols;
  canvas.height = state.cellSize * state.rows;
  levelDisplay.textContent = `Level ${state.level}`;
  updateHealthDisplay();

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawWalls();
  drawExit();
  drawPlayer();
}

function updateHealthDisplay() {
  const health = Math.max(0, state.health);
  healthFill.style.width = `${health}%`;
  healthText.textContent = String(health);
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
  if (!move || state.animating) return;

  event.preventDefault(); // stop the page scrolling on arrow keys

  const path = computeMovePath(move.dx, move.dy, move.wall);
  if (path.length <= 1) return; // blocked immediately — nothing to animate

  state.animating = true;
  animatePath(path, 0, () => {
    // finally guarantees the flag clears even if onLevelComplete throws,
    // so a broken level transition can't permanently lock out input.
    try {
      checkTrap();
      if (state.gameOver) return;
      if (state.player.x === state.exit.x && state.player.y === state.exit.y) {
        onLevelComplete();
      }
    } finally {
      state.animating = false;
    }
  });
}

// Checks whether the player's current cell holds an untriggered trap; if so,
// deals random damage, reveals the explosion marker, and ends the game if
// health runs out.
function checkTrap() {
  const key = `${state.player.x},${state.player.y}`;
  const trap = state.traps.get(key);
  if (!trap || trap.triggered) return;

  trap.triggered = true;
  const damage = TRAP_MIN_DAMAGE + Math.floor(Math.random() * (TRAP_MAX_DAMAGE - TRAP_MIN_DAMAGE + 1));
  state.health = Math.max(0, state.health - damage);
  updateHealthDisplay();

  if (state.health <= 0) onGameOver();
}

function onGameOver() {
  state.gameOver = true;
  window.removeEventListener('keydown', handleKeyDown);
  render();
  gameOverOverlay.classList.remove('hidden');
}

restartBtn.addEventListener('click', () => {
  gameOverOverlay.classList.add('hidden');
  state.health = 100;
  state.gameOver = false;
  startLevel(1);
  render();
  window.addEventListener('keydown', handleKeyDown);
});

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
window.addEventListener('resize', render); // re-fit the canvas if the window is resized

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
  state.traps = placeTraps(state.grid, state.cols, state.rows, state.exit);
}

startLevel(1);
render();
