/**
 * A list's version, and the rule that a new one extends the newest
 * published: later, and keeping every resource name, so a link to a list's
 * entry never stops resolving.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertExtends, packageVersionOf } from '../src/contract.js';

test('a version is 1, the source\'s publication day, and the producer\'s revision', () => {
  assert.equal(packageVersionOf('2026-09-17', 0), '1.20260917.0');
  assert.equal(packageVersionOf('2026-09-17', 2), '1.20260917.2');
  assert.throws(() => packageVersionOf('2026-9-17', 0), /YYYY-MM-DD/);
  assert.throws(() => packageVersionOf('2026-09-17', -1), /whole number/);
});

test('a new version extends the newest published one', () => {
  const previous = { version: '1.20260917.0', names: new Set(['en', 'iw', 'region-us']) };
  assertExtends(previous, '1.20261020.0', new Set(['en', 'iw', 'region-us', 'region-xk']));
  assertExtends(previous, '1.20260917.1', new Set(['en', 'iw', 'region-us']));
});

test('a new version that drops a name, or is not later, is refused', () => {
  const previous = { version: '1.20260917.0', names: new Set(['en', 'iw', 'region-us']) };
  assert.throws(() => assertExtends(previous, '1.20261020.0', new Set(['en', 'region-us'])), /drops 1 resource name\(s\) 1\.20260917\.0 has: iw/);
  assert.throws(() => assertExtends(previous, '1.20260917.0', new Set(['en', 'iw', 'region-us'])), /not later than 1\.20260917\.0/);
  assert.throws(() => assertExtends(previous, '1.20260901.0', new Set(['en', 'iw', 'region-us'])), /not later than/);
});
