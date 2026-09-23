/**
 * The one way a code list gets into kanonak.org: a `CodeListDefinition` (the
 * plugin — how ONE source's records become ONE list's entries) wrapped by
 * `CodeListProducer`, which implements the SDK's package-producer contract
 * (`IPackageProducer`) so the same plugin serves a batch projection from the
 * workflow and, if ever wanted, an on-demand origin behind `kanonak serve`.
 *
 * What the wrapper owns, so no plugin re-does it: fetching and digesting the
 * source, deriving the package version from the source's own marker, the
 * `CodeList` provenance record, import bookkeeping and the deterministic
 * YAML dump (both via the SDK's `PackageBuilder`), and parsing the result.
 * The produced bytes are a pure function of the source bytes.
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

/** The exact bytes read from a source, and where they came from. */
export interface SourceSnapshot {
  url: string;
  text: string;
  /** `sha256:<hex>` over the UTF-8 bytes — the same form the lock file uses. */
  digest: string;
}

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
  snapshot: SourceSnapshot;
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
  sourceUrl: string;
  /** The source's own version marker, verbatim (`2026-09-17`, `3.27`). Throws if absent. */
  sourceVersion(text: string): string;
  /** The package version derived from that marker (`2026.9.17`, `3.27.0`). */
  packageVersion(sourceVersion: string): string;
  /** Project the source into body resources. Throws on anything unexpected. */
  project(text: string, ctx: ProjectContext): Projection;
}

export function digestOf(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

export function snapshotOf(url: string, text: string): SourceSnapshot {
  return { url, text, digest: digestOf(text) };
}

export async function fetchSource(url: string): Promise<SourceSnapshot> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url}: ${response.status} ${response.statusText}`);
  return snapshotOf(url, await response.text());
}

/** One projection, fully built: the YAML the package file holds plus its identity. */
export interface BuiltCodeList {
  yaml: string;
  document: KanonakDocument;
  sourceVersion: string;
  version: string;
  snapshot: SourceSnapshot;
  entryCount: number;
}

export class CodeListProducer implements IPackageProducer {
  private current: Promise<BuiltCodeList> | undefined;

  constructor(
    private readonly definition: CodeListDefinition,
    private readonly builder: PackageBuilder,
    private readonly parser: KanonakParser,
    private readonly source: () => Promise<SourceSnapshot>,
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

  /** Fetch (once) and project. The runner uses this directly. */
  build(): Promise<BuiltCodeList> {
    this.current ??= this.source().then((snapshot) => this.project(snapshot));
    return this.current;
  }

  /** Project a given snapshot — pure: the same snapshot always yields the same bytes. */
  async project(snapshot: SourceSnapshot): Promise<BuiltCodeList> {
    const def = this.definition;
    const sourceVersion = def.sourceVersion(snapshot.text);
    const version = def.packageVersion(sourceVersion);
    if (!parseVersionString(version)) throw new Error(`${def.name}: ${version} (from ${sourceVersion}) is not a version`);

    const book = this.builder.imports();
    const rdfs = book.ensure(VOCABULARY_PUBLISHER, 'core-rdf', '1.1.0', 'rdfs');
    const cl = book.ensure(VOCABULARY_PUBLISHER, 'code-lists', '1.0.0', 'cl');
    const prov = book.ensure(VOCABULARY_PUBLISHER, 'provenance', '1.0.0', 'prov');

    const projection = def.project(snapshot.text, { book, snapshot, sourceVersion });

    const record: Record<string, unknown> = {
      type: `${cl}.CodeList`,
      label: def.sourceLabel,
      comment:
        `The provenance of this package: projected from the ${def.sourceLabel} at its ` +
        `${sourceVersion} revision by the ${def.name} producer in the kanonak-protocol/code-lists ` +
        `repository. Verify against the source by its URL and digest; regenerate by running the producer.`,
      [`${cl}.source`]: {
        type: `${prov}.Standard`,
        label: def.sourceLabel,
        [`${prov}.sourceUrl`]: def.sourceUrl,
      },
      [`${cl}.sourceVersion`]: sourceVersion,
      [`${cl}.sourceDigest`]: snapshot.digest,
      [`${cl}.producer`]: def.name,
      [`${cl}.entryClass`]: projection.entryClasses,
      [`${cl}.entryCount`]: projection.entryCount,
    };
    void rdfs; // the alias is ensured so `label`/`comment` resolve identically everywhere

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
      snapshot,
      entryCount: projection.entryCount,
    };
  }
}
