export type Driver = 'mysql2' | 'pg' | 'cockroachdb' | 'sqlite3';

export const DatabaseClients = [
	'mysql',
	'postgres',
	'cockroachdb',
	'sqlite',
	'redshift',
] as const;
export type DatabaseClient = (typeof DatabaseClients)[number];
