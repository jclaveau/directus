import type {
	AbstractServiceOptions,
	Accountability,
	Snapshot,
	SnapshotDiff,
	SnapshotDiffWithHash,
	SnapshotWithHash,
} from '@directus/types';
import type { Knex } from 'knex';
import getDatabase from '../database/index.js';
import { ForbiddenError } from '@directus/errors';
import { applyDiff } from '../utils/apply-diff.js';
import { getSnapshotDiff } from '../utils/get-snapshot-diff.js';
import { getSnapshot } from '../utils/get-snapshot.js';
import { getVersionedHash } from '../utils/get-versioned-hash.js';
import { withMeta } from '../utils/read-meta.js';
import { validateApplyDiff } from '../utils/validate-diff.js';
import { validateSnapshot } from '../utils/validate-snapshot.js';

export class SchemaService {
	knex: Knex;
	accountability: Accountability | null;

	constructor(options: Omit<AbstractServiceOptions, 'schema'>) {
		this.knex = options.knex ?? getDatabase();
		this.accountability = options.accountability ?? null;
	}

	async snapshot(): Promise<Snapshot> {
		if (this.accountability?.admin !== true)
			throw new ForbiddenError({ reason: 'Only administrators can read a schema snapshot.' });

		const currentSnapshot = await getSnapshot({ database: this.knex });

		// A snapshot is the whole SCHEMA. Tag by the system collections it derives from,
		// so a schema mutation purges the response, not a business-row write.
		return withMeta(currentSnapshot, {
			scopedCacheTags: [
				{ collection: 'directus_collections' },
				{ collection: 'directus_fields' },
				{ collection: 'directus_relations' },
			],
		});
	}

	async apply(payload: SnapshotDiffWithHash): Promise<void> {
		if (this.accountability?.admin !== true)
			throw new ForbiddenError({ reason: 'Only administrators can apply a schema diff.' });

		const currentSnapshot = await this.snapshot();
		const snapshotWithHash = this.getHashedSnapshot(currentSnapshot);

		if (!validateApplyDiff(payload, snapshotWithHash)) return;

		await applyDiff(currentSnapshot, payload.diff, { database: this.knex });
	}

	async diff(
		snapshot: Snapshot,
		options?: { currentSnapshot?: Snapshot; force?: boolean },
	): Promise<SnapshotDiff | null> {
		if (this.accountability?.admin !== true)
			throw new ForbiddenError({ reason: 'Only administrators can diff the schema.' });

		validateSnapshot(snapshot, options?.force);

		const currentSnapshot = options?.currentSnapshot ?? (await getSnapshot({ database: this.knex }));
		const diff = getSnapshotDiff(currentSnapshot, snapshot);

		if (diff.collections.length === 0 && diff.fields.length === 0 && diff.relations.length === 0) {
			return null;
		}

		return diff;
	}

	getHashedSnapshot(snapshot: Snapshot): SnapshotWithHash {
		const snapshotHash = getVersionedHash(snapshot);

		return {
			...snapshot,
			hash: snapshotHash,
		};
	}
}
