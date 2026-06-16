import database_default from "../database/index.js";
import { applyDiff } from "../utils/apply-diff.js";
import { getSnapshotDiff } from "../utils/get-snapshot-diff.js";
import { getSnapshot } from "../utils/get-snapshot.js";
import { getVersionedHash } from "../utils/get-versioned-hash.js";
import { validateApplyDiff } from "../utils/validate-diff.js";
import { validateSnapshot } from "../utils/validate-snapshot.js";
import { ForbiddenError } from "@directus/errors";

//#region src/services/schema.ts
var SchemaService = class {
	knex;
	accountability;
	constructor(options) {
		this.knex = options.knex ?? database_default();
		this.accountability = options.accountability ?? null;
	}
	async snapshot() {
		if (this.accountability?.admin !== true) throw new ForbiddenError();
		return await getSnapshot({ database: this.knex });
	}
	async apply(payload, options) {
		if (this.accountability?.admin !== true) throw new ForbiddenError();
		const currentSnapshot = await this.snapshot();
		if (!validateApplyDiff(payload, this.getHashedSnapshot(currentSnapshot), options?.force)) return;
		await applyDiff(currentSnapshot, payload.diff, { database: this.knex });
	}
	async diff(snapshot, options) {
		if (this.accountability?.admin !== true) throw new ForbiddenError();
		validateSnapshot(snapshot, options?.force);
		const diff = getSnapshotDiff(options?.currentSnapshot ?? await getSnapshot({ database: this.knex }), snapshot);
		if (diff.collections.length === 0 && diff.fields.length === 0 && diff.relations.length === 0 && (!diff.systemFields || diff.systemFields.length === 0)) return null;
		return diff;
	}
	getHashedSnapshot(snapshot) {
		const snapshotHash = getVersionedHash(snapshot);
		return {
			...snapshot,
			hash: snapshotHash
		};
	}
};

//#endregion
export { SchemaService };