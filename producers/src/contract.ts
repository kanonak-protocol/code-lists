/**
 * The one way a code list gets into codes.kanonak.org: a `CodeListDefinition`
 * (the plugin — how ONE list's sources become ONE list's entries) wrapped by
 * `CodeListProducer`, which implements the SDK's package-producer contract
 * (`IPackageProducer`) so the same plugin serves a batch projection from the
 * workflow and, if ever wanted, an on-demand origin behind `kanonak serve`.
 *
 * What the wrapper owns, so no plugin re-does it: fetching and digesting
 * every source, deriving the package version from the primary source's own
 * marker, the `CodeList` provenance record, resource naming, import
 * bookkeeping and the deterministic YAML dump (both via the SDK's
 * `PackageBuilder`), and parsing the result. The produced bytes are a pure
 * function of the source bytes.
 */
import { createHash } from 'node:crypto';
import {
  PackageBuilder,
  KanonakParser,
  formatVersion,
  parseVersionString,
  satisfiesVersionOperator,
  type ImportBook,
  type IPackageProducer,
  type ProduceResult,
  type VersionRange,
} from '@kanonak-protocol/sdk';
import type { Import, KanonakDocument, Version } from '@kanonak-protocol/types/document/models/types';

/** The publisher every code list is emitted under. */
export const PUBLISHER = 'codes.kanonak.org';
/** Where the vocabularies the lists are typed with live (core-rdf, code-lists, language-tag, ...). */
export const VOCABULARY_PUBLISHER = 'kanonak.org';

/** One source of truth a list is read from. */
export interface SourceSpec {
  /** Short key the plugin and the runner's `--from <list>.<key>=<file>` use. */
  key: string;
  label: string;
  url: string;
  /** The source's own version marker, verbatim (`2026-09-17`, `3.29.0`). Throws if absent. */
  version(text: string): string;
}

/** The exact bytes read from a source, and where they came from. */
export interface SourceSnapshot {
  spec: SourceSpec;
  text: string;
  /** `sha256:<hex>` over the UTF-8 bytes — the same form the lock file uses. */
  digest: string;
}

/** Snapshots keyed by `SourceSpec.key`. */
export type Snapshots = Record<string, SourceSnapshot>;

/** What a plugin hands back for one projection. */
export interface Projection {
  /** Body resources, in source order, keyed by resource name. */
  body: Record<string, unknown>;
  /** `alias.Name` references to the classes the entries are instances of. */
  entryClasses: string[];
  entryCount: number;
  /** Extra header fields (a `comment` describing the list, for instance). */
  header?: Record<string, unknown>;
}

export interface ProjectContext {
  book: ImportBook;
  snapshots: Snapshots;
  /** The primary source's version marker. */
  sourceVersion: string;
}

/** The plugin: one per code list. */
export interface CodeListDefinition {
  /** The package name, and the list's name in the runner (`language-tags`). */
  name: string;
  label: string;
  /** The resource name of the `CodeList` record (`iana-language-subtag-registry`). */
  sourceName: string;
  sourceLabel: string;
  /** The sources, primary first: the package version derives from `sources[0]`. */
  sources: SourceSpec[];
  /** The package version derived from the primary source's marker (`2026.9.17`, `3.29.0`). */
  packageVersion(sourceVersion: string): string;
  /** Project the sources into body resources. Throws on anything unexpected. */
  project(snapshots: Snapshots, ctx: ProjectContext): Projection;
}

export function digestOf(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

export function snapshotOf(spec: SourceSpec, text: string): SourceSnapshot {
  return { spec, text, digest: digestOf(text) };
}

export async function fetchSource(spec: SourceSpec): Promise<SourceSnapshot> {
  const response = await fetch(spec.url);
  if (!response.ok) throw new Error(`fetch ${spec.url}: ${response.status} ${response.statusText}`);
  return snapshotOf(spec, await response.text());
}

export type SourceFetcher = (spec: SourceSpec) => Promise<SourceSnapshot>;

/**
 * The resource name for a code: the code with anything a name cannot carry
 * folded to `-` (after the plugin's own replacements, e.g. `+` → `-plus`),
 * and prefixed with the entry's kind when the code cannot start a name
 * (`0BSD` → `license-0BSD`). The entry's `cl.code` always holds the true code.
 */
export function resourceName(code: string, kind: string, replace: readonly [RegExp, string][] = []): string {
  let name = code;
  for (const [pattern, replacement] of replace) name = name.replace(pattern, replacement);
  name = name.replace(/[^A-Za-z0-9_-]/g, '-');
  if (!/^[A-Za-z]/.test(name)) name = `${kind}-${name}`;
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) throw new Error(`cannot derive a resource name from code ${JSON.stringify(code)}`);
  return name;
}

/** One projection, fully built: the YAML the package file holds plus its identity. */
export interface BuiltCodeList {
  yaml: string;
  document: KanonakDocument;
  sourceVersion: string;
  version: string;
  snapshots: Snapshots;
  entryCount: number;
}

export class CodeListProducer implements IPackageProducer {
  private current: Promise<BuiltCodeList> | undefined;

