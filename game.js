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

/**
 * Sizes the canvas and redraws everything. Called on state changes only —
 * this isn't an animation loop, so there's no per-frame redraw.
 */
function render() {
  canvas.width = MAX_CANVAS_SIZE;
  canvas.height = MAX_CANVAS_SIZE;
  levelDisplay.textContent = `Level ${state.level}`;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function startLevel(level) {
  state.level = level;
  state.cols = 8;
  state.rows = 8;
  state.grid = generateMaze(state.cols, state.rows);
}

startLevel(1);
render();
