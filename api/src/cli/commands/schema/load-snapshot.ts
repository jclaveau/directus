import type {
	ApiCollection,
	Snapshot,
	SnapshotField,
	SnapshotRelation,
} from '@directus/types';
import { parseJSON } from '@directus/utils';
import { promises as fs } from 'fs';
import { load as loadYaml } from 'js-yaml';
import path from 'path';

type CollectionFile = ApiCollection & {
	fields: Omit<SnapshotField, 'collection'>[];
	relations: Omit<SnapshotRelation, 'collection'>[];
};

/**
 * Read a snapshot the way `schema apply` takes one, and also the split layout
 * directus-extension-schema-sync writes: a header file whose `partial` flag says
 * the collections live one per file in the directory of the same name beside it
 * (`data/schema.json` → `data/schema/<collection>.json`), stitched by the rule
 * that extension applies them with.
 */
export async function loadSnapshotFile(filename: string): Promise<Snapshot> {
	const parsed = (await readSnapshotFile(filename)) as Snapshot & {
		partial?: boolean;
	};

	if (parsed.partial !== true) {
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

	for (const entry of (await fs.readdir(directory)).sort()) {
		if (!entry.endsWith('.json')) {
			continue;
		}

		const file = await readSnapshotFile(path.join(directory, entry));
		const { fields, relations, ...collection } = file as CollectionFile;

		// A file with no meta is a system collection carrying only custom fields
		if (collection.meta) {
			snapshot.collections.push(collection);
		}

		for (const field of fields) {
			snapshot.fields.push({ ...field, collection: collection.collection });
		}

		for (const relation of relations) {
			snapshot.relations.push({
				...relation,
				collection: collection.collection,
			});
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
