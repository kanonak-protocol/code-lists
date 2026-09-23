/**
 * The runner: project every (or the named) code list into the packages
 * workspace.
 *
 *   node dist/src/run.js [list ...] [--from <list>=<file>] [--dry-run]
 *
 * For each list: fetch the source (or read `--from`), derive the package
 * version from the source's own marker, and decide by the target file
 * `<list>/<version>.kan.yml`:
 *
 *   exists, byte-identical → up to date, nothing written;
 *   exists, differs        → FAIL (the source changed under the same marker);
 *   absent                 → project twice (determinism), validate through the
 *                            SDK against the workspace, write.
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
import { CodeListProducer, fetchSource, snapshotOf, type CodeListDefinition } from './contract.js';
import { LISTS } from './lists/index.js';

const PACKAGES_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

interface Args { names: string[]; from: Map<string, string>; dryRun: boolean }

function parseArgs(argv: string[]): Args {
  const args: Args = { names: [], from: new Map(), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--from') {
      const spec = argv[++i];
      const eq = spec?.indexOf('=') ?? -1;
      if (!spec || eq <= 0) throw new Error('--from expects <list>=<file>');
      args.from.set(spec.slice(0, eq), spec.slice(eq + 1));
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else args.names.push(a);
  }
  return args;
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

  const parser = new KanonakParser();
  const repository = await buildLocalFirstRepository(PACKAGES_ROOT, parser);
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
  const fromFile = ctx.args.from.get(def.name);
  const source = fromFile
    ? async () => snapshotOf(def.sourceUrl, readFileSync(fromFile, 'utf8'))
    : () => fetchSource(def.sourceUrl);
  const producer = new CodeListProducer(def, ctx.builder, ctx.parser, source);

  const built = await producer.build();
  const target = join(PACKAGES_ROOT, def.name, `${built.version}.kan.yml`);
  const where = `${def.name}@${built.version} (source ${built.sourceVersion}, ${built.snapshot.digest.slice(0, 19)}…, ${built.entryCount} entries)`;

  if (existsSync(target)) {
    const existing = readFileSync(target, 'utf8');
    if (existing === built.yaml) {
      console.log(`= ${where}: up to date`);
      return;
    }
    throw new Error(
      `${where}: ${target} exists but differs from the projection. Either the source changed without ` +
        `changing its version marker, or the producer changed. A person must decide; nothing was written.`,
    );
  }

  // Determinism: the same snapshot must project to the same bytes.
  const again = await producer.project(built.snapshot);
  if (again.yaml !== built.yaml) throw new Error(`${where}: projecting the same source twice gave different bytes`);

  // Validate against the workspace exactly as `kanonak validate` would.
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
