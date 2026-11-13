---
name: wdi-libsql-data-integrity
description: Review or change World Bank WDI ingestion, economic calculations, ranking, SQLite/libSQL queries, caches, publication, or primary/fallback recovery in this repository. Use when a change can affect the provenance, units, coverage, consistency, or cost of an analytical result.
---

# WDI and libSQL data integrity

Treat World Bank WDI source 2 as the authority for raw observations. Treat the backend registry, transformation contracts, and fixture tests as the authority for how the application derives results. This skill governs data and calculation decisions when used alongside a UI or optimization skill.

1. Trace the exact indicator and entity through ingestion, storage, backend calculation, API response and display. Identify the requested years, actual coverage, unit and source vintage. Open [Data and measurement](references/data-and-measurement.md) for WDI, Compare, ranking or dimensional changes.
2. For query, cache or write work, start from the current SQL and measure an isolated baseline. Preserve values, units, null reasons, cohort membership and provenance. Open [Queries and publication](references/queries-and-publication.md).
3. For fallback, recovery, retries or verification, use [Recovery and verification](references/recovery-and-verification.md). Record what was exercised and which claims remain source-only.

Use isolated fixtures for any risky test. Never access production Turso, start a live refresh, run a migration, or perform destructive database activity without explicit authorization for the target and operation. A local fallback file does not authorize copying its content to primary or reconstructing primary from it. Keep credential values out of reads, logs, fixtures and reports. Report performance changes only with measurements and disclosed scope.
