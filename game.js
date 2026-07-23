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
const manaFill = document.getElementById('mana-fill');
const manaText = document.getElementById('mana-text');
const gameOverOverlay = document.getElementById('game-over-overlay');
const restartBtn = document.getElementById('restart-btn');
const dragonEntry = document.getElementById('dragon-entry');
const dragonNameEl = document.getElementById('dragon-name');
const dragonHealthFill = document.getElementById('dragon-health-fill');
const nigelEntry = document.getElementById('nigel-entry');
const nigelNameEl = document.getElementById('nigel-name');
const nigelHealthFill = document.getElementById('nigel-health-fill');
const turnEventsEl = document.getElementById('turn-events');

const MAX_CANVAS_SIZE = 640; // px — upper bound; actual size also shrinks to fit the viewport
const VIEWPORT_MARGIN = 40; // px — safety margin so the canvas never triggers scroll
const MIN_CELL_SIZE = 40; // px — floor; once the whole maze can't fit at this size, camera mode kicks in

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
  mana: 10, // persists across levels; only resets on restart after game over
  turnEvents: [], // this-turn-only messages; cleared at the start of each player action
  turnCount: 0, // increments once per player action — drives mana regen and gates Nigel's spawn
  traps: new Map(), // "x,y" -> { triggered: bool } — hidden dead-end traps for the current level
  gameOver: false,
  dragon: null, // null below DRAGON_MIN_LEVEL, or after respawn each level — see spawnDragon
  nigel: null, // re-rolled every level — see spawnNigel
  nigelIsLich: false, // set permanently for the rest of the run once he's first killed
  playerFireball: null, // in-flight fireball animation state, whoever the target is
  cameraMode: false, // true once the maze no longer fits on screen at MIN_CELL_SIZE — enables scrolling viewport
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

// D&D-style 3d6 roll, used for spell-cast checks, aim/hit checks, and damage
// rolls. A roll of 17 or 18 is a critical hit (damage doubled at the call site).
function rollD6() {
  return 1 + Math.floor(Math.random() * 6);
}

