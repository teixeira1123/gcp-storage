# gcp-storage

A minimal wrapper around Node.js `AsyncLocalStorage` that exposes a per-async-chain key/value context with `get`, `set`, and `run` methods. Zero third-party dependencies, ESM only.

## Usage

```js
import { ContextAsyncStorage } from 'gcp-storage';

const ctx = new ContextAsyncStorage();

await ctx.run({ traceId: 'req-123' }, async () => {
  ctx.set('phase', 'handler');
  await Promise.resolve();
  console.log(ctx.get('traceId'), ctx.get('phase')); // 'req-123' 'handler'
});
```

Exported names: `ContextAsyncStorage` (default-named class, exported as a named export).

## Why this exists

The need is small but specific: many request handlers want to attach a handful of values (trace id, user id, request phase) to the current async chain without threading a `context` object through every function signature. Node's `AsyncLocalStorage` does exactly this, but its raw API returns `undefined` outside a run and offers no map-shaped sugar. This library wraps it so callers get `get(key)`, `set(key, value)`, and a `run(initial, fn)` that copies the initial context into a `Map`.

The trade-off: we clone the context `Map` at the boundary of each `run` call so mutations inside a nested `run` do not leak outward. That is a deliberate choice — silent leakage of state between scopes is the classic bug in this pattern, and an extra `Map` allocation per `run` is the cost of avoiding it. If you are sensitive to allocations in a hot path, do not nest `run` calls.

## The awkward edge

`set` returns `false` (rather than throwing) when no context is active. This is intentional — it lets code that is sometimes called outside a `run` degrade gracefully — but it also means a typo in a key name, or calling `set` from a callback that ran after the `run` frame finished, will silently do nothing. If you need to be certain your writes land, check the boolean. `get` similarly returns `undefined` both for a missing key and for "no active context"; use `hasActiveContext()` to distinguish when it matters.

## Running the tests

```
node --test
`
