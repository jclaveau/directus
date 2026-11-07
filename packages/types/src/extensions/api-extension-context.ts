import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { Accountability } from '../accountability.js';
import type { PrimaryKey } from '../items.js';
import type { PermissionsAction } from '../permissions.js';
import type { ScopedCacheExtensionHandle } from '../read-meta.js';
import type { ExtensionsServices } from '../services.js';
import type { SchemaOverview } from '../schema.js';

export type ExtensionAccessCheck = {
	accountability: Accountability;
	action: PermissionsAction;
	collection: string;
	primaryKeys?: PrimaryKey[];
	fields?: string[];
};

export type ApiExtensionContext = {
	services: ExtensionsServices;
	database: Knex;
	env: Record<string, any>;
	logger: Logger;
	getSchema: (options?: { database?: Knex; bypassCache?: boolean }, attempt?: number) => Promise<SchemaOverview>;
	scopedCache: ScopedCacheExtensionHandle;
	/** Throws the 403 a service would: a filter hook runs before that check. */
	validateAccess: (
		accessCheck: ExtensionAccessCheck,
		accessContext: { knex: Knex; schema: SchemaOverview },
	) => Promise<void>;
};
