// @ts-check
/**
 * rng.js [PURE]: seeded PRNG (mulberry32), so gardens and tests are reproducible.
 * Owner: tech-lead (tl-1). Shared contract.
 */

const UINT32 = 4294967296;

/**
 * @typedef {Object} Rng
 * @property {number} seed
 * @property {() => number} next              uniform [0, 1)
 * @property {(min: number, max: number) => number} range   uniform [min, max)
 * @property {(min: number, max: number) => number} int     uniform integer [min, max]
 * @property {<T>(items: T[]) => T} pick
 * @property {(p: number) => boolean} chance
 * @property {(pair: number[]) => number} between         range(pair[0], pair[1])
 */

/**
 * Creates a deterministic generator. The same seed always yields the same sequence.
 * @param {number} seed
 * @returns {Rng}
 */
export function createRng(seed) {
  let state = (seed >>> 0) || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
  const range = (min, max) => min + (max - min) * next();
  return {
    seed: seed >>> 0,
    next,
    range,
    int: (min, max) => Math.floor(range(min, max + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    between: (pair) => range(pair[0], pair[1]),
  };
}

/**
 * Non-deterministic seed for a fresh night. The only impure function in the
 * PURE set (whitelisted by the smoke test).
 * @returns {number}
 */
export function randomSeed() {
  return (Math.floor(Math.random() * UINT32) ^ Date.now()) >>> 0;
}
