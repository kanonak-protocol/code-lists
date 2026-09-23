/**
 * The language-tags producer over a curated registry sample, pinned to a
 * golden package. The sample covers every registry type, repeated
 * descriptions, a continuation line, deprecation with a registered preferred
 * value (`iw`→`he`, `BU`→`MM`), preferred values that are composed tags
 * (`en-GB-oed`→`en-GB-oxendict`, `zh-cmn-Hans`→`cmn-Hans`), an extlang whose
 * preferred value is the language of the same code, numeric region and
 * variant codes, a YAML-boolean-looking subtag (`no`), and a private-use
 * range that must be excluded.
 *
 * If the golden changes, that is a producer change: review the diff, then
 * regenerate with UPDATE_GOLDEN=1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VersionOperator } from '@kanonak-protocol/types/document/models/enums';
import {
  KanonakParser,
  KanonakObjectValidator,
  PackageBuilder,
  buildLocalFirstRepository,
  createVersion,
  formatVersion,
  ValidationSeverity,
} from '@kanonak-protocol/sdk';
import { CodeListProducer, PUBLISHER, snapshotOf } from '../src/contract.js';
import { languageTags } from '../src/lists/languageTags.js';

const PACKAGES_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SAMPLE = fileURLToPath(new URL('../../test/fixtures/language-subtag-registry.sample.txt', import.meta.url));
const GOLDEN = fileURLToPath(new URL('../../test/fixtures/language-tags.sample.golden.yml', import.meta.url));

const parser = new KanonakParser();
const repository = await buildLocalFirstRepository(PACKAGES_ROOT, parser);
const builder = new PackageBuilder(repository, parser);
const sample = readFileSync(SAMPLE, 'utf8');
const producer = new CodeListProducer(languageTags, builder, parser, async () => snapshotOf(languageTags.sourceUrl, sample));

test('the sample projects to the golden package, byte for byte', async () => {
  const built = await producer.build();
  if (process.env.UPDATE_GOLDEN) writeFileSync(GOLDEN, built.yaml, 'utf8');
  assert.equal(built.sourceVersion, '2026-09-17');
  assert.equal(built.version, '2026.9.17');
  assert.equal(built.yaml, readFileSync(GOLDEN, 'utf8'));
});

test('the projection is deterministic', async () => {
  const built = await producer.build();
  const again = await producer.project(built.snapshot);
  assert.equal(again.yaml, built.yaml);
});

test('the golden validates (vocabularies resolved from kanonak.org) with zero errors', async () => {
  const built = await producer.build();
  const [result] = await new KanonakObjectValidator(parser).validateDocumentsAsync([built.document], repository);
  const errors = result!.result.errors.filter((e) => e.severity === ValidationSeverity.Error);
  assert.deepEqual(errors.map((e) => e.message), []);
});

test('the producer honours the package-producer contract: * and = resolve, ^ on another line does not', async () => {
  const ver = createVersion;
  const fmt = (v: Awaited<ReturnType<typeof producer.resolveVersion>>) => (v ? formatVersion(v) : null);
  assert.equal(fmt(await producer.resolveVersion(PUBLISHER, 'language-tags', { operator: VersionOperator.Any, version: ver(0, 0, 0) })), '2026.9.17');
  assert.equal(fmt(await producer.resolveVersion(PUBLISHER, 'language-tags', { operator: VersionOperator.Exact, version: ver(2026, 9, 17) })), '2026.9.17');
  assert.equal(await producer.resolveVersion(PUBLISHER, 'language-tags', { operator: VersionOperator.Major, version: ver(2025, 1, 1) }), null);
  assert.equal(await producer.resolveVersion(PUBLISHER, 'other', { operator: VersionOperator.Any, version: ver(0, 0, 0) }), null);
  assert.equal(await producer.resolveVersion('kanonak.org', 'language-tags', { operator: VersionOperator.Any, version: ver(0, 0, 0) }), null, 'the vocabularies publisher is not ours');
  const produced = await producer.produce(PUBLISHER, 'language-tags', ver(2026, 9, 17));
  assert.equal(produced.source, (await producer.build()).yaml);
  await assert.rejects(producer.produce(PUBLISHER, 'language-tags', ver(2026, 1, 1)), /only produces the version its source is at/);
});

test('an unknown registry field fails the projection instead of being dropped', async () => {
  const mutated = sample.replace('Added: 2005-07-15\n', 'Added: 2005-07-15\nNew-Field: x\n');
  await assert.rejects(producer.project(snapshotOf(languageTags.sourceUrl, mutated)), /unknown registry field New-Field/);
});
