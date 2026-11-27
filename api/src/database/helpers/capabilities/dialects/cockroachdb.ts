import type { Type } from '@directus/types';
import { CapabilitiesHelperPostgres } from './postgres.js';

export class CapabilitiesHelperCockroachDb extends CapabilitiesHelperPostgres {
	// TODO(#610): knex's json batch runs on cockroach, but the update batch has
	// not been tested there.
	override supportsJsonBatchUpdate(): boolean { // bb-out-of-scope: #610 non-Postgres
		return false;
	}

	override jsonBatchUpdateTypes(): ReadonlySet<Type> { // bb-out-of-scope: #610 non-Postgres
		return new Set();
	}

	// TODO(#610): FOR NO KEY UPDATE has not been tested on cockroach.
	override supportsNoKeyUpdateLock(): boolean { // bb-out-of-scope: #610 non-Postgres
		return false;
	}
}