  constructor(
    private readonly definition: CodeListDefinition,
    private readonly builder: PackageBuilder,
    private readonly parser: KanonakParser,
    private readonly fetcher: SourceFetcher,
  ) {}

  canProduce(publisher: string, package_: string): boolean {
    return publisher === PUBLISHER && package_ === this.definition.name;
  }

  async resolveVersion(publisher: string, package_: string, range: VersionRange): Promise<Version | null> {
    if (!this.canProduce(publisher, package_)) return null;
    const built = await this.build();
    const candidate = parseVersionString(built.version);
    if (!candidate) throw new Error(`${this.definition.name}: derived version ${built.version} is not a version`);
    // The SDK's operator semantics, over the minimal range the contract carries.
    const asImport = { versionOperator: range.operator, version: range.version, minVersion: range.version } as Import;
    return satisfiesVersionOperator(candidate, asImport) ? candidate : null;
  }

  async produce(publisher: string, package_: string, version: Version): Promise<ProduceResult> {
    if (!this.canProduce(publisher, package_)) {
      throw new Error(`${this.definition.name} is not authoritative for ${publisher}/${package_}`);
    }
    const built = await this.build();
    if (formatVersion(version) !== built.version) {
      throw new Error(
        `${this.definition.name}: asked for ${formatVersion(version)} but the source is at ${built.version} — a code list only produces the version its source is at`,
      );
    }
    return { document: built.document, source: built.yaml, byteCount: Buffer.byteLength(built.yaml, 'utf8') };
  }

  /** Fetch every source (once) and project. The runner uses this directly. */
  build(): Promise<BuiltCodeList> {
    this.current ??= this.fetchAll().then((snapshots) => this.project(snapshots));
    return this.current;
  }

  private async fetchAll(): Promise<Snapshots> {
    const snapshots: Snapshots = {};
    for (const spec of this.definition.sources) snapshots[spec.key] = await this.fetcher(spec);
    return snapshots;
  }

  /** Project given snapshots — pure: the same snapshots always yield the same bytes. */
  async project(snapshots: Snapshots): Promise<BuiltCodeList> {
    const def = this.definition;
    const primary = def.sources[0];
    if (!primary) throw new Error(`${def.name}: a code list needs at least one source`);
    for (const spec of def.sources) {
      if (!snapshots[spec.key]) throw new Error(`${def.name}: no snapshot for source ${spec.key}`);
    }
    const sourceVersion = primary.version(snapshots[primary.key]!.text);
    const version = def.packageVersion(sourceVersion);
    if (!parseVersionString(version)) throw new Error(`${def.name}: ${version} (from ${sourceVersion}) is not a version`);

    const book = this.builder.imports();
    book.ensure(VOCABULARY_PUBLISHER, 'core-rdf', '1.1.0', 'rdfs'); // so `label`/`comment` resolve identically everywhere
    const cl = book.ensure(VOCABULARY_PUBLISHER, 'code-lists', '1.0.0', 'cl');
    const prov = book.ensure(VOCABULARY_PUBLISHER, 'provenance', '1.0.0', 'prov');

    const projection = def.project(snapshots, { book, snapshots, sourceVersion });

    const sources = def.sources.map((spec) => {
      const snapshot = snapshots[spec.key]!;
      return {
        type: `${prov}.Standard`,
        label: spec.label,
        [`${prov}.sourceUrl`]: spec.url,
        [`${cl}.sourceVersion`]: spec.version(snapshot.text),
        [`${cl}.sourceDigest`]: snapshot.digest,
      };
    });
    const record: Record<string, unknown> = {
      type: `${cl}.CodeList`,
      label: def.sourceLabel,
      comment:
        `The provenance of this package: projected from the ${def.sourceLabel} at its ` +
        `${sourceVersion} revision by the ${def.name} producer in the kanonak-protocol/code-lists ` +
        `repository. Verify against each source by its URL and digest; regenerate by running the producer.`,
      [`${cl}.source`]: sources.length === 1 ? sources[0] : sources,
      [`${cl}.producer`]: def.name,
      [`${cl}.entryClass`]: projection.entryClasses,
      [`${cl}.entryCount`]: projection.entryCount,
    };

    const built = await this.builder.buildNamed({
      publisher: PUBLISHER,
      name: def.name,
      version,
      book,
      header: {
        label: def.label,
        ...(projection.header ?? {}),
      },
      body: { [def.sourceName]: record, ...projection.body },
    });

    const parsed = this.parser.parseWithErrors(built.yaml);
    if (parsed.errors?.length || !parsed.document) {
      const first = parsed.errors?.[0];
      throw new Error(`${def.name}: produced YAML does not parse: ${first?.message ?? 'unknown error'}`);
    }
    return {
      yaml: built.yaml,
      document: parsed.document,
      sourceVersion,
      version,
      snapshots,
      entryCount: projection.entryCount,
    };
  }
}

/** Emit a scalar for one value and a list for several — the shape the rest of the repo uses. */
export function oneOrMany<T>(values: readonly T[]): T | T[] | undefined {
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : [...values];
}
