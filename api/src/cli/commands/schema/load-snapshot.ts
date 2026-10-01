import type {
	ApiCollection,
	Snapshot,
	SnapshotField,
	SnapshotRelation,
} from '@directus/types';
import { parseJSON } from '@directus/utils';
import { promises as fs } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import path from 'node:path';

// The exporter strips `collection` off every field and relation; a hand edit
// may have put one back
type CollectionFile = ApiCollection & {
	fields: (Omit<SnapshotField, 'collection'> & { collection?: string })[];
	relations: (Omit<SnapshotRelation, 'collection'> & { collection?: string })[];
};

type SnapshotFile = Snapshot & {
	partial?: boolean;
	hash?: string;
	snapshot?: SnapshotFile;
};

/**
 * Read a snapshot the way `schema apply` takes one, and also the layouts
 * directus-extension-schema-sync writes: a whole snapshot carrying its `hash`, an
 * older one nested under `snapshot`, or a header whose `partial` flag says the
 * collections live one per file in the directory of the same name beside it
 * (`data/schema.json` → `data/schema/<collection>.json`), stitched by the rule
 * that extension applies them with.
 */
export async function loadSnapshotFile(filename: string): Promise<Snapshot> {
	const file = (await readSnapshotFile(filename)) as SnapshotFile;
	const { partial, hash: _hash, ...parsed } = file.snapshot ?? file;

	if (partial !== true) {
		return parsed;
	}

	const snapshot: Snapshot = {
		version: parsed.version,
		directus: parsed.directus,
		collections: [],
		fields: [],
		relations: [],
	};

	if (parsed.vendor) {
		snapshot.vendor = parsed.vendor;
	}

	const directory = path.join(
		path.dirname(filename),
		path.basename(filename, path.extname(filename)),
	);

	const entries = (await fs.readdir(directory))
		.filter((entry) => entry.endsWith('.json'))
		.sort();

	if (entries.length === 0) {
		throw new Error(`No collection files found in ${directory}`);
	}

	for (const entry of entries) {
		const file = await readSnapshotFile(path.join(directory, entry));
		const { fields, relations, ...collection } = file as CollectionFile;

		// A file with no meta is a system collection carrying only custom fields
		if (collection.meta) {
			snapshot.collections.push(collection);
		}

		// The extension lets a `collection` written in the file win over the file's
		// name, so a hand edit that names another collection diffs as it would import
		for (const field of fields) {
			snapshot.fields.push(
				Object.assign({ collection: collection.collection }, field),
			);
		}

		for (const relation of relations) {
			snapshot.relations.push(
				Object.assign({ collection: collection.collection }, relation),
			);
		}
	}

	return snapshot;
}

async function readSnapshotFile(filename: string): Promise<unknown> {
	const contents = await fs.readFile(filename, 'utf8');

	if (filename.endsWith('.yaml') || filename.endsWith('.yml')) {
		return loadYaml(contents);
	}

	return parseJSON(contents);
}
