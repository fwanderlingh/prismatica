# Performance improvements

This pass replaces repeated array scans with indexes built for the current data
snapshot. It does not cache database state across requests or change decision rules,
checkout capacity, duplicate matching, vote thresholds, or queue ordering.

Changes:

- Screening, full-text and extraction queues index decisions/responses once.
- Randomized queue ordering computes each item's hash and pinned state once per sort.
- Server response preparation passes each item's decisions and checkouts to the
  existing workflow evaluators, instead of repeatedly scanning all records.
- Conflict calculations index decisions without changing their evaluation rules.
- Dedup candidate generation indexes studies before resolving candidate pairs.
- React retains project-derived lists while their inputs remain unchanged, so typing
  and unrelated UI updates do not invalidate the dependent queue calculations.
- Screening queue badges look up the reviewer's decision by study ID.

## Isolated measurements

Synthetic data: 4,000 studies/reports, 12,000 decisions, and 8,000 extraction
responses. Times are median milliseconds from three warm runs in this environment.
They measure local calculations only, not database queries, network transfer, or
browser rendering, and should not be interpreted as overall page-load speedups.

| Calculation | Before | After |
| --- | ---: | ---: |
| Title/abstract queue | 983 ms | 6 ms |
| Full-text queue | 1,002 ms | 6 ms |
| Extraction queue | 644 ms | 3 ms |
| Review counts | 373 ms | 6 ms |
| Server response preparation | 26,347 ms | 247 ms |

Dedup candidate generation on a separate 250-study fixture fell from 512 ms to
387 ms. Its similarity calculations are unchanged.

Before/after outputs were compared exactly on 24 fixtures covering different vote
thresholds, Maybe policies, blind mode, own decisions, checkout metadata and template
versions, as well as the 4,000-record fixture. Dedup recalculation preserved candidate
ordering and existing exclusion decisions. TypeScript, API authorization, audit and
progress regression checks also passed. No live database or application server was
used for these measurements.

## Remaining architectural work

`serverStore.ts` still invokes the PostgreSQL helper through `execFileSync`. The
helper opens a connection and runs schema initialization for each invocation.
Many mutations also rewrite complete state tables. These paths can block other
requests and dominate response time after the in-memory calculations improve.

Moving to asynchronous pooled database access and incremental transactions is a
separate change requiring concurrency, conflict, authorization, and rollback tests.
Large queues also still render all their rows; windowed rendering would require
checking selection, keyboard navigation, and accessibility carefully.
