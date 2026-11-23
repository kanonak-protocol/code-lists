import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, parseVersionString } from '@kanonak-protocol/sdk';
import type { CodeListDefinition } from './contract.js';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The file of the newest version of a list in this repository, and that version, if it has one. */
export function newestPublishedFile(def: CodeListDefinition): { version: string; file: string } | undefined {
  const dir = join(REPO_ROOT, def.name);
  if (!existsSync(dir)) return undefined;
  let newest: { name: string; version: NonNullable<ReturnType<typeof parseVersionString>> } | undefined;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.kan.yml'))) {
    const name = file.slice(0, -'.kan.yml'.length);
    const version = parseVersionString(name);
    if (!version) throw new Error(`${def.name}/${file} is not named for a version`);
    if (!newest || compareVersions(version, newest.version) > 0) newest = { name, version };
  }
  if (!newest) return undefined;
  return { version: newest.name, file: join(dir, `${newest.name}.kan.yml`) };
}
