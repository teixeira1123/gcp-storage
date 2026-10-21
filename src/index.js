/**
 * gcp-storage
 *
 * A minimal wrapper around Node.js AsyncLocalStorage that exposes a map-like
 * context object across async continuations. ESM only, zero third-party deps.
 */

export { default as ContextAsyncStorage } from './core.js';
