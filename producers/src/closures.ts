/**
 * Hash every package in each list's closure, each at the version that states it, as a consumer's hash reads them
 * (`stated-version-rule`):
 *
 *   node dist/src/closures.js [<list>/<version>.kan.yml ...]
 *
 * With no file, it checks the newest version of every list. A list's own hash reads only its own statements, so it
 * computes even where a floor it states can't be hashed, and every consumer whose closure holds the list then can't
 * hash its own: `provenance` 1.0.0 did that to every list (code-lists#2). Exits non-zero on any package that doesn't
 * hash, naming it and why.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  KanonakObjectParser,
  KanonakParser,
  StatedVersionRepository,
  buildLocalFirstRepository,
  canonicalHash,
  formatVersion,
} from '@kanonak-protocol/sdk';
import { deriveImportClosure } from '@kanonak-protocol/sdk/server';
import { SingleDocumentRepository } from '@kanonak-protocol/sdk/uri-helpers';
import type { IKanonakDocumentRepository } from '@kanonak-protocol/types/document/models';
import type { KanonakDocument } from '@kanonak-protocol/types/document/models/types';
import { LISTS } from './lists/index.js';
import { REPO_ROOT, newestPublishedFile } from './published.js';

function addressOf(document: KanonakDocument): string {
  const namespace = document.metadata.namespace_;
  if (!namespace?.version) throw new Error('a document in the closure names no publisher, package and version');
  return `${namespace.publisher}/${namespace.package_}@${formatVersion(namespace.version)}`;
}

/** A document's hash, as `kanonak hash` computes it: its own statements, every import read at its stated version. */
async function hashOf(document: KanonakDocument, stated: IKanonakDocumentRepository, parser: KanonakParser): Promise<{ hash: string } | { error: string }> {
  try {
    const kanonaks = await new KanonakObjectParser(parser).parseKanonaks(new SingleDocumentRepository(document, stated));
    return { hash: canonicalHash(kanonaks) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Every document in a list's closure, each at the version that states it. */
async function statedClosure(seed: KanonakDocument, stated: IKanonakDocumentRepository): Promise<KanonakDocument[]> {
  const documents = new Map<string, KanonakDocument>();
  const unresolved: string[] = [];
  await deriveImportClosure([seed], stated, {
    onDocument: (document) => documents.set(addressOf(document), document),
    onUnresolvedEdge: (edge) => unresolved.push(`${edge.fromNamespace} imports ${edge.publisher}/${edge.packageName} ${edge.constraint}: ${edge.reason}`),
  });
  if (unresolved.length) throw new Error(`the closure doesn't resolve at the versions it states:\n  ${unresolved.join('\n  ')}`);
  return [...documents.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, document]) => document);
}

async function main(): Promise<number> {
  const files = process.argv.slice(2).map((f) => join(process.cwd(), f));
  const targets = files.length
    ? files
    : LISTS.map((def) => {
        const newest = newestPublishedFile(def);
        if (!newest) throw new Error(`${def.name} has no published version to check`);
        return newest.file;
      });

  const parser = new KanonakParser();
  const stated = new StatedVersionRepository(await buildLocalFirstRepository(REPO_ROOT, parser));
  let failures = 0;
  for (const file of targets) {
    const label = relative(REPO_ROOT, file);
    const closure = await statedClosure(parser.parse(readFileSync(file, 'utf8')), stated);
    const failed: string[] = [];
    for (const document of closure) {
      const result = await hashOf(document, stated, parser);
      if ('error' in result) failed.push(`  ${addressOf(document)}: ${result.error}`);
    }
    if (failed.length) {
      failures++;
      console.error(`✗ ${label}: ${failed.length} of ${closure.length} packages in its stated closure don't hash, so no consumer whose closure holds it can hash its own. Raise the floors with \`kanonak upgrade\`, then make the list's next revision.\n${failed.join('\n')}`);
    } else {
      console.log(`✓ ${label}: all ${closure.length} packages in its stated closure hash`);
    }
  }
  return failures ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
