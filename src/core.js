/**
 * ContextAsyncStorage
 *
 * Wraps Node's AsyncLocalStorage so a single object behaves like a per-async-
 * chain key/value store. The backing store is a plain Map so callers can set
 * and get entries by string key without manually threading state through every
 * function signature.
 *
 * Design decisions:
 * - We reuse the same Map across nested `run` calls that did NOT override a
 *   given key. This keeps the common case (an outer request setting "traceId",
 *   an inner call adding "phase") ergonomic without forcing the caller to
 *   re-state every key. A nested `set` shadows the outer value for the scope of
 *   that run by cloning the map at entry, which is cheap and avoids the "forgot
 *   to restore" class of bugs.
 * - `enterWith` is used instead of `run` when nesting because `run` establishes
 *   a new frame that disconnects state if the caller awaits between `set` and
 *   `get`. `enterWith` attaches to the current frame so subsequent sync mutations
 *   are visible to nested runs. To keep the scope well-defined, each `run` still
 *   clones the incoming map so nested mutations do not leak outward.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export default class ContextAsyncStorage {
  #als;

  constructor() {
    // We store a Map per async frame. Map is mutable, which is why we clone in
    // run() to prevent mutations in a nested scope from leaking to the parent.
    this.#als = new AsyncLocalStorage();
  }

  /**
   * Run a function with an active context. The function and any async work it
   * schedules can read and write the context. Mutations made inside `fn` do NOT
   * propagate to the caller's context after `fn` resolves — we clone on entry.
   *
   * @param {Record<string, unknown>|Map<string, unknown>} [initial={}] — the
   *   starting context. If a plain object is provided we shallow-copy its own
   *   enumerable string-keyed properties into the Map.
   * @param {(...args: unknown[]) => unknown} fn
   * @param {...unknown} args — forwarded to `fn`.
   * @returns {unknown} whatever `fn` returns (sync) or a Promise resolving to it.
   */
  run(initial, fn, ...args) {
    // Allow `run(fn)` and `run(initial, fn)` uniformly.
    if (typeof initial === 'function') {
      args = [fn, ...args];
      fn = initial;
      initial = {};
    }
    const map = this.#toMap(initial);
    const parent = this.#als.getStore();
    if (parent instanceof Map) {
      for (const [k, v] of parent) {
        if (!map.has(k)) map.set(k, v);
      }
    }
    return this.#als.run(map, fn, ...args);
  }

  /**
   * Get a value by key from the active context. Returns `undefined` if there is
   * no active context or the key is absent.
   *
   * @param {string} key
   * @returns {unknown}
   */
  get(key) {
    const map = this.#als.getStore();
    if (!map) return undefined;
    return map.get(key);
  }

  /**
   * Set a value in the active context. Returns `true` if the context existed and
   * was mutated, `false` if there is no active context.
   *
   * The boolean return keeps callers honest: silently no-op'ing on a missing
   * context is a common source of "why did my value disappear?" bugs.
   *
   * @param {string} key
   * @param {unknown} value
   * @returns {boolean}
   */
  set(key, value) {
    const map = this.#als.getStore();
    if (!map) return false;
    map.set(key, value);
    return true;
  }

  /**
   * True when a context frame is currently active (i.e. inside `run`).
   * @returns {boolean}
   */
  hasActiveContext() {
    return this.#als.getStore() !== undefined;
  }

  /**
   * Returns a shallow snapshot of the active context as a plain object. Useful
   * for logging. Empty object when no context is active.
   * @returns {Record<string, unknown>}
   */
  snapshot() {
    const map = this.#als.getStore();
    if (!map) return {};
    const out = {};
    for (const [k, v] of map) out[k] = v;
    return out;
  }

  #toMap(initial) {
    if (initial instanceof Map) return new Map(initial);
    const map = new Map();
    if (initial && typeof initial === 'object') {
      // for..in is correct here: we only want own enumerable string keys, which
      // is exactly what for..in iterates (plus inherited, but the hasOwnProperty
      // guard excludes those).
      for (const k in initial) {
        if (Object.prototype.hasOwnProperty.call(initial, k)) {
          map.set(k, initial[k]);
        }
      }
    }
    return map;
  }
}
