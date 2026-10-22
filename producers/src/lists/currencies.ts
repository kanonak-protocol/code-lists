/**
 * The `currencies` code list: ISO 4217 projected into a package typed by the
 * `currency` vocabulary.
 *
 * Two sources from the ISO 4217 maintenance agency (SIX): `list-one.xml`,
 * the current currencies and funds, and `list-three.xml`, the withdrawn
 * ones with their withdrawal dates. Each is stamped with a `Pblshd` date;
 * the package version derives from list one's. Both lists are per COUNTRY
 * (the euro appears once per member), so entries are deduplicated by code
 * in first-seen order; a code that is withdrawn somewhere but current
 * elsewhere is not deprecated. Rows without a code ("No universal currency"
 * for Antarctica) are skipped, and counted in the header.
 *
 * Withdrawal dates are kept as the standard writes them (`2002-02`, `1989
 * to 1990`); where a withdrawn code appears with several dates the latest
 * is taken. The country names the lists carry are not projected: they are
 * names, not codes, and the region a currency is used in belongs to the
 * region, not the currency.
 */
import { parseXml, many, text, attr, type XmlNode } from '../readers/xml.js';
import { VOCABULARY_PUBLISHER, oneOrMany, resourceName, type CodeListDefinition, type Projection, type Snapshots, type SourceSpec } from '../contract.js';

const KNOWN_CURRENT = new Set(['CtryNm', 'CcyNm', 'Ccy', 'CcyNbr', 'CcyMnrUnts']);
const KNOWN_HISTORIC = new Set(['CtryNm', 'CcyNm', 'Ccy', 'CcyNbr', 'WthdrwlDt']);

function published(t: string): string {
  const doc = parseXml(t);
  const root = doc.ISO_4217 as XmlNode | undefined;
  const date = attr(root, 'Pblshd');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`currencies: Pblshd ${date} is not a date`);
  return date;
}

const listOne: SourceSpec = {
  key: 'current',
  label: 'ISO 4217 — current currencies and funds (list one)',
  url: 'https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml',
  version: published,
  publishedOn: published,
};
const listThree: SourceSpec = {
  key: 'historic',
  label: 'ISO 4217 — withdrawn currencies and funds (list three)',
  url: 'https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-three.xml',
  version: published,
  publishedOn: published,
};

interface Row { code: string; name: string; isFund: boolean; numeric?: string; minorUnits?: string; withdrawn?: string }

function rows(t: string, table: string, row: string, known: Set<string>): { rows: Row[]; skipped: number } {
  const root = parseXml(t).ISO_4217 as XmlNode | undefined;
  const tbl = root?.[table] as XmlNode | undefined;
  if (!tbl) throw new Error(`currencies: no ${table}`);
  const out: Row[] = [];
  let skipped = 0;
  for (const r of many(tbl, row)) {
    for (const k of Object.keys(r)) if (!known.has(k)) throw new Error(`currencies: unknown field ${k} in ${row}`);
    const code = text(r, 'Ccy');
    if (!code) { skipped++; continue; }
    const nameNode = r.CcyNm as XmlNode | string | undefined;
    const name = text(r, 'CcyNm');
    if (!name) throw new Error(`currencies: ${code} has no name`);
    const isFund = typeof nameNode === 'object' && attr(nameNode, 'IsFund') === 'true';
    const item: Row = { code, name, isFund };
    const numeric = text(r, 'CcyNbr'); if (numeric) item.numeric = numeric;
    const minor = text(r, 'CcyMnrUnts'); if (minor) item.minorUnits = minor;
    const withdrawn = text(r, 'WthdrwlDt'); if (withdrawn) item.withdrawn = withdrawn;
    out.push(item);
  }
  return { rows: out, skipped };
}

