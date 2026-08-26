-- Runs once on the postgres container's first init (docker-entrypoint-initdb.d).
-- timescaledb powers the directus_cache_stats_events hypertable + compression/retention
-- so the blackbox suite exercises the Timescale path, not just the plain table.
-- postgis is kept for the geometry test suite (the previous postgis image
-- created it automatically; the timescaledb-ha image does not).
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;
