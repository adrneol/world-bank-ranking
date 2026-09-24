-- ============================================================
-- World Bank India GDP per capita ranking - schema
-- ============================================================
-- Design notes:
--  * Only valid, non-null observations are stored. Absence of a row means
--    "no stored observation". Missing data is NEVER stored as 0.
--  * Values are stored as SQLite REAL (IEEE-754 double, the queryable numeric
--    used for ORDER BY / range scans) AND as value_raw TEXT (the canonical
--    decimal string of the accepted value, for audit/reproducibility).
--    Ranking, YoY and tie-detection always read the REAL numeric values;
--    rounding happens only at presentation time in the UI.
--    Limitation, documented honestly: the World Bank API returns JSON numbers,
--    which JSON.parse converts to IEEE-754 doubles before application code
--    sees them. Digits beyond double precision cannot be recovered without a
--    lossless JSON parser; value_raw therefore preserves the canonical
--    post-parse decimal (round-trip stable: Number(value_raw) === value),
--    not necessarily the original lexical bytes on the wire.
--  * `countries.is_aggregate` carries the single, centrally computed verdict on
--    whether an entity may participate in a ranking.

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- countries: World Bank country/economy metadata
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS countries (
  id            TEXT PRIMARY KEY,          -- World Bank 3-letter code (metadata id)
  iso2          TEXT,                      -- World Bank iso2Code
  iso3          TEXT,                      -- Same as id for real countries; kept explicit
  name          TEXT NOT NULL,             -- World Bank entity name
  region        TEXT,                      -- World Bank region value
  region_id     TEXT,                      -- World Bank region id ("NA" for aggregates)
  admin_region  TEXT,                      -- World Bank adminregion value
  income_level  TEXT,                      -- World Bank incomeLevel value
  lending_type  TEXT,                      -- World Bank lendingType value
  capital_city  TEXT,
  is_aggregate  INTEGER NOT NULL DEFAULT 0,-- 1 = must never be ranked
  aggregate_reason TEXT,                   -- why it was flagged as an aggregate
  updated_at    TEXT NOT NULL              -- ISO-8601 timestamp of last metadata write
);

CREATE INDEX IF NOT EXISTS idx_countries_is_aggregate ON countries (is_aggregate);
CREATE INDEX IF NOT EXISTS idx_countries_iso3         ON countries (iso3);

-- ------------------------------------------------------------
-- indicators: the four World Bank WDI indicator series
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS indicators (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,        -- e.g. NY.GDP.PCAP.CD
  metric_key  TEXT NOT NULL UNIQUE,        -- e.g. nominal_current
  name        TEXT,                        -- World Bank indicator name
  unit        TEXT,                        -- e.g. "current US$"
  source      TEXT,                        -- e.g. "World Development Indicators"
  source_note TEXT,
  updated_at  TEXT NOT NULL
);

-- ------------------------------------------------------------
-- observations: raw World Bank country-year values
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS observations (
  country_id      TEXT    NOT NULL,
  indicator_id    INTEGER NOT NULL,
  year            INTEGER NOT NULL,
  value           REAL    NOT NULL,        -- queryable numeric (IEEE-754 double)
  value_raw       TEXT,                   -- canonical decimal string of the accepted value
  wb_last_updated TEXT,                    -- API lastupdated for this payload
  fetched_at      TEXT    NOT NULL,        -- when this row was retrieved
  PRIMARY KEY (country_id, indicator_id, year),
  FOREIGN KEY (country_id)   REFERENCES countries (id)  ON DELETE CASCADE,
  FOREIGN KEY (indicator_id) REFERENCES indicators (id) ON DELETE CASCADE
);

-- Supports "all eligible values for indicator X in year Y, sorted".
CREATE INDEX IF NOT EXISTS idx_observations_ind_year_value
  ON observations (indicator_id, year, value DESC);
CREATE INDEX IF NOT EXISTS idx_observations_country
  ON observations (country_id, indicator_id, year);

