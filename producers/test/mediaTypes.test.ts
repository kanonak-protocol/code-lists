/**
 * The sample keeps one or more records per top-level type (and the empty
 * `example` registry), the three annotation forms IANA uses for retired
 * types — `(OBSOLETED in favor of text/javascript)`, `- DEPRECATED in favor
 * of font/woff`, `(OBSOLETE)` — with their successors present, a `+xml`
 * subtype, a `vnd.` subtype with dots, and records with and without dates.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapshotOf } from '../src/contract.js';
import { mediaTypes } from '../src/lists/mediaTypes.js';
import { fixture, standardTests } from './harness.js';

const producer = standardTests(mediaTypes, { registry: 'media-types.sample.xml' }, 'media-types.sample.golden.yml', {
  sourceVersion: '2026-09-22',
  version: '1.20260922.0',
});

test('media-types: a successor the registry does not hold is an error, not a dropped fact', async () => {
  const xml = readFileSync(fixture('media-types.sample.xml'), 'utf8').replace('in favor of text/javascript', 'in favor of text/ecmascript');
  await assert.rejects(producer.project({ registry: snapshotOf(mediaTypes.sources[0]!, xml) }), /text\/ecmascript, which the registry does not hold/);
});
