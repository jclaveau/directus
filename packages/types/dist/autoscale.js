/**
 * What the process that resizes a PM2 pool is running on, and what it last
 * decided.
 *
 * Shared here because the autoscaler resolves this configuration in its own
 * process — beside the pool, not inside it — so the only honest answer to
 * "what is it scaling on right now" is the one that process reports.
 */
export {};
