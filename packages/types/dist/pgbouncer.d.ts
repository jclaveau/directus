/**
 * The live pgbouncer report behind Settings → PgBouncer: one entry per admin
 * endpoint, each carrying the pools it fronts and, on demand, the client and
 * server connections inside them.
 *
 * Shared here so the API producer and the app view can't drift.
 */
/** Which parts of an instance the report carries, per the `details` query. */
export type PgBouncerDetail = 'pools' | 'clients' | 'servers' | 'stats' | 'limits';
/**
 * One pool: a pgbouncer database served to one user. `SHOW POOLS` lists a pool
 * only once it has been used, so a configured-but-idle database is carried too,
 * with zero counts — a tier that has never taken traffic is worth seeing.
 */
export interface PgBouncerPool {
    /** The pgbouncer database name, which is what a client connects to. */
    database: string;
    user: string;
    poolMode: string | null;
    clientsActive: number;
    clientsWaiting: number;
    serversActive: number;
    serversIdle: number;
    serversUsed: number;
    serversLogin: number;
    /** How long the oldest waiting client has waited, in ms. */
    maxWaitMs: number;
    /** The database's own `pool_size`, `null` when it defaults globally. */
    poolSize: number | null;
    reservePoolSize: number | null;
    paused: boolean;
    disabled: boolean;
    /** Registry connection names that route to this database. */
    connections: string[];
}
/** One client connection, as pgbouncer sees it. */
export interface PgBouncerClient {
    database: string;
    user: string;
    state: string;
    addr: string;
    port: number;
    /** What the client called itself; Directus stamps node and connection. */
    applicationName: string;
    /**
     * pgbouncer's own `wait`, in ms: how long this client's current request has
     * been outstanding. For a waiting client that is the queue wait the docs
     * describe; on 1.25 an active one reports how long its query has been running.
     */
    waitMs: number;
    connectedAt: string;
    tls: string;
    /** `true` while the client holds a server connection. */
    linked: boolean;
}
/** One server connection, i.e. one real Postgres backend. */
export interface PgBouncerServer {
    database: string;
    user: string;
    state: string;
    addr: string;
    port: number;
    connectedAt: string;
    tls: string;
    /** The backend's pid, which is what `pg_stat_activity` is keyed by. */
    remotePid: number | null;
}
/** Cumulative and averaged counters for one database, from `SHOW STATS`. */
export interface PgBouncerStats {
    database: string;
    totalXactCount: number;
    totalQueryCount: number;
    totalReceivedBytes: number;
    totalSentBytes: number;
    totalWaitTimeUs: number;
    avgXactCount: number;
    avgQueryCount: number;
    avgQueryTimeUs: number;
    avgWaitTimeUs: number;
}
/**
 * One setting from `SHOW CONFIG`. Only the handful that explain a queueing pool
 * is carried — this page reports live state, it is not a config browser.
 */
export interface PgBouncerLimit {
    key: string;
    value: string;
    default: string;
    isDefault: boolean;
}
/**
 * One admin endpoint. An endpoint that could not be read reports why instead of
 * failing the whole request — one unreachable pooler must not blank the page.
 */
export interface PgBouncerInstance {
    /** `host:port`, which is what makes an endpoint one instance. */
    id: string;
    host: string;
    port: number;
    /** Registry connection names whose traffic goes through this endpoint. */
    connections: string[];
    reachable: boolean;
    error: string | null;
    version: string | null;
    pools: PgBouncerPool[];
    clients: PgBouncerClient[];
    servers: PgBouncerServer[];
    stats: PgBouncerStats[];
    limits: PgBouncerLimit[];
}
export interface PgBouncerReport {
    collectedAt: number;
    details: PgBouncerDetail[];
    instances: PgBouncerInstance[];
}
