# postgis on alpine with timescaledb's libraries copied in: both extensions the
# suite creates, at a third of timescaledb-ha's pull. Both bases build the same
# PostgreSQL release on musl, and timescaledb links nothing beyond libc — keep the
# two PG versions equal when bumping either tag.
ARG TIMESCALEDB_VERSION=2.30.2

FROM timescale/timescaledb:${TIMESCALEDB_VERSION}-pg18 AS timescaledb

FROM postgis/postgis:18-3.6-alpine
ARG TIMESCALEDB_VERSION
COPY --from=timescaledb \
	/usr/local/lib/postgresql/timescaledb.so \
	/usr/local/lib/postgresql/timescaledb-${TIMESCALEDB_VERSION}.so \
	/usr/local/lib/postgresql/timescaledb-tsl-${TIMESCALEDB_VERSION}.so \
	/usr/local/lib/postgresql/
COPY --from=timescaledb \
	/usr/local/share/postgresql/extension/timescaledb.control \
	/usr/local/share/postgresql/extension/timescaledb--${TIMESCALEDB_VERSION}.sql \
	/usr/local/share/postgresql/extension/
CMD ["postgres", "-c", "shared_preload_libraries=timescaledb"]
