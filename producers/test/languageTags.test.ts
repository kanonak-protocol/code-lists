/**
 * The sample covers every registry type, repeated descriptions, a
 * continuation line, deprecation with a registered preferred value
 * (`iw`→`he`, `BU`→`MM`), preferred values that are composed tags
 * (`en-GB-oed`→`en-GB-oxendict`, `zh-cmn-Hans`→`cmn-Hans`), an extlang whose
 * preferred value is the language of the same code, numeric region and
 * variant codes, a YAML-boolean-looking subtag (`no`), and a private-use
 * range that must be excluded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapshotOf } from '../src/contract.js';
import { languageTags } from '../src/lists/languageTags.js';
import { fixture, standardTests } from './harness.js';

const producer = standardTests(languageTags, { registry: 'language-subtag-registry.sample.txt' }, 'language-tags.sample.golden.yml', {
  sourceVersion: '2026-09-17',
  version: '2026.9.17',
});

test('language-tags: an unknown registry field fails the projection instead of being dropped', async () => {
  const sample = readFileSync(fixture('language-subtag-registry.sample.txt'), 'utf8');
  const mutated = sample.replace('Added: 2005-07-15\n', 'Added: 2005-07-15\nNew-Field: x\n');
  await assert.rejects(producer.project({ registry: snapshotOf(languageTags.sources[0]!, mutated) }), /unknown registry field New-Field/);
});
