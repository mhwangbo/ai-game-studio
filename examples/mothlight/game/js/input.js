// @ts-check
/**
 * input.js [DOM]: mouse, touch and keyboard, all turned into one InputFrame.
 * Pointer events unify mouse and touch. The whole element is the touch target.
 * Keyboard: arrows/WASD move a virtual cursor, Space/Enter hold the glow.
 * Owner: gameplay-1 (scaffolded by tl-1). Rules: GDD L1-L3, §6 Controls.
 */

const MOVE_KEYS = Object.freeze({
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
});
const GLOW_KEYS = Object.freeze(new Set(['Space', 'Enter']));

/**
 * @typedef {{ touchOffsetY: number, keySpeed: number, width: number, height: number }} InputOptions
 */

/**
 * Attaches listeners to `element`.
 * @param {HTMLElement} element
 * @param {(clientX: number, clientY: number) => { x: number, y: number }} toLogical
 * @param {InputOptions} options
 * @returns {any} Input handle
 */
export function createInput(element, toLogical, options) {
  const input = {
    element,
    options,
    x: options.width / 2,
    y: options.height / 2,
    hasPointer: false,
    pointerHeld: false,
    keysHeld: new Set(),
    wasHeld: false,
    pressedEdge: false,
    releasedEdge: false,
    /** @type {[string, EventListener, EventTarget][]} */
    listeners: [],
  };

  const setPointer = (/** @type {PointerEvent} */ e) => {
    const p = toLogical(e.clientX, e.clientY);
    // L2: on touch the target sits above the finger so the finger doesn't hide the lantern.
    const offsetY = e.pointerType === 'touch' ? options.touchOffsetY : 0;
    input.x = p.x;
    input.y = p.y + offsetY;
    input.hasPointer = true;
  };
  const onPointerDown = (/** @type {PointerEvent} */ e) => {
    e.preventDefault();
    // JAM-12: setPointerCapture can throw (NotFoundError) when the pointer is
    // already inactive, e.g. a synthetic touch event in QA. That must not
    // abort the handler: held/position still need to be set below.
    try {
      element.setPointerCapture?.(e.pointerId);
    } catch (err) {
      console.warn('[mothlight] setPointerCapture failed', err);
    }
    setPointer(e);
    input.pointerHeld = true;
    syncHeld(input);
  };
  const onPointerMove = (/** @type {PointerEvent} */ e) => setPointer(e);
  const onPointerUp = () => {
    input.pointerHeld = false;
    syncHeld(input);
  };
  const onKeyDown = (/** @type {KeyboardEvent} */ e) => {
    if (!(e.code in MOVE_KEYS) && !GLOW_KEYS.has(e.code)) return;
    e.preventDefault();
    input.keysHeld.add(e.code);
    input.hasPointer = true;
    syncHeld(input);
  };
  const onKeyUp = (/** @type {KeyboardEvent} */ e) => {
    input.keysHeld.delete(e.code);
    syncHeld(input);
  };
  const onBlur = () => {
    input.pointerHeld = false;
    input.keysHeld.clear();
    syncHeld(input);
  };

  listen(input, element, 'pointerdown', onPointerDown);
  listen(input, element, 'pointermove', onPointerMove);
  listen(input, element, 'pointerup', onPointerUp);
  listen(input, element, 'pointercancel', onPointerUp);
  listen(input, element, 'contextmenu', (e) => e.preventDefault());
  listen(input, window, 'keydown', onKeyDown);
  listen(input, window, 'keyup', onKeyUp);
  listen(input, window, 'blur', onBlur);
  return input;
}

/**
 * Returns the current frame and consumes the pressed/released edges.
 * @param {any} input
 * @param {number} [dt]  seconds, advances the keyboard virtual cursor
 * @returns {import('./state.js').InputFrame}
 */
export function sampleInput(input, dt = 0) {
  moveWithKeys(input, dt);
  const frame = {
    x: input.x,
    y: input.y,
    held: isHeld(input),
    pressed: input.pressedEdge,
    released: input.releasedEdge,
    hasPointer: input.hasPointer,
  };
  input.pressedEdge = false;
  input.releasedEdge = false;
  return frame;
}

/**
 * Removes every listener.
 * @param {any} input
 * @returns {void}
 */
export function destroyInput(input) {
  for (const [type, handler, target] of input.listeners) target.removeEventListener(type, handler);
  input.listeners.length = 0;
}

// ---------------------------------------------------------------- private

function listen(input, target, type, handler) {
  const options = type.startsWith('pointer') ? { passive: false } : undefined;
  target.addEventListener(type, handler, options);
  input.listeners.push([type, handler, target]);
}

function isHeld(input) {
  if (input.pointerHeld) return true;
  for (const code of input.keysHeld) if (GLOW_KEYS.has(code)) return true;
  return false;
}

/** Records edges when the held state changes so a quick tap between frames is not lost. */
function syncHeld(input) {
  const held = isHeld(input);
  if (held && !input.wasHeld) input.pressedEdge = true;
  if (!held && input.wasHeld) input.releasedEdge = true;
  input.wasHeld = held;
}

function moveWithKeys(input, dt) {
  let dx = 0;
  let dy = 0;
  for (const code of input.keysHeld) {
    const dir = MOVE_KEYS[/** @type {keyof typeof MOVE_KEYS} */ (code)];
    if (dir) { dx += dir[0]; dy += dir[1]; }
  }
  if (dx === 0 && dy === 0) return;
  const len = Math.hypot(dx, dy);
  const step = input.options.keySpeed * dt;
  input.x = Math.min(input.options.width, Math.max(0, input.x + (dx / len) * step));
  input.y = Math.min(input.options.height, Math.max(0, input.y + (dy / len) * step));
}
