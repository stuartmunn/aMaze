# aMaze

A wee browser-based maze game. Navigate a randomly generated maze with the arrow keys — reach the exit and a new, bigger, harder maze begins. No score to save, no backend, just open it up and play.

**[Play it here](https://stuartmunn.github.io/aMaze/)**

## Controls

- **Arrow keys** or **WASD** — move up, down, left or right, one cell at a time
- Walls block movement — find your way round them
- Reach the exit (marked, bottom-right) to advance to the next level

## Running it

No install, no build step. Either:

- Open `index.html` directly in a modern desktop browser (Chrome, Firefox, Edge), or
- Right-click `index.html` in VSCode and choose **Open with Live Server** for hot reload while developing

## How it's built

Vanilla JavaScript and HTML5 Canvas, nothing else — no frameworks, no npm, no build tools. Each level generates a fresh perfect maze (recursive backtracker algorithm), growing in size and introducing fog of war as you climb the levels. From level 6 onward, watch out for a stalking dragon.

Hosted on GitHub Pages, served straight from `main` — every push updates the live version automatically.
