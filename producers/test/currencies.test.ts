/**
 * The sample keeps: a row without a code (Antarctica), the euro under
 * several countries (deduplicated), fund codes (`CHE`, `CHW`, `USN`, `UYI`,
 * `UYW`), zero and three minor units, `N.A.` minor units, a withdrawn code
 * with several names (`HRK`), a withdrawn code that is current elsewhere
 * (`USD`-style overlap via the German/Austrian euro rows), a withdrawal
 * range (`1989 to 1990`), and a mojibake name from the source (`Bol�var`)
 * that must survive byte-for-byte.
 */
import { standardTests } from './harness.js';
import { currencies } from '../src/lists/currencies.js';

standardTests(currencies, { current: 'iso4217-list-one.sample.xml', historic: 'iso4217-list-three.sample.xml' }, 'currencies.sample.golden.yml', {
  sourceVersion: '2026-09-17',
  version: '1.20260917.0',
});
