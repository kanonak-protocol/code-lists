/**
 * The sample keeps the edge cases: `+` in an identifier (`GPL-2.0+`),
 * digit-leading identifiers (`0BSD`, `3D-Slicer-1.0`, `389-exception`),
 * deprecated identifiers, licences with and without `isFsfLibre`, and
 * exceptions alongside licences.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapshotOf } from '../src/contract.js';
import { spdxLicenses } from '../src/lists/spdxLicenses.js';
import { fixture, standardTests } from './harness.js';

const files = { licenses: 'spdx-licenses.sample.json', exceptions: 'spdx-exceptions.sample.json' };
const producer = standardTests(spdxLicenses, files, 'spdx-licenses.sample.golden.yml', {
  sourceVersion: '3.29.0',
  version: '1.20260916.0',
});

test('spdx-licenses: two different list versions refuse to combine', async () => {
  const [licenses, exceptions] = spdxLicenses.sources;
  const l = readFileSync(fixture(files.licenses), 'utf8');
  const e = readFileSync(fixture(files.exceptions), 'utf8').replace('"licenseListVersion": "3.29.0"', '"licenseListVersion": "3.28.0"');
  await assert.rejects(producer.project({ licenses: snapshotOf(licenses!, l), exceptions: snapshotOf(exceptions!, e) }), /3\.29\.0 but exceptions\.json at 3\.28\.0/);
});

test('spdx-licenses: an unknown field fails the projection', async () => {
  const [licenses, exceptions] = spdxLicenses.sources;
  const l = readFileSync(fixture(files.licenses), 'utf8').replace('"licenseId": "MIT"', '"licenseId": "MIT", "newField": 1');
  const e = readFileSync(fixture(files.exceptions), 'utf8');
  await assert.rejects(producer.project({ licenses: snapshotOf(licenses!, l), exceptions: snapshotOf(exceptions!, e) }), /unknown license field newField/);
});
