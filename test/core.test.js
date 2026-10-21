import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContextAsyncStorage } from '../src/index.js';

/**
 * Helper: turn a possibly-rejected result (from assert.doesNotReject) into a
 * simpler assertion shape for our own expectations.
 */
async function resolvesTo(promise, expected) {
  const v = await promise;
  assert.deepEqual(v, expected);
  return v;
}

test('get/set/run basic round-trip', () => {
  const ctx = new ContextAsyncStorage();
  let seen;
  ctx.run({}, () => {
    ctx.set('k', 1);
    seen = ctx.get('k');
  });
  assert.equal(seen, 1);
});

test('run accepts a plain object as initial context', () => {
  const ctx = new ContextAsyncStorage();
  ctx.run({ a: 'x', b: 'y' }, () => {
    assert.equal(ctx.get('a'), 'x');
    assert.equal(ctx.get('b'), 'y');
  });
});

test('run accepts a Map as initial context', () => {
  const ctx = new ContextAsyncStorage();
  ctx.run(new Map([['a', 1]]), () => {
    assert.equal(ctx.get('a'), 1);
  });
});

test('run can be called with just a function', () => {
  const ctx = new ContextAsyncStorage();
  ctx.run(() => {
    ctx.set('only', 42);
    assert.equal(ctx.get('only'), 42);
  });
});

test('run forwards extra arguments to fn', () => {
  const ctx = new ContextAsyncStorage();
  let got;
  ctx.run({}, (x, y) => {
    got = x + y;
  }, 2, 3);
  assert.equal(got, 5);
});

test('run returns the fn return value (sync)', () => {
  const ctx = new ContextAsyncStorage();
  const out = ctx.run({}, () => 7);
  assert.equal(out, 7);
});

test('run returns the resolved value when fn is async', async () => {
  const ctx = new ContextAsyncStorage();
  const out = await ctx.run({}, async () => 'hello');
  assert.equal(out, 'hello');
});

test('context survives across awaited continuations', async () => {
  const ctx = new ContextAsyncStorage();
  await ctx.run({ traceId: 'abc' }, async () => {
    ctx.set('phase', 'work');
    // Yield once; the continuation must still see the store.
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(ctx.get('traceId'), 'abc');
    assert.equal(ctx.get('phase'), 'work');
  });
});

test('set returns false when no context is active', () => {
  const ctx = new ContextAsyncStorage();
  assert.equal(ctx.set('x', 1), false);
  assert.equal(ctx.get('x'), undefined);
});

test('get returns undefined when no context is active', () => {
  const ctx = new ContextAsyncStorage();
  assert.equal(ctx.get('nope'), undefined);
});

test('mutations inside run do not leak to the caller', () => {
  const ctx = new ContextAsyncStorage();
  ctx.run({ outer: 1 }, () => {
    ctx.set('inner', 2);
    assert.equal(ctx.get('inner'), 2);
  });
  assert.equal(ctx.hasActiveContext(), false);
});

test('nested runs inherit but do not pollute the parent context', () => {
  const ctx = new ContextAsyncStorage();
  ctx.run({ outer: 1 }, () => {
    assert.equal(ctx.get('outer'), 1);
    ctx.run({ inner: 2 }, () => {
      assert.equal(ctx.get('outer'), 1, 'inherited from parent');
      assert.equal(ctx.get('inner'), 2);
      ctx.set('inner', 99);
      assert.equal(ctx.get('inner'), 99);
    });
    assert.equal(ctx.get('inner'), undefined, 'nested mutation did not leak');
    assert.equal(ctx.get('outer'), 1);
  });
});

test('initial context object is not mutated by the storage', () => {
  const ctx = new ContextAsyncStorage();
  const seed = { a: 1 };
  ctx.run(seed, () => {
    ctx.set('b', 2);
    assert.equal(ctx.get('a'), 1);
    assert.equal(ctx.get('b'), 2);
  });
  assert.equal(seed.a, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(seed, 'b'), false);
});

test('set overwrites an existing key', () => {
  const ctx = new ContextAsyncStorage();
  ctx.run({ k: 'a' }, () => {
    assert.equal(ctx.get('k'), 'a');
    assert.equal(ctx.set('k', 'b'), true);
    assert.equal(ctx.get('k'), 'b');
  });
});

test('snapshot returns a plain object copy of the active context', () => {
  const ctx = new ContextAsyncStorage();
  ctx.run({ a: 1, b: 2 }, () => {
    const snap = ctx.snapshot();
    assert.deepEqual(snap, { a: 1, b: 2 });
    // Mutating the snapshot must not affect the live store.
    snap.a = 999;
    assert.equal(ctx.get('a'), 1);
  });
});

test('snapshot returns empty object when no context is active', () => {
  const ctx = new ContextAsyncStorage();
  assert.deepEqual(ctx.snapshot(), {});
});

test('concurrent async chains keep independent contexts', async () => {
  const ctx = new ContextAsyncStorage();
  let resolveA, resolveB;
  const a = new Promise((r) => { resolveA = r; });
  const b = new Promise((r) => { resolveB = r; });

  const runA = ctx.run({ id: 'A' }, async () => {
    ctx.set('phase', 'a-start');
    await a; // yield
    assert.equal(ctx.get('id'), 'A');
    assert.equal(ctx.get('phase'), 'a-start');
  });

  const runB = ctx.run({ id: 'B' }, async () => {
    ctx.set('phase', 'b-start');
    await b; // yield
    assert.equal(ctx.get('id'), 'B');
    assert.equal(ctx.get('phase'), 'b-start');
  });

  // Resolve in interleaved order to make sure continuations land back on the
  // right frame.
  setImmediate(() => resolveA());
  setImmediate(() => resolveB());

  await Promise.all([runA, runB]);
});

test('get with missing key returns undefined even inside a context', () => {
  const ctx = new ContextAsyncStorage();
  ctx.run({ present: 1 }, () => {
    assert.equal(ctx.get('absent'), undefined);
  });
});

test('hasActiveContext reflects run boundaries', () => {
  const ctx = new ContextAsyncStorage();
  assert.equal(ctx.hasActiveContext(), false);
  ctx.run({}, () => {
    assert.equal(ctx.hasActiveContext(), true);
  });
  assert.equal(ctx.hasActiveContext(), false);
});

test('empty initial context object works', () => {
  const ctx = new ContextAsyncStorage();
  ctx.run({}, () => {
    assert.equal(ctx.set('late', 1), true);
    assert.equal(ctx.get('late'), 1);
  });
});
