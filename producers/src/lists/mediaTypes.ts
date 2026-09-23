/**
 * The `media-types` code list: the IANA Media Types registry projected into a
 * package typed by the `media-type` vocabulary.
 *
 * One source, IANA's `media-types.xml`, whose root `<updated>` date is the
 * version marker. Each sub-registry is a top-level type; each record's
 * `<file type="template">` holds the clean `type/subtype` name, which is the
 * code — except for a deprecated alias, where IANA puts the alias's own name
 * in a `name` attribute on `<file>` and the successor's template in the text
 * (`<file type="template" name="image/x-emf">image/emf</file>`); the
 * attribute wins. The record's `<name>` is a display string that IANA
 * annotates in place when a type is retired — `javascript (OBSOLETED in
 * favor of text/javascript)`, `font-woff - DEPRECATED in favor of font/woff`,
 * `remote-printing (OBSOLETE)` — so the annotation is parsed into
 * `owl.deprecated` and, when a successor is named and registered,
 * `prov.supersededBy`. A successor the registry names but does not hold is
 * an error, not a dropped fact.
 *
 * Resource names fold `/`, `+` and `.` to `-` (`image/svg+xml` →
 * `image-svg-xml`), matching the convention document-ast already uses.
 */
import { parseXml, many, text, attr, type XmlNode } from '../readers/xml.js';
import { VOCABULARY_PUBLISHER, oneOrMany, resourceName, type CodeListDefinition, type Projection, type Snapshots, type SourceSpec } from '../contract.js';

const TOP_LEVEL: Record<string, string> = {
  application: 'Application', audio: 'Audio', example: 'Example', font: 'Font', haptics: 'Haptics',
  image: 'Image', message: 'Message', model: 'Model', multipart: 'Multipart', text: 'Text', video: 'Video',
};
const KNOWN_RECORD_KEYS = new Set(['name', 'file', 'xref', '@date', '@updated']);
const RETIRED = /\b(OBSOLETED?|DEPRECATED)\b(?:\s+in\s+favou?r\s+of\s+([a-z]+\/[^\s()]+))?/i;

function root(textContent: string): XmlNode {
  const doc = parseXml(textContent);
  const registry = doc.registry as XmlNode | undefined;
  if (!registry || attr(registry, 'id') !== 'media-types') throw new Error('media-types: not the IANA media-types registry');
  return registry;
}

const registrySource: SourceSpec = {
  key: 'registry',
  label: 'IANA Media Types registry',
  url: 'https://www.iana.org/assignments/media-types/media-types.xml',
  version: (t) => {
    const updated = text(root(t), 'updated');
    if (!updated || !/^\d{4}-\d{2}-\d{2}$/.test(updated)) throw new Error(`media-types: registry <updated> ${updated} is not a date`);
    return updated;
  },
};

function specificationUrl(xref: XmlNode): string | undefined {
  const type = attr(xref, 'type');
  const data = attr(xref, 'data') ?? '';
  switch (type) {
    case 'rfc': return `https://www.rfc-editor.org/rfc/${data.toLowerCase()}`;
    case 'draft': return `https://datatracker.ietf.org/doc/${data}`;
    case 'uri': return data;
    default: return undefined; // person, note, text, rfc-errata: not a specification
  }
}

