/**
 * Reader for the "record-jar" text format IANA publishes several registries
 * in (the Language Subtag Registry among them): records separated by a line
 * of `%%`, each record a sequence of `Field: value` lines, a field repeatable,
 * a value continued on following lines that start with whitespace. The first
 * record is the file header (e.g. `File-Date`).
 *
 * The reader is strict: a line that is neither a field, a continuation, nor a
 * separator is an error, because a format change upstream must fail the
 * projection, not silently drop data.
 */

/** One record: field name → values in source order (a field may repeat). */
export type Record_ = Map<string, string[]>;

export interface RecordJar {
  /** The header record (before the first `%%`). */
  header: Record_;
  /** Every record after the header, in source order. */
  records: Record_[];
}

const SEPARATOR = '%%';

export function parseRecordJar(text: string): RecordJar {
  const blocks = text.replace(/\r\n/g, '\n').split(`\n${SEPARATOR}\n`);
  const parsed = blocks.map((block, index) => parseRecord(block, index));
  const [header, ...records] = parsed;
  if (!header) throw new Error('record-jar: empty input');
  return { header, records };
}

function parseRecord(block: string, index: number): Record_ {
  const record: Record_ = new Map();
  let current: string | undefined;
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue; // trailing newline at end of file
    if (line === SEPARATOR) continue; // a lone separator at the very end
    if (/^\s/.test(line)) {
      if (current === undefined) {
        throw new Error(`record-jar: continuation line before any field (record ${index}, line ${i + 1}): ${JSON.stringify(line)}`);
      }
      const values = record.get(current)!;
      values[values.length - 1] = `${values[values.length - 1]} ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(': ');
    if (colon <= 0) {
      throw new Error(`record-jar: malformed line (record ${index}, line ${i + 1}): ${JSON.stringify(line)}`);
    }
    const field = line.slice(0, colon);
    const value = line.slice(colon + 2);
    const values = record.get(field) ?? [];
    values.push(value);
    record.set(field, values);
    current = field;
  }
  return record;
}

/** The single value of a field, or undefined; throws if the field repeats. */
export function one(record: Record_, field: string): string | undefined {
  const values = record.get(field);
  if (!values) return undefined;
  if (values.length !== 1) throw new Error(`record-jar: field ${field} repeats (${values.length}×) where one value was expected`);
  return values[0];
}

/** The single required value of a field; throws if absent or repeated. */
export function required(record: Record_, field: string): string {
  const value = one(record, field);
  if (value === undefined) throw new Error(`record-jar: required field ${field} is missing`);
  return value;
}
