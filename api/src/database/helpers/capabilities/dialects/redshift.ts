import type { Type } from '@directus/types';
import { CapabilitiesHelperPostgres } from './postgres.js';

export class CapabilitiesHelperRedshift extends CapabilitiesHelperPostgres {
	// Redshift has no jsonb, so no jsonb_populate_recordset.
	override supportsJsonBatchUpdate(): boolean {
		return false;
	}

	override jsonBatchUpdateTypes(): ReadonlySet<Type> {
		return new Set();
	}
}