export const mediaTypes: CodeListDefinition = {
  name: 'media-types',
  label: 'Media Types',
  sourceName: 'iana-media-types-registry',
  sourceLabel: 'IANA Media Types registry',
  sources: [registrySource],

  packageVersion(sourceVersion) {
    const [y, m, d] = sourceVersion.split('-').map(Number);
    return `${y}.${m}.${d}`;
  },

  project(snapshots: Snapshots, ctx): Projection {
    const registry = root(snapshots.registry!.text);
    const { book } = ctx;
    const mt = book.ensure(VOCABULARY_PUBLISHER, 'media-type', '1.0.0', 'mt');
    const cl = book.ensure(VOCABULARY_PUBLISHER, 'code-lists', '1.0.0', 'cl');
    const owl = book.ensure(VOCABULARY_PUBLISHER, 'core-owl', '2.2.0', 'owl');
    const prov = book.ensure(VOCABULARY_PUBLISHER, 'provenance', '1.0.0', 'prov');

    interface Entry { code: string; key: string; topLevel: string; record: XmlNode; retired?: { successor?: string } }
    const entries: Entry[] = [];
    // Media type names are case-insensitive (RFC 6838 §4.2): the registry
    // holds `audio/QCELP` and retires `audio/vnd.qcelp` "in favor of audio/qcelp".
    const byCode = new Map<string, Entry>();
    const lookup = (code: string): Entry | undefined => byCode.get(code.toLowerCase());
    for (const sub of many(registry, 'registry')) {
      const topLevel = attr(sub, 'id');
      if (!topLevel || !(topLevel in TOP_LEVEL)) throw new Error(`media-types: unknown top-level type ${topLevel}`);
      for (const record of many(sub, 'record')) {
        for (const k of Object.keys(record)) if (!KNOWN_RECORD_KEYS.has(k)) throw new Error(`media-types: unknown record field ${k} in ${topLevel}`);
        const [file, ...moreFiles] = many(record, 'file');
        if (!file || moreFiles.length) throw new Error(`media-types: record in ${topLevel} has ${moreFiles.length + (file ? 1 : 0)} template files`);
        const code = attr(file, 'name') ?? text(file);
        if (!code || !code.startsWith(`${topLevel}/`)) throw new Error(`media-types: record in ${topLevel} has template ${code}`);
        const name = text(record, 'name') ?? '';
        const match = RETIRED.exec(name);
        const entry: Entry = { code, key: resourceName(code, 'media-type'), topLevel, record };
        if (match) entry.retired = match[2] ? { successor: match[2] } : {};
        if (lookup(code)) throw new Error(`media-types: ${code} is registered twice`);
        byCode.set(code.toLowerCase(), entry);
        entries.push(entry);
      }
    }

    const body: Record<string, unknown> = {};
    for (const entry of entries) {
      const { record } = entry;
      const resource: Record<string, unknown> = {
        type: `${mt}.MediaType`,
        label: entry.code,
        [`${cl}.code`]: entry.code,
        [`${mt}.topLevelType`]: `${mt}.${TOP_LEVEL[entry.topLevel]}`,
        [`${mt}.template`]: `https://www.iana.org/assignments/media-types/${entry.code}`,
      };
      const specs = oneOrMany(many(record, 'xref').map(specificationUrl).filter((u): u is string => u !== undefined));
      if (specs !== undefined) resource[`${mt}.specification`] = specs;
      const date = attr(record, 'date');
      if (date) resource[`${mt}.registeredOn`] = date;
      const updated = attr(record, 'updated');
      if (updated) resource[`${mt}.updatedOn`] = updated;
      if (entry.retired) {
        resource[`${owl}.deprecated`] = true;
        const successor = entry.retired.successor;
        if (successor) {
          const target = lookup(successor);
          if (!target) throw new Error(`media-types: ${entry.code} is retired in favour of ${successor}, which the registry does not hold`);
          resource[`${prov}.supersededBy`] = target.key;
        }
      }
      if (body[entry.key]) throw new Error(`media-types: duplicate resource name ${entry.key}`);
      body[entry.key] = resource;
    }

    const retired = entries.filter((e) => e.retired).length;
    return {
      body,
      entryClasses: [`${mt}.MediaType`],
      entryCount: entries.length,
      header: {
        comment:
          `Every registered media type from the IANA Media Types registry as updated ${ctx.sourceVersion} — ` +
          `${entries.length} types, ${retired} of them obsoleted or deprecated. Generated by the media-types ` +
          `producer from the source named in the iana-media-types-registry record; do not edit — a new registry ` +
          `revision is a new package version.`,
      },
    };
  },
};
