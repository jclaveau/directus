export type Driver = 'mysql2' | 'pg' | 'cockroachdb' | 'sqlite3';
export declare const DatabaseClients: readonly ["mysql", "postgres", "cockroachdb", "sqlite", "redshift"];
export type DatabaseClient = (typeof DatabaseClients)[number];