function roll3d6() {
  return rollD6() + rollD6() + rollD6();
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

const DRAGON_MIN_LEVEL = 6;
const DRAGON_TRIGGER_MIN = 2;
const DRAGON_TRIGGER_MAX = 10;
const DRAGON_MIN_HEALTH = 50;
const DRAGON_BREATH_RANGE = 2; // line-of-sight cells, stopped by walls
const FIREBALL_RANGE = 3; // line-of-sight cells, stopped by walls
const MAX_MANA = 10;
const HEAL_MANA_COST = 5;
const HEAL_AMOUNT = 20; // 20% of max health (health is 0-100)

const NIGEL_SPAWN_DELAY_TURNS = 10; // turns after level start before he enters the maze
const NIGEL_MAX_HEALTH = 100; // mirrors the player's health
const NIGEL_MAX_MANA = 10;
const NIGEL_SPELL_COST = 1; // mana per lightning bolt or heal
const NIGEL_LIGHTNING_RANGE = 3; // line-of-sight cells, stopped by walls
const NIGEL_HEAL_AMOUNT = 25;
const NIGEL_FLEE_RATIO = 0.5; // flees (or fights if cornered) at or below this fraction of max health
const NIGEL_SENSE_RADIUS = 6; // straight-line "notices a target" range, mirrors the dragon's triggerDistance

// Breadth-first search from `start` across the maze graph (an edge exists
// between two cells only where no wall blocks passage). Returns a map of
// "x,y" -> { dist, prev } for every reachable cell. In a perfect maze every
// cell is reachable from every other cell, so this always covers the grid.
function bfsFrom(grid, cols, rows, start) {
  const key = (x, y) => `${x},${y}`;
  const dist = new Map([[key(start.x, start.y), { dist: 0, prev: null }]]);
  const queue = [start];

  while (queue.length > 0) {
    const { x, y } = queue.shift();
    const cell = grid[y][x];
    const d = dist.get(key(x, y)).dist;
    const steps = [
      [x, y - 1, WALL.TOP],
      [x + 1, y, WALL.RIGHT],
      [x, y + 1, WALL.BOTTOM],
      [x - 1, y, WALL.LEFT],
    ];

    for (const [nx, ny, wall] of steps) {
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      if (cell.walls & wall) continue; // blocked
      const k = key(nx, ny);
      if (dist.has(k)) continue;
      dist.set(k, { dist: d + 1, prev: { x, y } });
      queue.push({ x: nx, y: ny });
    }
  }

  return dist;
}

// Straight-line (as-the-crow-flies) distance between two cells, ignoring
// walls entirely — used for the dragon's sense radius so it can detect the
// player through walls before it has line of sight or a clear path.
function gridDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Straight-line distance between two cells sharing a row or column, walking
// cell by cell and stopping at the first wall in the way. Returns Infinity
// if a wall blocks the line, or if the cells aren't aligned at all (no
// diagonal sight in a corridor maze — matches how movement itself works).
function lineOfSightDistance(grid, cols, rows, a, b) {
  if (a.x === b.x && a.y === b.y) return 0;

  if (a.x === b.x) {
    const dy = b.y > a.y ? 1 : -1;
    const wall = dy === 1 ? WALL.BOTTOM : WALL.TOP;
    let y = a.y;
    let dist = 0;
    while (y !== b.y) {
      if (grid[y][a.x].walls & wall) return Infinity;
      y += dy;
      dist++;
    }
    return dist;
  }

  if (a.y === b.y) {
    const dx = b.x > a.x ? 1 : -1;
    const wall = dx === 1 ? WALL.RIGHT : WALL.LEFT;
    let x = a.x;
    let dist = 0;
    while (x !== b.x) {
      if (grid[a.y][x].walls & wall) return Infinity;
      x += dx;
      dist++;
    }
    return dist;
  }

  return Infinity; // not aligned on a row or column
}

// Cells reachable in one step from (x, y) — i.e. neighbours not blocked by a
// wall. Used for Nigel's wander/flee movement (unlike the dragon, which
// only ever moves via BFS-toward-target).
function getOpenNeighbours(grid, x, y, cols, rows) {
  const cell = grid[y][x];
  const steps = [
    [x, y - 1, WALL.TOP],
    [x + 1, y, WALL.RIGHT],
    [x, y + 1, WALL.BOTTOM],
    [x - 1, y, WALL.LEFT],
  ];
  return steps
    .filter(([nx, ny, wall]) => nx >= 0 && nx < cols && ny >= 0 && ny < rows && !(cell.walls & wall))
    .map(([nx, ny]) => ({ x: nx, y: ny }));
}

// Picks one dead-end for the dragon (avoiding cells already trapped where
// possible) and rolls its stats fresh for the level. Returns null below
// DRAGON_MIN_LEVEL.
function spawnDragon(grid, cols, rows, exit, traps, level) {
  if (level < DRAGON_MIN_LEVEL) return null;

  const deadEnds = findDeadEnds(grid, cols, rows, exit);
  const untrapped = deadEnds.filter(({ x, y }) => !traps.has(`${x},${y}`));
  const candidates = untrapped.length > 0 ? untrapped : deadEnds;
  const spawn = candidates[Math.floor(Math.random() * candidates.length)];

  // Linear growth (rather than the old level*100 spread) so a dragon fight
  // stays winnable in a reasonable number of turns now that hits can miss
  // and damage is dice-capped.
  const maxHealth = DRAGON_MIN_HEALTH + level * 20 + Math.floor(Math.random() * 21);
  const triggerDistance = DRAGON_TRIGGER_MIN + Math.floor(Math.random() * (DRAGON_TRIGGER_MAX - DRAGON_TRIGGER_MIN + 1));

  return {
    pos: { x: spawn.x, y: spawn.y },
    health: maxHealth,
    maxHealth,
    awake: false,
    triggerDistance,
    moveCounter: 0,
    defeated: false,
    sighted: false, // becomes true once the player has seen it on screen; name then replaces '???'
    fireBreath: null,
  };
}

// Nigel always exists from level start, but stays inactive (off the
// board, not rendered, no turn taken) until NIGEL_SPAWN_DELAY_TURNS have
// elapsed — see resolveNigelTurn. He then enters at the maze entrance,
// same as the player. Once killed, he returns every level after as a Lich —
// same stats and AI, just a permanent identity/appearance change (set via
// state.nigelIsLich in startLevel) — and can be killed again freely.
function spawnNigel(isLich) {
  return {
    pos: { x: 0, y: 0 },
    health: NIGEL_MAX_HEALTH,
    maxHealth: NIGEL_MAX_HEALTH,
    mana: NIGEL_MAX_MANA,
    maxMana: NIGEL_MAX_MANA,
    active: false,
    defeated: false,
    sighted: false,
    isLich,
    lightningBolt: null,
    healFx: null,
  };
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

// How fogged a cell is: 0 = fully clear, 1 = fully hidden. Cells beyond
// fogRadius fade in over FOG_BAND cells rather than cutting off sharply,
// and distance is Euclidean (not Chebyshev) so the revealed area reads as
// a circle rather than a square.
const FOG_BAND = 1.5;

function fogAmount(x, y) {
  if (state.fogRadius === null) return 0;
  const d = gridDistance({ x, y }, state.displayPlayer);
  return Math.max(0, Math.min(1, (d - state.fogRadius) / FOG_BAND));
}

function isVisible(x, y) {
  return fogAmount(x, y) < 1;
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

      const seedBase = x * 31 + y * 17;
      const amount = fogAmount(x, y);

      if (amount >= 1) {
        drawMist(px, py, cellSize, seedBase, 1);
        continue;
      }

      drawFlagstoneFloor(px, py, cellSize, seedBase);

      const cell = grid[y][x];

      if (cell.walls & WALL.TOP) drawStoneEdge(px, py, px + cellSize, py, seedBase + WALL.TOP * 7);
      if (cell.walls & WALL.RIGHT) drawStoneEdge(px + cellSize, py, px + cellSize, py + cellSize, seedBase + WALL.RIGHT * 7);
      if (cell.walls & WALL.BOTTOM) drawStoneEdge(px, py + cellSize, px + cellSize, py + cellSize, seedBase + WALL.BOTTOM * 7);
      if (cell.walls & WALL.LEFT) drawStoneEdge(px, py, px, py + cellSize, seedBase + WALL.LEFT * 7);

      const trap = state.traps.get(`${x},${y}`);
      if (trap && trap.triggered) drawExplosion(px, py, cellSize);

      if (amount > 0) drawMist(px, py, cellSize, seedBase, amount);
    }
  }
}

