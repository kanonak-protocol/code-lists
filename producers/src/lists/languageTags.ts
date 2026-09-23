/**
 * The `language-tags` code list: the IANA Language Subtag Registry (BCP 47)
 * projected into a package typed by the `language-tag` vocabulary.
 *
 * Naming. Entries that are complete tags — language subtags, grandfathered
 * and redundant tags — are keyed by the tag verbatim (`en`, `zh-Hant`,
 * `i-klingon`), so a language-tagged string references `lang.en`. Component
 * subtags, which never stand alone, are keyed by type: `extlang-yue`,
 * `script-Hant`, `region-US`, `region-001`, `variant-1901`. The prefix is
 * what keeps the 258 extlangs from colliding with the languages of the same
 * code, keeps `ar` (Arabic) apart from `AR` (Argentina), and keeps numeric
 * regions and variants valid resource names.
 *
 * Lifecycle. `Deprecated` becomes `owl.deprecated: true` plus
 * `lt.deprecatedOn`; `Preferred-Value` becomes `prov.supersededBy` pointing
 * at the registered entry it names. Three preferred values in the registry
 * are composed tags that are not themselves registered (`en-GB-oxendict`,
 * `cmn-Hans`, `cmn-Hant`); those are emitted as composed `lt.LanguageTag`
 * entries so every reference resolves.
 *
 * Excluded. The private-use ranges (`qaa..qtz`, `Qaaa..Qabx`, `QM..QZ`,
 * `XA..XZ`) are ranges, not entries, and are left out.
 *
 * Any field or type the registry adds that this projection does not know is
 * an error: the source format changing must fail the run, not drop data.
 */
import { parseRecordJar, one, required, type Record_ } from '../readers/recordJar.js';
import { VOCABULARY_PUBLISHER, type CodeListDefinition, type Projection, type Snapshots, type SourceSpec } from '../contract.js';

