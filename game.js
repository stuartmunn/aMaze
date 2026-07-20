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
};

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

render();
