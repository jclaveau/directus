import type { Type } from '@directus/types';
import { CapabilitiesHelperPostgres } from './postgres.js';

export class CapabilitiesHelperCockroachDb extends CapabilitiesHelperPostgres {
	// TODO(#610): knex's json batch runs on cockroach, but the update batch has
	// not been tested there.
	override supportsJsonBatchUpdate(): boolean {
		return false;
	}

	override jsonBatchUpdateTypes(): ReadonlySet<Type> {
		return new Set();
	}

	// TODO(#610): FOR NO KEY UPDATE has not been tested on cockroach.
	override supportsNoKeyUpdateLock(): boolean {
		return false;
	}
}
