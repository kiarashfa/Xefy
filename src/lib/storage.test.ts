import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { readNotice, versionedStore } from './storage.ts';

/**
 * Storage is the one dependency these features have that can simply not be
 * there — a private window, disabled cookies, a full quota. Every one of those
 * has to degrade to working-but-not-remembering rather than breaking the page,
 * so each is exercised here rather than assumed. §8.1
 */

type Store = typeof globalThis.localStorage;

const install = (fake: Partial<Store> | undefined) => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: fake,
    configurable: true,
    writable: true,
  });
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

function memoryStorage(): Partial<Store> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

test('a key is namespaced and versioned, and the schema is written with the value', () => {
  const fake = memoryStorage();
  install(fake);
  const store = versionedStore<{ items: number[] }>('plan', 1, 1);

  assert.equal(store.key, 'xefy.plan.v1');
  store.write({ items: [1, 2] });
  assert.deepEqual(JSON.parse(fake.data.get('xefy.plan.v1')!), { schema: 1, items: [1, 2] });
  assert.deepEqual(store.read(), { value: { schema: 1, items: [1, 2] }, status: 'ok' });
});

test('nothing stored reads as empty rather than as a problem', () => {
  install(memoryStorage());
  assert.deepEqual(versionedStore('plan', 1, 1).read(), { value: null, status: 'empty' });
  assert.equal(readNotice('empty'), null);
  assert.equal(readNotice('ok'), null);
});

test('an unknown schema is discarded whole, never half-parsed', () => {
  const fake = memoryStorage();
  install(fake);

  // Written by a future version of this code, with a field this one would read.
  fake.data.set('xefy.plan.v1', JSON.stringify({ schema: 4, items: [{ recipe: 'x' }] }));
  const { value, status } = versionedStore<{ items: unknown[] }>('plan', 1, 1).read();
  assert.equal(value, null);
  assert.equal(status, 'discarded');
  assert.match(readNotice(status)!, /older format/);
});

test('unparseable content is discarded rather than thrown', () => {
  const fake = memoryStorage();
  install(fake);
  fake.data.set('xefy.plan.v1', '{not json');
  assert.equal(versionedStore('plan', 1, 1).read().status, 'discarded');
});

test('storage that throws on every call leaves the feature working', () => {
  const boom = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  install({ getItem: boom, setItem: boom, removeItem: boom });

  const store = versionedStore<{ items: number[] }>('plan', 1, 1);
  assert.deepEqual(store.read(), { value: null, status: 'unavailable' });
  assert.match(readNotice('unavailable')!, /not allowing storage/);
  // Neither of these may throw: a full quota must not break the page.
  assert.doesNotThrow(() => store.write({ items: [1] }));
  assert.doesNotThrow(() => store.clear());
});

test('no storage object at all is the same as one that refuses', () => {
  install(undefined);
  const store = versionedStore<{ items: number[] }>('plan', 1, 1);
  assert.equal(store.read().status, 'unavailable');
  assert.doesNotThrow(() => store.write({ items: [1] }));
});

test('a page rendered with no storage global behaves the same', () => {
  Reflect.deleteProperty(globalThis, 'localStorage');
  const store = versionedStore<{ items: number[] }>('plan', 1, 1);
  assert.equal(store.read().status, 'unavailable');
  assert.doesNotThrow(() => store.write({ items: [1] }));
});