// Deterministic pseudo-random in [0, 1) from a seed, so blob positions stay
// stable across redraws instead of flickering during the slide animation.
function mistRand(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Mist/fog texture for a fogged cell: a dark base wash plus a few soft,
// blurred grey-white blobs (radial gradients) at pseudo-random offsets.
// `amount` (0-1) scales opacity so the effect fades in at the fog boundary
// rather than cutting off sharply.
const MIST_BLOB_COUNT = 3;

function drawMist(px, py, cellSize, seedBase, amount) {
  ctx.fillStyle = `rgba(22, 22, 34, ${amount})`;
  ctx.fillRect(px, py, cellSize, cellSize);

  for (let i = 0; i < MIST_BLOB_COUNT; i++) {
    const rx = mistRand(seedBase + i * 13.1);
    const ry = mistRand(seedBase + i * 27.7 + 5);
    const rr = 0.35 + mistRand(seedBase + i * 41.3 + 9) * 0.35;
    const cx = px + rx * cellSize;
    const cy = py + ry * cellSize;
    const radius = rr * cellSize;

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, `rgba(210, 214, 224, ${0.35 * amount})`);
    gradient.addColorStop(1, 'rgba(210, 214, 224, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
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
  if (!isVisible(exit.x, exit.y)) return;
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

function drawDragon() {
  const { dragon, cellSize } = state;
  if (!isVisible(dragon.pos.x, dragon.pos.y)) return;

  const cx = dragon.pos.x * cellSize + cellSize / 2;
  const cy = dragon.pos.y * cellSize + cellSize / 2;

  ctx.font = `${cellSize * 0.8}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🐉', cx, cy);
}

// Nigel's dark counterpart to drawPlayer: same silhouette, black-and-red
// palette, no star trim — reads as a corrupted mirror of the player's sprite
// rather than another emoji stamp.
function drawNigel() {
  const { nigel, cellSize } = state;
  if (!isVisible(nigel.pos.x, nigel.pos.y)) return;

  const cx = nigel.pos.x * cellSize + cellSize / 2;
  const cy = nigel.pos.y * cellSize + cellSize / 2;
  const s = cellSize * 0.3;

  // The Lich (post-death reincarnation) swaps the fleshy head/robe trim for
  // a bare skull and a sickly green glow, so he reads as a different
  // creature at a glance despite sharing the same silhouette and stats.
  const robe = '#241a1a';
  const head = nigel.isLich ? '#d8e8d8' : '#c9a688';
  const trim = nigel.isLich ? '#5fe07a' : '#d13b3b';

  ctx.fillStyle = robe;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.1);
  ctx.lineTo(cx - s * 0.75, cy + s);
  ctx.quadraticCurveTo(cx, cy + s * 1.2, cx + s * 0.75, cy + s);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.35, s * 0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = robe;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 1.5);
  ctx.lineTo(cx - s * 0.55, cy - s * 0.25);
  ctx.lineTo(cx + s * 0.55, cy - s * 0.25);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = trim;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.6, s * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

const FIRE_BREATH_MS = 350;
const FIREBALL_MS = 300;

function cellCentre(cell) {
  return { x: cell.x * state.cellSize + state.cellSize / 2, y: cell.y * state.cellSize + state.cellSize / 2 };
}

// Straight tapered bolt from the dragon to the player, fading out near the end.
function drawFireBreathFrame(fb) {
  const t = Math.min((performance.now() - fb.startTime) / FIRE_BREATH_MS, 1);
  const from = cellCentre(fb.from);
  const to = cellCentre(fb.to);
  const x = from.x + (to.x - from.x) * t;
  const y = from.y + (to.y - from.y) * t;
  const alpha = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;

  ctx.strokeStyle = `rgba(255, 106, 31, ${alpha})`;
  ctx.lineWidth = state.cellSize * 0.25;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(x, y);
  ctx.stroke();

  ctx.fillStyle = `rgba(255, 210, 63, ${alpha})`;
  ctx.beginPath();
  ctx.arc(x, y, state.cellSize * 0.15, 0, Math.PI * 2);
  ctx.fill();
}

function startFireBreathAnimation(from, to, onComplete) {
  state.dragon.fireBreath = { from, to, startTime: performance.now() };

  function frame(now) {
    const t = Math.min((now - state.dragon.fireBreath.startTime) / FIRE_BREATH_MS, 1);
    render();

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      state.dragon.fireBreath = null;
      render(); // clear the bolt from canvas before handing back control
      onComplete();
    }
  }

  requestAnimationFrame(frame);
}

// Small flaming orb arcing from the player to the dragon (a lifted midpoint
// distinguishes it visually from the dragon's straight fire-breath bolt).
function drawFireballFrame(fb) {
  const t = Math.min((performance.now() - fb.startTime) / FIREBALL_MS, 1);
  const from = cellCentre(fb.from);
  const to = cellCentre(fb.to);
  const lift = -state.cellSize * 0.6 * Math.sin(Math.PI * t);
  const x = from.x + (to.x - from.x) * t;
  const y = from.y + (to.y - from.y) * t + lift;

  ctx.fillStyle = '#ff8a3f';
  ctx.beginPath();
  ctx.arc(x, y, state.cellSize * 0.14, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(x, y, state.cellSize * 0.07, 0, Math.PI * 2);
  ctx.fill();
}

function startFireballAnimation(from, to, onComplete) {
  state.playerFireball = { from, to, startTime: performance.now() };

  function frame(now) {
    const t = Math.min((now - state.playerFireball.startTime) / FIREBALL_MS, 1);
    render();

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      state.playerFireball = null;
      render(); // clear the orb from canvas before handing back control
      onComplete();
    }
  }

  requestAnimationFrame(frame);
}

const LIGHTNING_MS = 250;

// Jagged blue-white bolt from Nigel to his target, built from a few
// randomised midpoint offsets so it reads as lightning rather than a straight
// laser. The zigzag points are re-rolled once per cast (stored on the fx
// object) rather than every frame, so the bolt doesn't crawl while it fades.
function drawLightningFrame(fx) {
  const t = Math.min((performance.now() - fx.startTime) / LIGHTNING_MS, 1);
  const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
  const from = cellCentre(fx.from);
  const to = cellCentre(fx.to);

  ctx.strokeStyle = `rgba(120, 200, 255, ${alpha})`;
  ctx.lineWidth = state.cellSize * 0.12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  for (const [ox, oy] of fx.jitter) {
    ctx.lineTo(from.x + (to.x - from.x) * ox + oy, from.y + (to.y - from.y) * ox - oy);
  }
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function startLightningAnimation(from, to, onComplete) {
  const jitter = [0.25, 0.5, 0.75].map((frac) => [frac, (Math.random() - 0.5) * state.cellSize * 0.4]);
  state.nigel.lightningBolt = { from, to, jitter, startTime: performance.now() };

  function frame(now) {
    const t = Math.min((now - state.nigel.lightningBolt.startTime) / LIGHTNING_MS, 1);
    render();

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      state.nigel.lightningBolt = null;
      render();
      onComplete();
    }
  }

  requestAnimationFrame(frame);
}

const HEAL_FX_MS = 400;

// Simple green pulse over Nigel's cell for self-heals.
function drawHealFxFrame(fx) {
  const t = Math.min((performance.now() - fx.startTime) / HEAL_FX_MS, 1);
  const { x, y } = cellCentre(fx.at);
  const radius = state.cellSize * 0.5 * t;
  const alpha = 1 - t;

  ctx.strokeStyle = `rgba(90, 220, 120, ${alpha})`;
  ctx.lineWidth = state.cellSize * 0.08;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function startHealFxAnimation(at, onComplete) {
  state.nigel.healFx = { at, startTime: performance.now() };

  function frame(now) {
    const t = Math.min((now - state.nigel.healFx.startTime) / HEAL_FX_MS, 1);
    render();

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      state.nigel.healFx = null;
      render();
      onComplete();
    }
  }

  requestAnimationFrame(frame);
}

/**
 * Sizes the canvas and redraws everything. Called on state changes only —
 * this isn't an animation loop, so there's no per-frame redraw.
 */
function render() {
  const available = getAvailableCanvasSize();
  const fitCellSize = available / Math.max(state.cols, state.rows);
  state.cameraMode = fitCellSize < MIN_CELL_SIZE;

  if (state.cameraMode) {
    state.cellSize = MIN_CELL_SIZE;
    canvas.width = Math.floor(available);
    canvas.height = Math.floor(available);
  } else {
    state.cellSize = Math.floor(fitCellSize);
    canvas.width = state.cellSize * state.cols;
    canvas.height = state.cellSize * state.rows;
  }
  levelDisplay.textContent = `Level ${state.level}`;

  updateHealthDisplay();
  updateManaDisplay();
  updateDragonHealthDisplay();
  updateNigelHealthDisplay();

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (state.cameraMode) {
    const off = computeCameraOffset();
    ctx.translate(-off.x, -off.y);
  }
  drawWalls();
  drawExit();
  if (state.dragon && !state.dragon.defeated) drawDragon();
  if (state.nigel && state.nigel.active && !state.nigel.defeated) drawNigel();
  drawPlayer();
  if (state.dragon && state.dragon.fireBreath) drawFireBreathFrame(state.dragon.fireBreath);
  if (state.playerFireball) drawFireballFrame(state.playerFireball);
  if (state.nigel && state.nigel.lightningBolt) drawLightningFrame(state.nigel.lightningBolt);
  if (state.nigel && state.nigel.healFx) drawHealFxFrame(state.nigel.healFx);
  ctx.restore();
}

// Scrolling-viewport offset once the maze has outgrown the canvas at
// MIN_CELL_SIZE: centres on the player's animated position, clamped so the
// view never scrolls past the maze edges.
function computeCameraOffset() {
  const worldW = state.cols * state.cellSize;
  const worldH = state.rows * state.cellSize;
  const viewW = canvas.width;
  const viewH = canvas.height;

  const playerPxX = state.displayPlayer.x * state.cellSize + state.cellSize / 2;
  const playerPxY = state.displayPlayer.y * state.cellSize + state.cellSize / 2;

  let offsetX = playerPxX - viewW / 2;
  let offsetY = playerPxY - viewH / 2;

  offsetX = Math.max(0, Math.min(offsetX, Math.max(0, worldW - viewW)));
  offsetY = Math.max(0, Math.min(offsetY, Math.max(0, worldH - viewH)));

  return { x: offsetX, y: offsetY };
}

// Marks the dragon as sighted once it's actually visible on screen (past the
// fog boundary). Sighted is one-way for the level, so once set there's
// nothing left to check. Called from game-logic points where player/dragon
// position changes, not from render() — sighting is state, not a display concern.
function updateDragonSighting() {
  const dragon = state.dragon;
  if (!dragon || dragon.defeated || dragon.sighted) return;
  if (isVisible(dragon.pos.x, dragon.pos.y)) {
    dragon.sighted = true;
    logEvent('Dragon detected!');
  }
}

function updateNigelSighting() {
  const nigel = state.nigel;
  if (!nigel || !nigel.active || nigel.defeated || nigel.sighted) return;
  if (isVisible(nigel.pos.x, nigel.pos.y)) {
    nigel.sighted = true;
    logEvent(`${nigelName(nigel)} detected!`);
  }
}

function updateHealthDisplay() {
  const health = Math.max(0, state.health);
  healthFill.style.width = `${health}%`;
  healthText.textContent = String(health);
}

function updateManaDisplay() {
  const mana = Math.max(0, state.mana);
  manaFill.style.width = `${(mana / MAX_MANA) * 100}%`;
  manaText.textContent = String(mana);
}

// Records one message for the current turn's summary. `turnEvents` is
// cleared at the start of each player action, so this only ever shows what
// just happened this turn, not a scrolling history.
function logEvent(message) {
  state.turnEvents.push(message);
  renderTurnEvents();
}

function renderTurnEvents() {
  turnEventsEl.textContent = state.turnEvents.length > 0 ? state.turnEvents.join(' ') : ' ';
}

// Nigel's display name, which permanently changes once he's first killed.
function nigelName(nigel) {
  return nigel.isLich ? 'Nigel the Necrolich' : 'Nigel the Necromancer';
}

function targetLabel(kind) {
  if (kind === 'player') return 'you';
  if (kind === 'dragon') return 'the dragon';
  return state.nigel ? nigelName(state.nigel) : 'Nigel the Necromancer';
}

function describeAttack(attackerLabel, targetKind, amount, hit, crit) {
  const target = targetLabel(targetKind);
  if (!hit) return `${attackerLabel} attacks ${target} and misses!`;
  const suffix = crit ? ' Critical hit!' : '';
  return `${attackerLabel} hits ${target} for ${amount}.${suffix}`;
}

function updateDragonHealthDisplay() {
  const dragon = state.dragon;
  if (!dragon || dragon.defeated) {
    dragonEntry.classList.add('hidden');
    return;
  }
  dragonEntry.classList.remove('hidden');
  dragonNameEl.textContent = dragon.sighted ? 'Dragon' : '???';
  const pct = Math.max(0, Math.round((dragon.health / dragon.maxHealth) * 100));
  dragonHealthFill.style.width = `${pct}%`;
}

function updateNigelHealthDisplay() {
  const nigel = state.nigel;
  if (!nigel || !nigel.active || nigel.defeated) {
    nigelEntry.classList.add('hidden');
    return;
  }
  nigelEntry.classList.remove('hidden');
  nigelNameEl.textContent = nigel.sighted ? nigelName(nigel) : '???';
  const pct = Math.max(0, Math.round((nigel.health / nigel.maxHealth) * 100));
  nigelHealthFill.style.width = `${pct}%`;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const KEY_MOVES = {
  ArrowUp: { dx: 0, dy: -1, wall: WALL.TOP },
  ArrowRight: { dx: 1, dy: 0, wall: WALL.RIGHT },
  ArrowDown: { dx: 0, dy: 1, wall: WALL.BOTTOM },
  ArrowLeft: { dx: -1, dy: 0, wall: WALL.LEFT },
  w: { dx: 0, dy: -1, wall: WALL.TOP },
  W: { dx: 0, dy: -1, wall: WALL.TOP },
  d: { dx: 1, dy: 0, wall: WALL.RIGHT },
  D: { dx: 1, dy: 0, wall: WALL.RIGHT },
  s: { dx: 0, dy: 1, wall: WALL.BOTTOM },
  S: { dx: 0, dy: 1, wall: WALL.BOTTOM },
  a: { dx: -1, dy: 0, wall: WALL.LEFT },
  A: { dx: -1, dy: 0, wall: WALL.LEFT },
};

/**
 * Steps the player exactly one cell in (dx, dy) if the wall in that
 * direction isn't blocking — one key press, one tile, so the dragon's turn
 * cadence can't be outrun by a free multi-tile corridor slide. Returns the
 * one- or two-cell path (start included) for the caller to animate along,
 * or a single-cell path if blocked. Updates state.player on a successful move.
 */
function computeMovePath(dx, dy, wall) {
  const { grid } = state;
  const x = state.player.x;
  const y = state.player.y;
  const cell = grid[y][x];

  if (cell.walls & wall) return [{ x, y }]; // wall ahead — blocked

  const next = { x: x + dx, y: y + dy };
  state.player = next;
  return [{ x, y }, next];
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
    updateDragonSighting();
    updateNigelSighting();
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

// All currently-alive combatants other than the one named in `exclude`
// ('player', 'dragon', or 'nigel'), each as { kind, pos }. Shared by the
// dragon's and Nigel's turn resolution so either can target the other.
function livingTargetsFor(exclude) {
  const targets = [];
  if (exclude !== 'player' && !state.gameOver) targets.push({ kind: 'player', pos: state.player });
  if (exclude !== 'dragon' && state.dragon && !state.dragon.defeated) targets.push({ kind: 'dragon', pos: state.dragon.pos });
  if (exclude !== 'nigel' && state.nigel && state.nigel.active && !state.nigel.defeated) targets.push({ kind: 'nigel', pos: state.nigel.pos });
  return targets;
}

// Applies damage to whichever combatant `kind` names, updating its HUD and
// triggering its defeat/game-over handling. Shared by the player's fireball,
// the dragon's fire breath, and Nigel's lightning.
function damageTarget(kind, amount) {
  if (kind === 'player') {
    state.health = Math.max(0, state.health - amount);
    updateHealthDisplay();
    if (state.health <= 0) {
      state.animating = false;
      onGameOver();
    }
  } else if (kind === 'dragon') {
    state.dragon.health = Math.max(0, state.dragon.health - amount);
    updateDragonHealthDisplay();
    if (state.dragon.health <= 0) onDragonDefeated();
  } else if (kind === 'nigel') {
    state.nigel.health = Math.max(0, state.nigel.health - amount);
    updateNigelHealthDisplay();
    if (state.nigel.health <= 0) onNigelDefeated();
  }
}

// Nearest of the dragon/Nigel (whichever are alive) within fireball
// range and line of sight, or null if neither qualifies.
function getFireballTarget() {
  let best = null;
  let bestDist = Infinity;
  for (const t of livingTargetsFor('player')) {
    const d = lineOfSightDistance(state.grid, state.cols, state.rows, state.player, t.pos);
    if (d <= FIREBALL_RANGE && d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

function handleKeyDown(event) {
  if (event.code === 'Space') {
    if (state.animating || state.gameOver) return;
    const target = getFireballTarget();
    if (!target) return; // nothing in range or blocked by a wall
    if (state.mana < 1) return; // out of mana
    event.preventDefault();
    castFireball(target);
    return;
  }

  if (event.code === 'Period') {
    if (state.animating || state.gameOver) return;
    event.preventDefault();
    skipTurn();
    return;
  }

  if (event.key === 'h' || event.key === 'H') {
    if (state.animating || state.gameOver) return;
    if (state.health >= 100 || state.mana < HEAL_MANA_COST) return; // nothing to heal / can't afford — no turn wasted
    event.preventDefault();
    castHeal();
    return;
  }

  const move = KEY_MOVES[event.key];
  if (!move || state.animating) return;

  event.preventDefault(); // stop the page scrolling on arrow keys

  const path = computeMovePath(move.dx, move.dy, move.wall);
  if (path.length <= 1) return; // blocked immediately — nothing to animate

  state.turnEvents = [];
  renderTurnEvents();
  state.animating = true;
  animatePath(path, 0, () => {
    // catch guarantees animating clears even if something above throws, so
    // a broken level transition can't permanently lock out input.
    try {
      checkTrap();
      if (state.gameOver) {
        state.animating = false;
        return;
      }
      if (state.player.x === state.exit.x && state.player.y === state.exit.y) {
        // Reaching the exit pre-empts the dragon's turn for this move — no
        // free reprisal on the winning step.
        state.animating = false;
        onLevelComplete();
        return;
      }
      resolveMobTurns(() => {
        state.animating = false;
      });
    } catch (err) {
      state.animating = false;
      throw err;
    }
  });
}

// Fires a fireball at `target` (the dragon or Nigel); consumes one
// player move and 1 mana, same as an arrow-key move, and shares the same
// mob-turn resolution.
function castFireball(target) {
  state.turnEvents = [];
  renderTurnEvents();
  state.mana -= 1;
  updateManaDisplay();
  state.animating = true;

  // Cast roll: 3d6 over 6 to successfully get the spell off at all.
  if (roll3d6() <= 6) {
    logEvent('Your fireball fizzles!');
    resolveMobTurns(() => {
      state.animating = false;
    });
    return;
  }

  const from = { x: state.player.x, y: state.player.y };
  const to = { x: target.pos.x, y: target.pos.y };

  startFireballAnimation(from, to, () => {
    applyFireballDamage(target.kind);
    resolveMobTurns(() => {
      state.animating = false;
    });
  });
}

// Passes the player's turn with no action — lets the mobs act (approach,
// attack) without the player moving or attacking.
function skipTurn() {
  state.turnEvents = [];
  renderTurnEvents();
  logEvent('You rest a moment.');
  state.animating = true;
  resolveMobTurns(() => {
    state.animating = false;
  });
}

// Heals the player for up to 20% of max health, capped at 100; costs 5 mana
// and consumes one player turn, same as fireball/skip/move.
function castHeal() {
  state.turnEvents = [];
  renderTurnEvents();
  state.animating = true;
  state.mana -= HEAL_MANA_COST;
  state.health = Math.min(100, state.health + HEAL_AMOUNT);
  updateManaDisplay();
  updateHealthDisplay();
  logEvent(`You healed for ${HEAL_AMOUNT}.`);
  resolveMobTurns(() => {
    state.animating = false;
  });
}

function applyFireballDamage(kind) {
  // Aim roll: 3d6 over 6 to hit.
  if (roll3d6() <= 6) {
    logEvent(describeAttack('Your fireball', kind, 0, false));
    return;
  }
  const damageRoll = roll3d6();
  const crit = damageRoll >= 17;
  const damage = damageRoll * 5 * (crit ? 2 : 1); // 15-90 normal, 30-180 crit
  logEvent(describeAttack('Your fireball', kind, damage, true, crit));
  damageTarget(kind, damage);
}

// Advances the turn counter (which also drives the player's and Nigel's
// mana regen), then gives the dragon and Nigel their turn in sequence.
// All three player actions (move, skip, fireball, heal) route through this
// so every mob turn is accounted for exactly once per player action.
function resolveMobTurns(onDone) {
  state.turnCount += 1;
  if (state.turnCount % 5 === 0 && state.mana < MAX_MANA) {
    state.mana += 1;
    updateManaDisplay();
  }
  const nigel = state.nigel;
  if (nigel && nigel.active && !nigel.defeated && state.turnCount % 5 === 0 && nigel.mana < nigel.maxMana) {
    nigel.mana += 1;
  }
  resolveDragonTurn(() => resolveNigelTurn(onDone));
}

// Resolves the dragon's turn (wake check, then breathe-or-move action) after
// a player action. Fire breath is free and can happen every turn; chasing
// moves at half speed (one step per two player turns) via dragon.moveCounter.
// The dragon will target Nigel as readily as the player — whichever is
// nearer — since it never flees regardless of who it's fighting.
function resolveDragonTurn(onDone) {
  const dragon = state.dragon;
  if (!dragon || dragon.defeated || state.gameOver) {
    onDone();
    return;
  }

  const targets = livingTargetsFor('dragon');
  if (targets.length === 0) {
    onDone();
    return;
  }

  const nearestOf = (fromPos) =>
    targets.reduce((best, t) => {
      const d = gridDistance(fromPos, t.pos);
      return !best || d < best.d ? { t, d } : best;
    }, null);

  if (!dragon.awake) {
    const nearest = nearestOf(dragon.pos);
    if (nearest.d <= dragon.triggerDistance) dragon.awake = true;
  }

  if (!dragon.awake) {
    onDone();
    return;
  }

  let breathTarget = null;
  let breathDist = Infinity;
  for (const t of targets) {
    const d = lineOfSightDistance(state.grid, state.cols, state.rows, dragon.pos, t.pos);
    if (d <= DRAGON_BREATH_RANGE && d < breathDist) {
      breathDist = d;
      breathTarget = t;
    }
  }

  if (breathTarget) {
    const from = { x: dragon.pos.x, y: dragon.pos.y };
    const to = { x: breathTarget.pos.x, y: breathTarget.pos.y };
    startFireBreathAnimation(from, to, () => {
      applyDragonFireDamage(breathTarget.kind);
      if (!state.gameOver) onDone();
    });
  } else {
    dragon.moveCounter += 1;
    if (dragon.moveCounter % 2 === 0) {
      const nearest = nearestOf(dragon.pos);
      const result = bfsFrom(state.grid, state.cols, state.rows, nearest.t.pos);
      const entry = result.get(`${dragon.pos.x},${dragon.pos.y}`);
      if (entry && entry.prev) dragon.pos = entry.prev;
      updateDragonSighting();
      updateNigelSighting();
      render();
    }
    onDone();
  }
}

// Resolves Nigel's turn: cast lightning on the nearest in-range target
// (player or dragon) if he has the mana; otherwise chase a sensed target,
// heal himself when nothing threatens, or wander. At or below half health he
// tries to flee from anything in lightning range instead of engaging — but
// if backed into a dead end with no escape route that increases his distance
// from every threat, he stands and fights rather than uselessly bumping the
// wall.
function resolveNigelTurn(onDone) {
  const nigel = state.nigel;
  if (!nigel.active && !nigel.defeated && state.turnCount >= NIGEL_SPAWN_DELAY_TURNS) {
    nigel.active = true; // materialises at the maze entrance, spawnNigel's default pos
  }

  if (!nigel.active || nigel.defeated || state.gameOver) {
    onDone();
    return;
  }

  const targets = livingTargetsFor('nigel');
  if (targets.length === 0) {
    onDone();
    return;
  }

  let nearestInRange = null;
  let nearestInRangeDist = Infinity;
  for (const t of targets) {
    const d = lineOfSightDistance(state.grid, state.cols, state.rows, nigel.pos, t.pos);
    if (d <= NIGEL_LIGHTNING_RANGE && d < nearestInRangeDist) {
      nearestInRangeDist = d;
      nearestInRange = t;
    }
  }

  const lowHealth = nigel.health <= nigel.maxHealth * NIGEL_FLEE_RATIO;

  if (lowHealth && nearestInRange) {
    const neighbours = getOpenNeighbours(state.grid, nigel.pos.x, nigel.pos.y, state.cols, state.rows);
    const minDistFrom = (pos) => Math.min(...targets.map((t) => gridDistance(pos, t.pos)));
    const currentDist = minDistFrom(nigel.pos);

    let fleeTo = null;
    let fleeDist = currentDist;
    for (const n of neighbours) {
      const d = minDistFrom(n);
      if (d > fleeDist) {
        fleeDist = d;
        fleeTo = n;
      }
    }

    if (fleeTo) {
      const wasSighted = nigel.sighted;
      nigel.pos = fleeTo;
      updateNigelSighting();
      if (wasSighted) logEvent(`${nigelName(nigel)} flees!`); // don't double up with the detection message on first sighting
      render();
      onDone();
      return;
    }

    // Cornered — no escape improves his distance, so he fights instead.
    if (nigel.mana >= NIGEL_SPELL_COST) {
      castNigelLightning(nearestInRange, onDone);
      return;
    }
    onDone();
    return;
  }

  if (!lowHealth) {
    if (nearestInRange && nigel.mana >= NIGEL_SPELL_COST) {
      castNigelLightning(nearestInRange, onDone);
      return;
    }

    let nearestSensed = null;
    let nearestSensedDist = Infinity;
    for (const t of targets) {
      const d = gridDistance(nigel.pos, t.pos);
      if (d <= NIGEL_SENSE_RADIUS && d < nearestSensedDist) {
        nearestSensedDist = d;
        nearestSensed = t;
      }
    }

    if (nearestSensed) {
      const result = bfsFrom(state.grid, state.cols, state.rows, nearestSensed.pos);
      const entry = result.get(`${nigel.pos.x},${nigel.pos.y}`);
      if (entry && entry.prev) nigel.pos = entry.prev;
      updateNigelSighting();
      render();
      onDone();
      return;
    }
  }

  // Nothing in range or sensed (or low health with nothing threatening): heal
  // up if he can, otherwise wander.
  if (nigel.mana >= NIGEL_SPELL_COST && nigel.health < nigel.maxHealth) {
    castNigelHeal(onDone);
    return;
  }

  wanderNigel();
  onDone();
}

function castNigelLightning(target, onDone) {
  const nigel = state.nigel;
  nigel.mana -= NIGEL_SPELL_COST;

  // Cast roll: 3d6 over 6 to successfully get the spell off at all.
  if (roll3d6() <= 6) {
    logEvent(`${nigelName(nigel)}'s lightning fizzles!`);
    onDone();
    return;
  }

  const from = { x: nigel.pos.x, y: nigel.pos.y };
  const to = { x: target.pos.x, y: target.pos.y };

  startLightningAnimation(from, to, () => {
    // Aim roll: 3d6 over 6 to hit.
    if (roll3d6() <= 6) {
      logEvent(describeAttack(`${nigelName(nigel)}'s lightning`, target.kind, 0, false));
      if (!state.gameOver) onDone();
      return;
    }
    const damageRoll = roll3d6();
    const crit = damageRoll >= 17;
    const damage = damageRoll * 2 * (crit ? 2 : 1); // 6-36 normal, 12-72 crit
    logEvent(describeAttack(`${nigelName(nigel)}'s lightning`, target.kind, damage, true, crit));
    damageTarget(target.kind, damage);
    if (!state.gameOver) onDone();
  });
}

function castNigelHeal(onDone) {
  const nigel = state.nigel;
  nigel.mana -= NIGEL_SPELL_COST;
  nigel.health = Math.min(nigel.maxHealth, nigel.health + NIGEL_HEAL_AMOUNT);
  updateNigelHealthDisplay();
  if (nigel.sighted) logEvent(`${nigelName(nigel)} heals himself.`);
  startHealFxAnimation({ x: nigel.pos.x, y: nigel.pos.y }, onDone);
}

function wanderNigel() {
  const nigel = state.nigel;
  const neighbours = getOpenNeighbours(state.grid, nigel.pos.x, nigel.pos.y, state.cols, state.rows);
  if (neighbours.length === 0) return;
  nigel.pos = neighbours[Math.floor(Math.random() * neighbours.length)];
  updateNigelSighting();
  render();
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
  logEvent(`You triggered a trap for ${damage}!`);

  if (state.health <= 0) {
    state.animating = false;
    onGameOver();
  }
}

// Dragon breath isn't a spell, so there's no cast roll — just an aim roll
// then a damage roll.
function applyDragonFireDamage(kind) {
  if (roll3d6() <= 6) {
    logEvent(describeAttack("The dragon's fire breath", kind, 0, false));
    return;
  }
  const damageRoll = roll3d6();
  const crit = damageRoll >= 17;
  const damage = damageRoll * 3 * (crit ? 2 : 1); // 9-54 normal, 18-108 crit
  logEvent(describeAttack("The dragon's fire breath", kind, damage, true, crit));
  damageTarget(kind, damage);
}

// Just removes the threat — no reward, no bonus. Reaching the exit remains
// the only win condition.
function onDragonDefeated() {
  const dragon = state.dragon;
  dragon.defeated = true;
  dragon.fireBreath = null;
  updateDragonHealthDisplay();
  logEvent('The dragon is slain!');
}

function onNigelDefeated() {
  const nigel = state.nigel;
  nigel.defeated = true;
  nigel.lightningBolt = null;
  nigel.healFx = null;
  updateNigelHealthDisplay();
  logEvent(nigel.isLich ? `${nigelName(nigel)} is banished!` : `${nigelName(nigel)} is slain!`);
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
  state.mana = MAX_MANA;
  state.turnCount = 0;
  state.nigelIsLich = false;
  state.gameOver = false;
  startLevel(1);
  render();
  window.removeEventListener('keydown', handleKeyDown);
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

// Player always starts top-left; exit picks one of the other 3 corners at random.
function pickRandomExitCorner(cols, rows) {
  const corners = [
    { x: cols - 1, y: 0 },
    { x: 0, y: rows - 1 },
    { x: cols - 1, y: rows - 1 },
  ];
  return corners[Math.floor(Math.random() * corners.length)];
}

function startLevel(level) {
  state.level = level;
  state.cols = STARTING_SIZE + (level - 1) * SIZE_GROWTH_PER_LEVEL;
  state.rows = STARTING_SIZE + (level - 1) * SIZE_GROWTH_PER_LEVEL;
  state.grid = generateMaze(state.cols, state.rows);
  state.player = { x: 0, y: 0 }; // fixed start: top-left
  state.displayPlayer = { x: 0, y: 0 };
  state.exit = pickRandomExitCorner(state.cols, state.rows);
  state.fogRadius = getFogRadius(level);
  state.traps = placeTraps(state.grid, state.cols, state.rows, state.exit);
  state.dragon = spawnDragon(state.grid, state.cols, state.rows, state.exit, state.traps, level);
  if (state.nigel && state.nigel.defeated) state.nigelIsLich = true;
  state.nigel = spawnNigel(state.nigelIsLich);
  state.turnCount = 0;
  updateDragonSighting();
}

startLevel(1);
render();