export const currencies: CodeListDefinition = {
  name: 'currencies',
  label: 'Currencies',
  sourceName: 'iso-4217',
  sourceLabel: 'ISO 4217 currency code lists',
  sources: [listOne, listThree],

  revision: 0,

  project(snapshots: Snapshots, ctx): Projection {
    const current = rows(snapshots.current!.text, 'CcyTbl', 'CcyNtry', KNOWN_CURRENT);
    const historic = rows(snapshots.historic!.text, 'HstrcCcyTbl', 'HstrcCcyNtry', KNOWN_HISTORIC);
    const { book } = ctx;
    const cur = book.ensure(VOCABULARY_PUBLISHER, 'currency', '1.0.0', 'cur');
    const cl = book.ensure(VOCABULARY_PUBLISHER, 'code-lists', '1.0.0', 'cl');
    const owl = book.ensure(VOCABULARY_PUBLISHER, 'core-owl', '2.2.0', 'owl');

    interface Entry { code: string; names: string[]; isFund: boolean; numeric?: string; minorUnits?: number; withdrawn?: string }
    const entries = new Map<string, Entry>();
    for (const r of current.rows) {
      const e = entries.get(r.code);
      if (e) {
        if (!e.names.includes(r.name)) e.names.push(r.name);
        if ((e.numeric ?? r.numeric) !== r.numeric && r.numeric) throw new Error(`currencies: ${r.code} has two numeric codes`);
        continue;
      }
      const entry: Entry = { code: r.code, names: [r.name], isFund: r.isFund };
      if (r.numeric) entry.numeric = r.numeric;
      if (r.minorUnits && /^\d+$/.test(r.minorUnits)) entry.minorUnits = Number(r.minorUnits);
      entries.set(r.code, entry);
    }
    let withdrawnCount = 0;
    for (const r of historic.rows) {
      const existing = entries.get(r.code);
      if (existing) {
        // current somewhere, withdrawn elsewhere (or already seen in the historic list)
        if (existing.withdrawn !== undefined) {
          if (!existing.names.includes(r.name)) existing.names.push(r.name);
          if (r.withdrawn && r.withdrawn > existing.withdrawn) existing.withdrawn = r.withdrawn;
        }
        continue;
      }
      if (!r.withdrawn) throw new Error(`currencies: historic ${r.code} has no withdrawal date`);
      const entry: Entry = { code: r.code, names: [r.name], isFund: r.isFund, withdrawn: r.withdrawn };
      if (r.numeric) entry.numeric = r.numeric;
      entries.set(r.code, entry);
      withdrawnCount++;
    }

    const body: Record<string, unknown> = {};
    for (const e of entries.values()) {
      const [label, ...alternates] = e.names;
      const resource: Record<string, unknown> = { type: `${cur}.Currency`, label, [`${cl}.code`]: e.code };
      const alt = oneOrMany(alternates);
      if (alt !== undefined) resource[`${cl}.altLabel`] = alt;
      if (e.numeric) resource[`${cur}.numericCode`] = e.numeric;
      if (e.minorUnits !== undefined) resource[`${cur}.minorUnits`] = e.minorUnits;
      if (e.isFund) resource[`${cur}.isFund`] = true;
      if (e.withdrawn !== undefined) {
        resource[`${owl}.deprecated`] = true;
        resource[`${cur}.withdrawnOn`] = e.withdrawn;
      }
      const key = resourceName(e.code, 'currency');
      if (body[key]) throw new Error(`currencies: duplicate resource name ${key}`);
      body[key] = resource;
    }

    return {
      body,
      entryClasses: [`${cur}.Currency`],
      entryCount: entries.size,
      header: {
        comment:
          `Every ISO 4217 currency and fund code: the current list as published ${ctx.sourceVersion} and the ` +
          `withdrawn list as published ${listThree.version(snapshots.historic!.text)} — ${entries.size} codes, ` +
          `${withdrawnCount} of them withdrawn; ${current.skipped + historic.skipped} rows without a code are ` +
          `skipped. Generated by the currencies producer from the sources named in the iso-4217 record; do not ` +
          `edit — a new publication is a new package version.`,
      },
    };
  },
};
