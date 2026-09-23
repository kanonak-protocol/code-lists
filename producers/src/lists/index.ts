/** Every code list the runner knows. Adding a list = adding a definition here. */
import type { CodeListDefinition } from '../contract.js';
import { languageTags } from './languageTags.js';

export const LISTS: readonly CodeListDefinition[] = [languageTags];
