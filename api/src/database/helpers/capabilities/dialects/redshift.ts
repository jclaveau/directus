import type { Type } from '@directus/types';
import { CapabilitiesHelperPostgres } from './postgres.js';

export class CapabilitiesHelperRedshift extends CapabilitiesHelperPostgres {
	// Redshift has no jsonb, so no jsonb_populate_recordset.
	override supportsJsonBatchUpdate(): boolean { // bb-out-of-scope: #610 non-Postgres
		return false;
	}

	override jsonBatchUpdateTypes(): ReadonlySet<Type> { // bb-out-of-scope: #610 non-Postgres
		return new Set();
	}
}
