import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { loadSnapshotFile } from './load-snapshot.js';

let directory: string;

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), 'load-snapshot-'));
});

afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

const header = {
	version: 1,
	directus: '11.10.1',
	vendor: 'postgres',
	collections: [],
	fields: [],
	relations: [],
};

async function write(name: string, contents: string | object) {
	const filename = path.join(directory, name);
	await fs.mkdir(path.dirname(filename), { recursive: true });

	await fs.writeFile(
		filename,
		typeof contents === 'string'
			? contents
			: JSON.stringify(contents),
	);

	return filename;
}

test('reads a whole JSON snapshot as is', async () => {
	const snapshot = { ...header, collections: [{ collection: 'a', meta: {} }] };
	const filename = await write('schema.json', snapshot);

	expect(await loadSnapshotFile(filename)).toEqual(snapshot);
});

// The extension's whole layout keeps its `hash` beside the snapshot, and its
// older one nested the snapshot under `snapshot`; neither key is a snapshot's.
test('drops the hash the extension writes beside a whole snapshot', async () => {
	const filename = await write('schema.json', { hash: 'abc', ...header });

	expect(await loadSnapshotFile(filename)).toEqual(header);
});

test('unwraps the older layout nesting the snapshot under `snapshot`', async () => {
	const filename = await write('schema.json', {
		hash: 'abc',
		snapshot: { ...header, collections: [{ collection: 'a', meta: {} }] },
	});

	expect(await loadSnapshotFile(filename)).toEqual({
		...header,
		collections: [{ collection: 'a', meta: {} }],
	});
});

test('reads a whole YAML snapshot as is', async () => {
	const filename = await write(
		'schema.yaml',
		'version: 1\ndirectus: 11.10.1\nvendor: postgres\n'
		+ 'collections:\n  - collection: a\nfields: []\nrelations: []\n',
	);

	expect(await loadSnapshotFile(filename)).toEqual({
		...header,
		collections: [{ collection: 'a' }],
	});
});

// The layout directus-extension-schema-sync writes: `schema.json` keeps the
// header, `schema/<collection>.json` keeps that collection with its fields and
// relations stripped of the `collection` they belong to.
test('stitches a partial header from the collection files beside it', async () => {
	const filename = await write('schema.json', { ...header, partial: true });

	await write('schema/articles.json', {
		collection: 'articles',
		meta: { scoped_cache_fields: ['author'] },
		schema: { name: 'articles' },
		fields: [{ field: 'id', type: 'integer' }],
		relations: [{ field: 'author', related_collection: 'directus_users' }],
	});

	await write('schema/directus_users.json', {
		collection: 'directus_users',
		meta: null,
		schema: null,
		fields: [{ field: 'nickname', type: 'string' }],
		relations: [],
	});

	await write('schema/notes.md', 'not a collection');

	expect(await loadSnapshotFile(filename)).toEqual({
		...header,
		collections: [
			{
				collection: 'articles',
				meta: { scoped_cache_fields: ['author'] },
				schema: { name: 'articles' },
			},
		],
		fields: [
			{ collection: 'articles', field: 'id', type: 'integer' },
			{ collection: 'directus_users', field: 'nickname', type: 'string' },
		],
		relations: [
			{
				collection: 'articles',
				field: 'author',
				related_collection: 'directus_users',
			},
		],
	});
});

// The extension refuses to import from an empty directory rather than read it as
// a snapshot with nothing in it; a diff that reported deleting everything would
// be answering a different question.
test('refuses a partial header with no collection file beside it', async () => {
	const filename = await write('schema.json', { ...header, partial: true });
	await fs.mkdir(path.join(directory, 'schema'));

	await expect(loadSnapshotFile(filename)).rejects.toThrowError(
		`No collection files found in ${path.join(directory, 'schema')}`,
	);
});

// `Object.assign({ collection }, field)` in the extension: a `collection` written
// in the file wins over the file's name, and the diff has to read what the
// import would.
test('lets a collection named in the file win over the file name', async () => {
	const filename = await write('schema.json', { ...header, partial: true });

	await write('schema/articles.json', {
		collection: 'articles',
		meta: {},
		schema: null,
		fields: [{ collection: 'pages', field: 'title', type: 'string' }],
		relations: [{ collection: 'pages', field: 'author' }],
	});

	const { fields, relations } = await loadSnapshotFile(filename);

	expect(fields).toEqual([{ collection: 'pages', field: 'title', type: 'string' }]);
	expect(relations).toEqual([{ collection: 'pages', field: 'author' }]);
});

test('stitches in the order of the file names, not of the directory', async () => {
	const filename = await write('schema.json', { ...header, partial: true });

	for (const name of ['c', 'a', 'b']) {
		await write(`schema/${name}.json`, {
			collection: name,
			meta: {},
			schema: null,
			fields: [],
			relations: [],
		});
	}

	const { collections } = await loadSnapshotFile(filename);

	expect(collections.map((item) => item.collection)).toEqual(['a', 'b', 'c']);
});
