-- ============================================================
-- World Bank India GDP per capita ranking - schema
-- ============================================================
-- Design notes:
--  * Only valid, non-null observations are stored. Absence of a row means
--    "no stored observation". Missing data is NEVER stored as 0.
--  * Values are stored as SQLite REAL at full World Bank precision. Ranking,
--    YoY and tie-detection always read these raw values; rounding happens only
--    at presentation time in the UI.
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
  value           REAL    NOT NULL,        -- raw World Bank value, full precision
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
  status                  TEXT NOT NULL,   -- running | success | failed
  trigger                 TEXT,            -- boot | manual | ttl | script
  endpoint                TEXT,            -- API base URL used
  requested_start_year    INTEGER,
  requested_end_year      INTEGER,
  fetched_start_year      INTEGER,         -- may be start-1 so first-year YoY works
  fetched_end_year        INTEGER,
  indicators              TEXT,            -- comma separated indicator codes
  wb_last_updated         TEXT,            -- World Bank lastupdated
  countries_rows          INTEGER DEFAULT 0, -- metadata rows upserted
  rows_retrieved          INTEGER DEFAULT 0, -- observation rows seen with values
  rows_upserted           INTEGER DEFAULT 0, -- observation rows written
  rows_null_skipped       INTEGER DEFAULT 0, -- null observations skipped
  rows_aggregate_excluded INTEGER DEFAULT 0, -- aggregate rows excluded
  rows_blank_iso3_skipped INTEGER DEFAULT 0, -- blank ISO3 rows excluded
  rows_unknown_country    INTEGER DEFAULT 0, -- ISO3 not present in metadata
  error_message           TEXT
);

CREATE INDEX IF NOT EXISTS idx_fetch_runs_started ON fetch_runs (started_at DESC);