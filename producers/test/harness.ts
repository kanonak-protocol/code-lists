/**
 * The shared harness for producer tests: build a producer over fixture
 * files, pin its output to a golden, and run the checks every list must
 * pass — golden equality, determinism, zero validation errors against the
 * workspace (vocabularies from kanonak.org), and the package-producer
 * contract. A golden changes only when the producer changes: review the
 * diff, then regenerate with UPDATE_GOLDEN=1.
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
  parseVersionString,
  ValidationSeverity,
} from '@kanonak-protocol/sdk';
import { CodeListProducer, PUBLISHER, snapshotOf, type CodeListDefinition, type SourceFetcher } from '../src/contract.js';

/**
 * Tests resolve against the producers directory, which holds no packages, so
 * the vocabularies come from the cache / kanonak.org and a generated package
 * in the repository at the same coordinates as a sample can never leak into
 * the catalog the sample is validated in.
 */
export const WORKSPACE = fileURLToPath(new URL('../../', import.meta.url));
export const fixture = (name: string): string => fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));

const parser = new KanonakParser();
const repository = await buildLocalFirstRepository(WORKSPACE, parser);
const builder = new PackageBuilder(repository, parser);
const validator = new KanonakObjectValidator(parser);

/** A producer whose sources are read from fixture files keyed by source key. */
export function producerOver(def: CodeListDefinition, files: Record<string, string>): CodeListProducer {
  const fetcher: SourceFetcher = async (spec) => {
    const file = files[spec.key];
    if (!file) throw new Error(`no fixture for source ${spec.key}`);
    return snapshotOf(spec, readFileSync(fixture(file), 'utf8'));
  };
  return new CodeListProducer(def, builder, parser, fetcher);
}

export function standardTests(def: CodeListDefinition, files: Record<string, string>, golden: string, expected: { sourceVersion: string; version: string }): CodeListProducer {
  const producer = producerOver(def, files);

  test(`${def.name}: the fixtures project to the golden package, byte for byte`, async () => {
    const built = await producer.build();
    if (process.env.UPDATE_GOLDEN) writeFileSync(fixture(golden), built.yaml, 'utf8');
    assert.equal(built.sourceVersion, expected.sourceVersion);
    assert.equal(built.version, expected.version);
    assert.equal(built.yaml, readFileSync(fixture(golden), 'utf8'));
  });

  test(`${def.name}: the projection is deterministic`, async () => {
    const built = await producer.build();
    const again = await producer.project(built.snapshots);
    assert.equal(again.yaml, built.yaml);
  });

  test(`${def.name}: the golden validates with zero errors`, async () => {
    const built = await producer.build();
    const [result] = await validator.validateDocumentsAsync([built.document], repository);
    const errors = result!.result.errors.filter((e) => e.severity === ValidationSeverity.Error);
    assert.deepEqual(errors.map((e) => e.message), []);
  });

  test(`${def.name}: honours the package-producer contract`, async () => {
    const v = parseVersionString(expected.version)!;
    const fmt = (x: Awaited<ReturnType<typeof producer.resolveVersion>>) => (x ? formatVersion(x) : null);
    assert.equal(fmt(await producer.resolveVersion(PUBLISHER, def.name, { operator: VersionOperator.Any, version: createVersion(0, 0, 0) })), expected.version);
    assert.equal(fmt(await producer.resolveVersion(PUBLISHER, def.name, { operator: VersionOperator.Exact, version: v })), expected.version);
    assert.equal(await producer.resolveVersion(PUBLISHER, def.name, { operator: VersionOperator.Exact, version: createVersion(v.major + 1, 0, 0) }), null);
    assert.equal(await producer.resolveVersion('kanonak.org', def.name, { operator: VersionOperator.Any, version: createVersion(0, 0, 0) }), null, 'the vocabularies publisher is not ours');
    const produced = await producer.produce(PUBLISHER, def.name, v);
    assert.equal(produced.source, (await producer.build()).yaml);
    await assert.rejects(producer.produce(PUBLISHER, def.name, createVersion(v.major + 1, 0, 0)), /only produces the version its source is at/);
  });

  return producer;
}
