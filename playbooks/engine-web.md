# Web playbook (HTML5 / mobile web)
Default stack: vanilla JS + Canvas for jams; Phaser 3 / Three.js / PixiJS via npm + Vite for bigger games.
- Scaffold: `npm create vite@latest <name> -- --template vanilla` (or plain `index.html` for jams). Free MIT deps < 500 MB need no approval.
- Run: `npx vite --port 5173` in background → open in built-in browser pane (`preview_start` url) for screenshots/playtest.
- Mobile: viewport meta, touch input, portrait + landscape; test with browser pane `resize_window` preset mobile.
- Build: `npx vite build` → copy `dist/` to `Builds/Web/<version>/`.
- QA: browser pane `read_console_messages` (must be error-free) + screenshots; Playwright if installed.
- ES modules need http, not `file://`: serve with `python -m http.server <port> --directory Game` (no download needed; `npx http-server` downloads a package).
- Keep simulation DOM-free so `node tests/smoke.mjs` can step whole nights headless and deterministic (seeded rng).
- **Shared browser pane**: Boss and other workers use it too. Each worker: own server port (Producer assigns unique ports; never touch Boss's playtest port), own tab via `tabs_create`, pass `tabId` on EVERY call, close tab at end.
- Browser pane hidden ⇒ `requestAnimationFrame` doesn't fire (loop frozen, no events, no audio). Fix: `resize_window` (wakes rendering), or drive modules from console: `stepGame(game, sampleInput(input, 1/60), 1/60)` (+ playEvents/updateAudio) in a loop, then draw + screenshot. Expose `window.__<game>` for state pokes.
- Pane quirks: check `innerWidth` before labelling a screenshot desktop/mobile (pane may itself be narrow); navigate explicitly to `http://127.0.0.1:<port>/index.html` instead of `location.reload()`; set up scene + capture in ONE synchronous `javascript_exec` so the live loop can't advance between calls.
- Saving pane screenshots to files: run a tiny node POST receiver on localhost and `fetch(url,{method:'POST',mode:'no-cors',body:canvas.toDataURL()})` from the page.
- Synthetic touch: dispatch PointerEvents with `pointerId: 1, pointerType: 'touch'` (other ids make `setPointerCapture` throw).
- Store wrappers (Capacitor/Electron) only if TDD calls for them.