const registrySource: SourceSpec = {
  key: 'registry',
  label: 'IANA Language Subtag Registry',
  url: 'https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry',
  version(text) {
    const jar = parseRecordJar(text);
    const date = required(jar.header, 'File-Date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`language-tags: File-Date ${date} is not a date`);
    return date;
  },
};

const KNOWN_FIELDS = new Set([
  'Type', 'Subtag', 'Tag', 'Description', 'Added', 'Deprecated', 'Preferred-Value',
  'Prefix', 'Suppress-Script', 'Macrolanguage', 'Scope', 'Comments',
]);

type RegistryType = 'language' | 'extlang' | 'script' | 'region' | 'variant' | 'grandfathered' | 'redundant';

/** Registry type → (vocabulary class, key prefix). Complete tags have no prefix. */
const TYPES: Record<RegistryType, { class_: string; prefix: string }> = {
  language: { class_: 'LanguageSubtag', prefix: '' },
  extlang: { class_: 'ExtlangSubtag', prefix: 'extlang-' },
  script: { class_: 'ScriptSubtag', prefix: 'script-' },
  region: { class_: 'RegionSubtag', prefix: 'region-' },
  variant: { class_: 'VariantSubtag', prefix: 'variant-' },
  grandfathered: { class_: 'GrandfatheredTag', prefix: '' },
  redundant: { class_: 'RedundantTag', prefix: '' },
};

const SCOPES: Record<string, string> = {
  macrolanguage: 'Macrolanguage',
  collection: 'Collection',
  special: 'Special',
  'private-use': 'PrivateUse',
};

interface Entry {
  type: RegistryType;
  code: string;
  key: string;
  record: Record_;
}

export const languageTags: CodeListDefinition = {
  name: 'language-tags',
  label: 'Language Tags',
  sourceName: 'iana-language-subtag-registry',
  sourceLabel: 'IANA Language Subtag Registry',
  sources: [registrySource],

  packageVersion(sourceVersion) {
    const [y, m, d] = sourceVersion.split('-').map(Number);
    return `${y}.${m}.${d}`;
  },

  project(snapshots: Snapshots, ctx): Projection {
    const jar = parseRecordJar(snapshots.registry!.text);
    const { book } = ctx;
    const lt = book.ensure(VOCABULARY_PUBLISHER, 'language-tag', '1.0.0', 'lt');
    const cl = book.ensure(VOCABULARY_PUBLISHER, 'code-lists', '1.0.0', 'cl');
    const owl = book.ensure(VOCABULARY_PUBLISHER, 'core-owl', '2.2.0', 'owl');
    const prov = book.ensure(VOCABULARY_PUBLISHER, 'provenance', '1.0.0', 'prov');

    // Pass 1: index every entry so references (preferred value, macrolanguage,
    // suppress-script) are checked against the registry itself.
    const entries: Entry[] = [];
    const byTypeAndCode = new Map<string, Entry>();
    let excludedRanges = 0;
    for (const record of jar.records) {
      for (const field of record.keys()) {
        if (!KNOWN_FIELDS.has(field)) throw new Error(`language-tags: unknown registry field ${field}`);
      }
      const type = required(record, 'Type') as RegistryType;
      if (!(type in TYPES)) throw new Error(`language-tags: unknown registry type ${type}`);
      const code = type === 'grandfathered' || type === 'redundant' ? required(record, 'Tag') : required(record, 'Subtag');
      if (code.includes('..')) { excludedRanges++; continue; }
      const entry: Entry = { type, code, key: `${TYPES[type].prefix}${code}`, record };
      entries.push(entry);
      byTypeAndCode.set(`${type}:${code}`, entry);
    }

    const languageKey = (code: string): string | undefined => byTypeAndCode.get(`language:${code}`)?.key;
    const completeTagKey = (code: string): string | undefined =>
      languageKey(code) ?? byTypeAndCode.get(`grandfathered:${code}`)?.key ?? byTypeAndCode.get(`redundant:${code}`)?.key;
    const componentKey = (type: RegistryType, code: string): string => {
      const found = byTypeAndCode.get(`${type}:${code}`);
      if (!found) throw new Error(`language-tags: ${type} ${code} is referenced but not registered`);
      return found.key;
    };

    // Composed tags the registry names as preferred values without registering them.
    const composed = new Map<string, Record<string, unknown>>();
    const composedKey = (tag: string): string => {
      if (composed.has(tag)) return tag;
      const [primary, ...rest] = tag.split('-');
      if (!primary || !languageKey(primary)) throw new Error(`language-tags: cannot compose ${tag}: ${primary} is not a language subtag`);
      const resource: Record<string, unknown> = {
        type: `${lt}.LanguageTag`,
        label: tag,
        comment: 'A composed tag the registry names as a preferred value; composed here from its registered subtags because it is not itself a registered entry.',
        [`${cl}.code`]: tag,
        [`${lt}.primaryLanguage`]: languageKey(primary),
      };
      const variants: string[] = [];
      for (const part of rest) {
        if (/^[A-Za-z]{4}$/.test(part)) resource[`${lt}.script`] = componentKey('script', part);
        else if (/^([A-Za-z]{2}|\d{3})$/.test(part)) resource[`${lt}.region`] = componentKey('region', part);
        else if (/^[A-Za-z]{3}$/.test(part) && byTypeAndCode.has(`extlang:${part}`)) resource[`${lt}.extlang`] = componentKey('extlang', part);
        else variants.push(componentKey('variant', part));
      }
      if (variants.length) resource[`${lt}.variants`] = variants;
      composed.set(tag, resource);
      return tag;
    };

    const supersededBy = (entry: Entry, preferred: string): string => {
      switch (entry.type) {
        case 'language':
        case 'grandfathered':
        case 'redundant':
          return completeTagKey(preferred) ?? composedKey(preferred);
        case 'extlang':
          return componentKey('language', preferred); // an extlang's preferred form is the primary language of the same code
        default:
          return componentKey(entry.type, preferred);
      }
    };

    // Pass 2: emit, in registry order.
    const body: Record<string, unknown> = {};
    for (const entry of entries) {
      const { record, type } = entry;
      const descriptions = record.get('Description') ?? [];
      const [label, ...alternates] = descriptions;
      if (!label) throw new Error(`language-tags: ${type} ${entry.code} has no Description`);

      const resource: Record<string, unknown> = {
        type: `${lt}.${TYPES[type].class_}`,
        label,
      };
      if (alternates.length) resource[`${cl}.altLabel`] = alternates.length === 1 ? alternates[0] : alternates;
      const comments = record.get('Comments');
      if (comments) resource.comment = comments.join(' ');
      resource[`${cl}.code`] = entry.code;
      resource[`${lt}.added`] = required(record, 'Added');

      const deprecated = one(record, 'Deprecated');
      if (deprecated !== undefined) {
        resource[`${owl}.deprecated`] = true;
        resource[`${lt}.deprecatedOn`] = deprecated;
      }
      const preferred = one(record, 'Preferred-Value');
      if (preferred !== undefined) resource[`${prov}.supersededBy`] = supersededBy(entry, preferred);

      const prefixes = record.get('Prefix');
      if (prefixes) resource[`${lt}.prefix`] = prefixes.length === 1 ? prefixes[0] : prefixes;
      const suppress = one(record, 'Suppress-Script');
      if (suppress !== undefined) resource[`${lt}.suppressScript`] = componentKey('script', suppress);
      const macro = one(record, 'Macrolanguage');
      if (macro !== undefined) resource[`${lt}.macrolanguage`] = componentKey('language', macro);
      const scope = one(record, 'Scope');
      if (scope !== undefined) {
        const individual = SCOPES[scope];
        if (!individual) throw new Error(`language-tags: unknown Scope ${scope}`);
        resource[`${lt}.scope`] = `${lt}.${individual}`;
      }

      if (body[entry.key]) throw new Error(`language-tags: duplicate resource name ${entry.key}`);
      body[entry.key] = resource;
    }
    for (const [tag, resource] of composed) {
      if (body[tag]) throw new Error(`language-tags: composed tag ${tag} collides with a registered entry`);
      body[tag] = resource;
    }

    const entryClasses = [...new Set(entries.map((e) => `${lt}.${TYPES[e.type].class_}`))];
    if (composed.size) entryClasses.push(`${lt}.LanguageTag`);

    return {
      body,
      entryClasses,
      entryCount: entries.length + composed.size,
      header: {
        comment:
          `Every registered BCP 47 subtag and tag from the ${registrySource.label} at its ` +
          `${ctx.sourceVersion} revision — ${entries.length} entries` +
          (composed.size ? ` plus ${composed.size} composed tags the registry names as preferred values` : '') +
          `; ${excludedRanges} private-use ${excludedRanges === 1 ? 'range is' : 'ranges are'} excluded. Generated by the language-tags ` +
          `producer from the source named in the iana-language-subtag-registry record; do not edit — ` +
          `a new registry revision is a new package version.`,
      },
    };
  },
};
