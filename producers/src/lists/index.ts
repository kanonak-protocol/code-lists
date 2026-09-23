/** Every code list the runner knows. Adding a list = adding a definition here. */
import type { CodeListDefinition } from '../contract.js';
import { languageTags } from './languageTags.js';
import { spdxLicenses } from './spdxLicenses.js';
import { mediaTypes } from './mediaTypes.js';
import { currencies } from './currencies.js';

export const LISTS: readonly CodeListDefinition[] = [languageTags, spdxLicenses, mediaTypes, currencies];
