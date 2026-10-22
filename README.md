# Code Lists

Generated Kanonak packages for governed reference data — language tags, licence identifiers, currencies, media types — projected from their sources of truth and published at `codes.kanonak.org`.

Every package here is produced by a plugin in `producers/`, never edited by hand. The contract (how a list is projected, versioned, and verified) is documented in the `code-lists` vocabulary on kanonak.org, which these packages are typed with.

| List | Source | Typed by (kanonak.org) |
|---|---|---|
| `language-tags` | IANA Language Subtag Registry (BCP 47) | `language-tag` |
| `media-types` | IANA Media Types registry | `media-type` |
| `spdx-licenses` | SPDX License List, licences and exceptions | `core-spdx` |
| `currencies` | ISO 4217, current and withdrawn | `currency` |

## Linking to an entry

A package refers to an entry by a link import, so the reference is versionless and a new version of a list changes no hash:

```yaml
imports:
  - publisher: codes.kanonak.org
    packages:
      - { package: language-tags, match: '*', version: 1.20260917.0, alias: lang, mode: link }
```

`lang.en` is then `codes.kanonak.org/language-tags/en`, and a code the list doesn't hold fails validation.

## Names

An entry is named by its code in lowercase, as the protocol names an instance, with anything a name cannot carry folded to `-`: `en`, `zh-hant`, `image-svg-xml`, `gpl-2-0-plus`, `usd`. Every code these lists hold is case-insensitive by its own standard, and the entry's `cl.code` keeps the code exactly as its source writes it. A code that cannot start a name takes its kind as a prefix (`license-0bsd`), and the language subtags that are only components of a tag are named by their type (`script-hant`, `region-us`, `extlang-yue`, `variant-1901`).

## Versions

A list's version is `1.{the day its source was published}.{the producer's revision}`, as in `1.20260917.0`. The source's own version marker is kept in the package's `CodeList` record, with the source's URL and the digest of the bytes read.

- **A list only adds entries.** A retired code stays, deprecated and pointing at its replacement, so every link to it keeps resolving. The runner refuses a new version that drops any name the newest version has, or that isn't later than it. So the major stays 1.
- **A correction is a new version.** A change to a producer that changes what it makes from a source revision already published raises the producer's `revision`, the last number.

## Making a new version

The `Code Lists` workflow runs only when someone starts it, and opens a pull request with whatever lists have a new source version. Locally:

```bash
cd producers && npm ci && npm run build && node dist/src/run.js language-tags
```

Each new file is projected twice to prove it is deterministic, and validated before it is written. A file that already exists is never rewritten: if the projection differs from it, the run fails for a person to decide.

## Licence

The producers are licensed under the Apache License 2.0 ([LICENSE](LICENSE)). The data in each list keeps its source's terms, set out in [NOTICE](NOTICE).
