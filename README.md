# aMaze

A wee browser-based maze game. Navigate a randomly generated maze with the arrow keys — reach the exit and a new, bigger, harder maze begins. No score to save, no backend, just open it up and play.

## Controls

- **Arrow keys** — move up, down, left or right, one cell at a time
- Walls block movement — find your way round them
- Reach the exit (marked, bottom-right) to advance to the next level

## Running it

No install, no build step. Either:

- Open `index.html` directly in a modern desktop browser (Chrome, Firefox, Edge), or
- Right-click `index.html` in VSCode and choose **Open with Live Server** for hot reload while developing

## How it's built

Vanilla JavaScript and HTML5 Canvas, nothing else — no frameworks, no npm, no build tools. Each level generates a fresh perfect maze (recursive backtracker algorithm), growing in size and introducing fog of war as you climb the levels.
