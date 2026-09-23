/**
 * The runner: project every (or the named) code list into this repository.
 *
 *   node dist/src/run.js [list ...] [--from <list>[.<source>]=<file>] [--dry-run]
 *
 * For each list: fetch its sources (or read the `--from` files — the source
 * key may be omitted for a single-source list), derive the package version
 * from the primary source's own marker, and decide by the target file
 * `<list>/<version>.kan.yml`:
 *
 *   exists, byte-identical → up to date, nothing written;
 *   exists, differs        → FAIL (the source changed under the same marker);
 *   absent                 → project twice (determinism), validate through the
 *                            SDK against the workspace (vocabularies resolve
 *                            from kanonak.org), write.
 *
 * Exit code is non-zero on any failure, so the workflow never opens a pull
 * request for a list that did not validate.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KanonakParser,
  KanonakObjectValidator,
  PackageBuilder,
  buildLocalFirstRepository,
  ValidationSeverity,
} from '@kanonak-protocol/sdk';
import { CodeListProducer, fetchSource, snapshotOf, type CodeListDefinition, type SourceFetcher } from './contract.js';
import { LISTS } from './lists/index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

interface Args { names: string[]; from: Map<string, string>; dryRun: boolean }

function parseArgs(argv: string[]): Args {
  const args: Args = { names: [], from: new Map(), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--from') {
      const spec = argv[++i];
      const eq = spec?.indexOf('=') ?? -1;
      if (!spec || eq <= 0) throw new Error('--from expects <list>[.<source>]=<file>');
      args.from.set(spec.slice(0, eq), spec.slice(eq + 1));
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else args.names.push(a);
  }
  return args;
}

/** A fetcher honouring `--from` overrides for one list; everything else goes to the network. */
function fetcherFor(def: CodeListDefinition, from: Map<string, string>): SourceFetcher {
  return async (spec) => {
    const file = from.get(`${def.name}.${spec.key}`) ?? (def.sources.length === 1 ? from.get(def.name) : undefined);
    if (file) return snapshotOf(spec, readFileSync(file, 'utf8'));
    return fetchSource(spec);
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const selected = args.names.length
    ? args.names.map((n) => {
        const def = LISTS.find((l) => l.name === n);
        if (!def) throw new Error(`unknown code list ${n}; known: ${LISTS.map((l) => l.name).join(', ')}`);
        return def;
      })
    : [...LISTS];
  for (const key of args.from.keys()) {
    const list = key.split('.')[0]!;
    if (!selected.some((d) => d.name === list)) throw new Error(`--from ${key}: ${list} is not a selected list`);
  }

  const parser = new KanonakParser();
  const repository = await buildLocalFirstRepository(REPO_ROOT, parser);
  const builder = new PackageBuilder(repository, parser);
  const validator = new KanonakObjectValidator(parser);

  let failures = 0;
  for (const def of selected) {
    try {
      await runOne(def, { args, parser, builder, validator, repository });
    } catch (err) {
      failures++;
      console.error(`✗ ${def.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return failures ? 1 : 0;
}

async function runOne(
  def: CodeListDefinition,
  ctx: {
    args: Args;
    parser: KanonakParser;
    builder: PackageBuilder;
    validator: KanonakObjectValidator;
    repository: Awaited<ReturnType<typeof buildLocalFirstRepository>>;
  },
): Promise<void> {
  const producer = new CodeListProducer(def, ctx.builder, ctx.parser, fetcherFor(def, ctx.args.from));

  const built = await producer.build();
  const target = join(REPO_ROOT, def.name, `${built.version}.kan.yml`);
  const digests = Object.values(built.snapshots).map((s) => s.digest.slice(7, 19)).join(', ');
  const where = `${def.name}@${built.version} (source ${built.sourceVersion}, sha256 ${digests}, ${built.entryCount} entries)`;

  if (existsSync(target)) {
    const existing = readFileSync(target, 'utf8');
    if (existing === built.yaml) {
      console.log(`= ${where}: up to date`);
      return;
    }
    throw new Error(
      `${where}: ${target} exists but differs from the projection. Either a source changed without ` +
        `changing its version marker, or the producer changed. A person must decide; nothing was written.`,
    );
  }

  // Determinism: the same snapshots must project to the same bytes.
  const again = await producer.project(built.snapshots);
  if (again.yaml !== built.yaml) throw new Error(`${where}: projecting the same sources twice gave different bytes`);

  // Validate exactly as `kanonak validate` would.
  const [result] = await ctx.validator.validateDocumentsAsync([built.document], ctx.repository);
  const errors = result?.result.errors.filter((e) => e.severity === ValidationSeverity.Error) ?? [];
  const warnings = result?.result.warnings.filter((e) => e.severity === ValidationSeverity.Warning) ?? [];
  for (const w of warnings) console.log(`  WARN ${w.message}`);
  if (errors.length) {
    for (const e of errors) console.error(`  ERROR ${e.message}${e.suggestion ? `\n    -> ${e.suggestion}` : ''}`);
    throw new Error(`${where}: ${errors.length} validation error(s); nothing was written`);
  }

  if (ctx.args.dryRun) {
    console.log(`~ ${where}: would write ${target} (${Buffer.byteLength(built.yaml)} bytes)`);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, built.yaml, 'utf8');
  console.log(`+ ${where}: wrote ${target}`);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
