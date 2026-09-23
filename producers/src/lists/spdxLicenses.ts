/**
 * The `spdx-licenses` code list: the SPDX License List (licences and licence
 * exceptions) projected into a package typed by `core-spdx` 2.x.
 *
 * Two sources, `licenses.json` and `exceptions.json`, both stamped with the
 * same `licenseListVersion`; the projection refuses to combine two different
 * list versions. Entries are keyed by their SPDX identifier with `.` folded
 * to `-` and `+` to `-plus` (`Apache-2.0` → `Apache-2-0`, `GPL-2.0+` →
 * `GPL-2-0-plus`) — the same convention core-spdx 1.x used — and the three
 * identifiers that start with a digit (`0BSD`, `3D-Slicer-1.0`,
 * `389-exception`) take their kind as a prefix. `cl.code` always holds the
 * identifier verbatim.
 *
 * SPDX marks a retired identifier with `isDeprecatedLicenseId` but does not
 * name its successor, so a deprecated entry carries `owl.deprecated` alone.
 */
import { VOCABULARY_PUBLISHER, oneOrMany, resourceName, type CodeListDefinition, type Projection, type Snapshots, type SourceSpec } from '../contract.js';

interface SpdxLicense {
  licenseId: string;
  name: string;
  isDeprecatedLicenseId: boolean;
  isOsiApproved: boolean;
  isFsfLibre?: boolean;
  seeAlso: string[];
  detailsUrl: string;
  reference: string;
  referenceNumber: number;
}
interface SpdxException {
  licenseExceptionId: string;
  name: string;
  isDeprecatedLicenseId: boolean;
  seeAlso: string[];
  detailsUrl: string;
  reference: string;
  referenceNumber: number;
}
interface SpdxList<T> { licenseListVersion: string; releaseDate?: string; licenses?: T[]; exceptions?: T[] }

const KNOWN_LICENSE_FIELDS = new Set(['licenseId', 'name', 'isDeprecatedLicenseId', 'isOsiApproved', 'isFsfLibre', 'seeAlso', 'detailsUrl', 'reference', 'referenceNumber']);
const KNOWN_EXCEPTION_FIELDS = new Set(['licenseExceptionId', 'name', 'isDeprecatedLicenseId', 'seeAlso', 'detailsUrl', 'reference', 'referenceNumber']);
const REPLACE: readonly [RegExp, string][] = [[/\+/g, '-plus']];

function parseList<T>(text: string, what: string): SpdxList<T> {
  const parsed = JSON.parse(text) as SpdxList<T>;
  if (typeof parsed.licenseListVersion !== 'string') throw new Error(`spdx-licenses: ${what} has no licenseListVersion`);
  return parsed;
}

const licensesSource: SourceSpec = {
  key: 'licenses',
  label: 'SPDX License List — licenses',
  url: 'https://spdx.org/licenses/licenses.json',
  version: (text) => parseList(text, 'licenses.json').licenseListVersion,
};
const exceptionsSource: SourceSpec = {
  key: 'exceptions',
  label: 'SPDX License List — exceptions',
  url: 'https://spdx.org/licenses/exceptions.json',
  version: (text) => parseList(text, 'exceptions.json').licenseListVersion,
};

export const spdxLicenses: CodeListDefinition = {
  name: 'spdx-licenses',
  label: 'SPDX Licenses',
  sourceName: 'spdx-license-list',
  sourceLabel: 'SPDX License List',
  sources: [licensesSource, exceptionsSource],

  packageVersion(sourceVersion) {
    const parts = sourceVersion.split('.').map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
      throw new Error(`spdx-licenses: licenseListVersion ${sourceVersion} is not a version`);
    }
    const [major, minor, patch = 0] = parts;
    return `${major}.${minor}.${patch}`;
  },

  project(snapshots: Snapshots, ctx): Projection {
    const licenses = parseList<SpdxLicense>(snapshots.licenses!.text, 'licenses.json');
    const exceptions = parseList<SpdxException>(snapshots.exceptions!.text, 'exceptions.json');
    if (licenses.licenseListVersion !== exceptions.licenseListVersion) {
      throw new Error(`spdx-licenses: licenses.json is at ${licenses.licenseListVersion} but exceptions.json at ${exceptions.licenseListVersion}`);
    }
    const { book } = ctx;
    const spdx = book.ensure(VOCABULARY_PUBLISHER, 'core-spdx', '2.0.0', 'spdx');
    const cl = book.ensure(VOCABULARY_PUBLISHER, 'code-lists', '1.0.0', 'cl');
    const owl = book.ensure(VOCABULARY_PUBLISHER, 'core-owl', '2.2.0', 'owl');

    const body: Record<string, unknown> = {};
    const emit = (key: string, resource: Record<string, unknown>) => {
      if (body[key]) throw new Error(`spdx-licenses: duplicate resource name ${key}`);
      body[key] = resource;
    };

    const licenseList = licenses.licenses ?? [];
    for (const l of licenseList) {
      for (const field of Object.keys(l)) if (!KNOWN_LICENSE_FIELDS.has(field)) throw new Error(`spdx-licenses: unknown license field ${field}`);
      const resource: Record<string, unknown> = { type: `${spdx}.License`, label: l.name, [`${cl}.code`]: l.licenseId };
      if (l.isDeprecatedLicenseId) resource[`${owl}.deprecated`] = true;
      resource[`${spdx}.isOsiApproved`] = l.isOsiApproved;
      if (l.isFsfLibre !== undefined) resource[`${spdx}.isFsfLibre`] = l.isFsfLibre;
      const seeAlso = oneOrMany(l.seeAlso ?? []);
      if (seeAlso !== undefined) resource[`${spdx}.textUrl`] = seeAlso;
      resource[`${spdx}.detailsUrl`] = l.detailsUrl;
      emit(resourceName(l.licenseId, 'license', REPLACE), resource);
    }
    const exceptionList = exceptions.exceptions ?? [];
    for (const e of exceptionList) {
      for (const field of Object.keys(e)) if (!KNOWN_EXCEPTION_FIELDS.has(field)) throw new Error(`spdx-licenses: unknown exception field ${field}`);
      const resource: Record<string, unknown> = { type: `${spdx}.Exception`, label: e.name, [`${cl}.code`]: e.licenseExceptionId };
      if (e.isDeprecatedLicenseId) resource[`${owl}.deprecated`] = true;
      const seeAlso = oneOrMany(e.seeAlso ?? []);
      if (seeAlso !== undefined) resource[`${spdx}.textUrl`] = seeAlso;
      resource[`${spdx}.detailsUrl`] = e.detailsUrl;
      emit(resourceName(e.licenseExceptionId, 'exception', REPLACE), resource);
    }

    return {
      body,
      entryClasses: [`${spdx}.License`, `${spdx}.Exception`],
      entryCount: licenseList.length + exceptionList.length,
      header: {
        comment:
          `Every licence and licence exception on the SPDX License List at version ${ctx.sourceVersion}` +
          (licenses.releaseDate ? ` (released ${licenses.releaseDate.slice(0, 10)})` : '') +
          ` — ${licenseList.length} licences and ${exceptionList.length} exceptions. Generated by the spdx-licenses ` +
          `producer from the sources named in the spdx-license-list record; do not edit — a new list version is a ` +
          `new package version.`,
      },
    };
  },
};