-- ------------------------------------------------------------
-- fetch_runs: audit trail of every World Bank ingestion
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fetch_runs (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at              TEXT NOT NULL,
  completed_at            TEXT,
  status                  TEXT NOT NULL,   -- running | success | partial | failed
                                   -- 'partial' is an ATTEMPT status (some indicators
                                   -- failed): it publishes nothing and never describes
                                   -- the active dataset. Only 'success' runs publish.
  trigger                 TEXT,            -- boot | manual | ttl | script
  endpoint                TEXT,            -- API base URL used
  requested_start_year    INTEGER,
  requested_end_year      INTEGER,
  fetched_start_year      INTEGER,         -- may be start-1 so first-year YoY works
  fetched_end_year        INTEGER,
  indicators              TEXT,            -- comma separated indicator codes
  wb_last_updated         TEXT,            -- World Bank lastupdated
  countries_rows          INTEGER DEFAULT 0, -- metadata rows upserted
  rows_retrieved          INTEGER DEFAULT 0, -- observation rows RECEIVED from the API
  rows_upserted           INTEGER DEFAULT 0, -- observation rows written
  rows_null_skipped       INTEGER DEFAULT 0, -- null observations skipped
  rows_aggregate_excluded INTEGER DEFAULT 0, -- aggregate entities excluded
  rows_blank_iso3_skipped INTEGER DEFAULT 0, -- blank ISO3 rows excluded
  rows_unknown_country    INTEGER DEFAULT 0, -- ISO3 not present in metadata
  -- Added by the counter-separation fix: every meaning keeps its own column.
  rows_with_value         INTEGER DEFAULT 0, -- rows that carried a usable number
  rows_non_finite_skipped INTEGER DEFAULT 0, -- rows whose value was not finite
  rows_invalid_year       INTEGER DEFAULT 0, -- rows without a usable year
  pages_fetched           INTEGER DEFAULT 0, -- World Bank pages fetched
  requests                INTEGER DEFAULT 0, -- HTTP requests issued
  universe_snapshot       TEXT,              -- JSON: eligible/aggregate entity ids
  error_message           TEXT
);

CREATE INDEX IF NOT EXISTS idx_fetch_runs_started ON fetch_runs (started_at DESC);

-- ------------------------------------------------------------
-- ingest_year_stats: per-run, per-metric, PER-YEAR ingest counters.
-- ------------------------------------------------------------
-- Why this table exists:
-- The coverage explanation required by the specification ("Why does the total
-- change?") must distinguish observation coverage from aggregate filtering using
-- FACTS only. A single per-run total cannot show which years lost rows to the
-- universe rule, so the ingest records the split per year and per metric here.
-- Rows are only ever written for a run that actually fetched that year.
CREATE TABLE IF NOT EXISTS ingest_year_stats (
  fetch_run_id            INTEGER NOT NULL,
  metric_key              TEXT    NOT NULL,
  indicator_code          TEXT    NOT NULL,
  year                    INTEGER NOT NULL,
  rows_received           INTEGER NOT NULL DEFAULT 0, -- all rows returned for that year
  rows_with_value         INTEGER NOT NULL DEFAULT 0, -- rows carrying a usable number
  rows_written            INTEGER NOT NULL DEFAULT 0, -- rows stored in observations
  rows_null_skipped       INTEGER NOT NULL DEFAULT 0,
  rows_non_finite_skipped INTEGER NOT NULL DEFAULT 0,
  rows_invalid_year       INTEGER NOT NULL DEFAULT 0,
  rows_blank_iso3_skipped INTEGER NOT NULL DEFAULT 0,
  rows_aggregate_excluded INTEGER NOT NULL DEFAULT 0,
  rows_unknown_country    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fetch_run_id, metric_key, year),
  FOREIGN KEY (fetch_run_id) REFERENCES fetch_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ingest_year_stats_metric_year
  ON ingest_year_stats (metric_key, year);

-- ------------------------------------------------------------
-- refresh_locks: SQLite-backed cross-process refresh mutex.
-- ------------------------------------------------------------
-- Why this table exists:
-- The previous process-level boolean only protected one Node process. Two
-- `node` processes (or a server plus a CLI ingest) could overlap. This table
-- holds a single row (id = 1). Acquiring the lock is one atomic UPDATE that
-- succeeds only when locked = 0, so exactly one holder wins even across
-- processes. The in-memory flag is kept as a fast path; the table is the
-- authority. A stale row (locked = 1 with no live holder, e.g. after a crash)
-- is recovered by `releaseStaleRefreshLock` / server boot reset, which is
-- recorded rather than silent.
CREATE TABLE IF NOT EXISTS refresh_locks (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  locked     INTEGER NOT NULL DEFAULT 0,  -- 0 = free, 1 = held
  run_id     INTEGER,                      -- fetch_runs id of the holder, if any
  holder     TEXT,                         -- human-readable holder (trigger/hostpid)
  updated_at TEXT    NOT NULL
);

INSERT OR IGNORE INTO refresh_locks (id, locked, updated_at)
  VALUES (1, 0, datetime('now'));