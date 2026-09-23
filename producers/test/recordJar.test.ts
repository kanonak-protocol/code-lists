import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecordJar, one, required } from '../src/readers/recordJar.js';

test('splits header and records, keeps repeated fields in order, joins continuation lines', () => {
  const jar = parseRecordJar(
    'File-Date: 2026-09-17\n%%\nType: language\nSubtag: es\nDescription: Spanish\nDescription: Castilian\n%%\n' +
      'Type: region\nSubtag: GB\nComments: as of 2006-03-29 GB no longer includes the Channel Islands and\n  Isle of Man; see GG, JE, IM\n',
  );
  assert.equal(required(jar.header, 'File-Date'), '2026-09-17');
  assert.equal(jar.records.length, 2);
  assert.deepEqual(jar.records[0]!.get('Description'), ['Spanish', 'Castilian']);
  assert.equal(one(jar.records[1]!, 'Comments'), 'as of 2006-03-29 GB no longer includes the Channel Islands and Isle of Man; see GG, JE, IM');
});

test('a line that is not a field, a continuation, or a separator is an error', () => {
  assert.throws(() => parseRecordJar('File-Date: 2026-09-17\n%%\nType: language\ngarbage\n'), /malformed line/);
});

test('one() refuses a repeated field', () => {
  const jar = parseRecordJar('File-Date: x\n%%\nDescription: a\nDescription: b\n');
  assert.throws(() => one(jar.records[0]!, 'Description'), /repeats/);
});
