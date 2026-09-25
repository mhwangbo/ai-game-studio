// @ts-check
/**
 * events.js [PURE]: simulation event types. The sim pushes events into
 * game.events each tick, and audio/ui/main react to them (read-only).
 * Owner: tech-lead (tl-1). Shared contract. Payloads are documented in TDD.md "Events".
 */

export const EVENT = Object.freeze({
  NIGHT_START: 'night_start',
  NIGHT_END: 'night_end',
  MOTH_SPAWNED: 'moth_spawned',
  MOTH_JOINED: 'moth_joined',
  MOTH_SINGED: 'moth_singed',
  MOTH_DELIVERED: 'moth_delivered',
  MOTH_ZAPPED: 'moth_zapped',
  MOTH_CANDLED: 'moth_candled',
  MOTH_LOST: 'moth_lost',
  COMBO_END: 'combo_end',
  LIGHT_ON: 'light_on',
});

/**
 * @typedef {{ type: string } & Record<string, any>} GameEvent
 */

/**
 * Appends an event to the current tick's event list.
 * @param {GameEvent[]} events
 * @param {string} type  one of EVENT.*
 * @param {Record<string, any>} [payload]
 * @returns {void}
 */
export function emit(events, type, payload = {}) {
  events.push({ type, ...payload });
}
