# Data pipeline

The application reads only reviewed, schema-valid files in `public/data`; it
never calls a source API in the browser. The first bounded Phase 3 adapter is
implemented for IPU Parline and covers all ten configured pilot countries.

## IPU pilot refresh

```sh
npm run data:refresh:ipu
npm run data:validate
```

The refresh command:

1. Reads canonical ISO alpha-2, alpha-3, and M49 identities from
   `config/pilot-countries.json`.
2. Calls the public, unauthenticated Parline API with timeouts, bounded retries,
   a descriptive user agent, pagination, and an explicit authentication error.
3. Fetches countries, parliaments, chambers, elections, political parties,
   people referenced as Speakers, and taxonomy metadata.
4. Saves raw snapshots to ignored `.cache/ipu` files for local review and
   repeatable generation.
5. Validates each IPU country join against all three configured identifiers.
6. Runs every pilot through the same normalizer. There are no country switches,
   party-name overrides, or country-specific editorial strings.
7. Replaces the parliamentary and expected-election slice of each profile while
   preserving government, relation, territory, and map sourcing.
8. Writes a sorted manifest with SHA-256 hashes for all ten profile files.

To reproduce output from the retained raw inputs without making network calls:

```sh
npm run data:refresh:ipu -- --from-cache
```

For a stable review timestamp and build ID:

```sh
npm run data:refresh:ipu -- \
  --from-cache \
  --retrieved-at=2026-09-19T00:00:00.000Z \
  --build-id=2026-09-19
```

Raw caches are deliberately not committed. The normalized public data includes
IPU attribution, licence, retrieval time, and terms URL.

## Canonical election rules

- `latestElection` is distinct from current chamber composition.
- Full renewals use the reported result as the post-election composition.
- Partial renewals use IPU's explicit “Full composition” breakdown when present,
  including IPU's standardized election-note list when its seat total matches the
  chamber size exactly.
- A partial renewal without that breakdown is marked `contested-seats-only` and
  never expanded from previous results.
- `nextExpectedElections` may contain one entry per national parliamentary
  chamber or renewal cycle. The IPU adapter emits no local or subnational events.
- Speaker and electoral-system fields are optional, structured, and rendered
  only when returned by IPU.

The remaining planned adapter order is:

1. UN M49 country identity mappings.
2. Referenced leader records with official-site overrides.
3. Official electoral-commission calendars for confirmed dates that complement
   rather than overwrite IPU's expected national renewals.
4. Foreign-ministry mission directories.

Review generated JSON and the manifest diff before opening a pull request. A
failed fetch must leave the last committed public data available.
