import config, { getUrl, paths } from '@common/config';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import type { Snapshot } from '@directus/types';
import { spawn } from 'child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// `directus schema diff` is the deploy step's read of the database against the
// snapshot the repository holds, and its exit code is the contract
// (jclaveau/directus#525). The unit tests mock the snapshot of the database and
// the diff; these run the built command against a real one, with the file
// layouts a deploy hands it: the snapshot `schema snapshot` writes, and the
// partial header plus one file per collection that directus-extension-schema-sync
// writes — which the extension declines to import when the hash it recorded still
// matches, so a collection file edited by hand is exactly what this command has
// to see through.

const COLLECTION = 'test_schema_diff_cli';

describe('`directus schema diff` reads the database against a snapshot file', () => {
	describe.each(vendors)('%s', (vendor) => {
		let snapshot: Snapshot;
		let directory: string;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: COLLECTION,
						meta: {},
						fields: [
							{ field: 'name', type: 'string', meta: {} },
							{ field: 'note', type: 'text', meta: {} },
						],
					},
				],
			});

			const response = await request(getUrl(vendor))
				.get('/schema/snapshot')
				.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`);

			expect(response.statusCode).toBe(200);
			snapshot = response.body.data;

			directory = await fs.mkdtemp(join(tmpdir(), `schema-diff-${vendor}-`));
		}, 60_000);

		afterAll(async () => {
			await DeleteCollection(vendor, { collection: COLLECTION });
			await fs.rm(directory, { recursive: true, force: true });
		});

		// Its own process, with the running node's env: the shell the command is
		// for, not an in-process call.
		function runSchemaDiff(
			file: string,
			args: string[] = [],
		): Promise<{ code: number | null; stdout: string; stderr: string }> {
			return new Promise((resolve) => {
				const cli = spawn(
					'node',
					[paths.cli, 'schema', 'diff', file, ...args],
					{
						cwd: paths.cwd,
						env: { ...config.envs[vendor], LOG_LEVEL: 'error' },
					},
				);

				let stdout = '';
				let stderr = '';

				cli.stdout.on('data', (chunk) => (stdout += String(chunk)));
				cli.stderr.on('data', (chunk) => (stderr += String(chunk)));

				cli.on('exit', (code) => resolve({ code, stdout, stderr }));
			});
		}

		async function writeJson(file: string, contents: unknown): Promise<string> {
			await fs.mkdir(join(file, '..'), { recursive: true });
			await fs.writeFile(file, JSON.stringify(contents, null, '\t'));

			return file;
		}

		// The extension's export: a header carrying the hash of what it exported,
		// and beside it one file per collection, fields and relations folded in
		// with their `collection` key stripped. A system collection appears only
		// through the custom fields it holds, with no meta of its own.
		async function writePartial(
			file: string,
			from: Snapshot,
			hash = 'as-exported',
		): Promise<string> {
			const { collections, fields, relations, ...header } = from;
			const folder = join(file, '..', 'schema');
			const byCollection = new Map<string, any>();

			for (const collection of collections) {
				byCollection.set(collection.collection, {
					...collection,
					fields: [],
					relations: [],
				});
			}

			for (const { collection, ...field } of fields) {
				if (!byCollection.has(collection)) {
					byCollection.set(collection, {
						collection,
						fields: [],
						relations: [],
					});
				}

				byCollection.get(collection).fields.push(field);
			}

			for (const { collection, ...relation } of relations) {
				byCollection.get(collection).relations.push(relation);
			}

			for (const [collection, contents] of byCollection) {
				await writeJson(join(folder, `${collection}.json`), contents);
			}

			return writeJson(file, { ...header, partial: true, hash });
		}

		it('exits 0 when the database matches the snapshot', async () => {
			const file = await writeJson(join(directory, 'match.json'), snapshot);

			const run = await runSchemaDiff(file);

			expect(run.stderr).toBe('');
			expect(run.stdout).toContain('Schema matches the snapshot');
			expect(run.code).toBe(0);
		});

		it('exits 1 and lists what applying the snapshot would change', async () => {
			const file = await writeJson(join(directory, 'drift.json'), {
				...snapshot,
				fields: snapshot.fields.filter((field) => {
					return field.collection !== COLLECTION || field.field !== 'note';
				}),
			});

			const run = await runSchemaDiff(file);

			expect(run.stdout).toContain('Schema differs from the snapshot:');
			expect(run.stdout).toContain(`Delete ${COLLECTION}.note`);
			expect(run.code).toBe(1);
		});

		it('says nothing under --quiet, the exit code carries it', async () => {
			const file = join(directory, 'drift.json');

			const run = await runSchemaDiff(file, ['--quiet']);

			expect(run.stdout).toBe('');
			expect(run.code).toBe(1);
		});

		it('reads the partial layout schema-sync writes, hash and all', async () => {
			const file = await writePartial(
				join(directory, 'partial', 'schema.json'),
				snapshot,
			);

			const run = await runSchemaDiff(file);

			expect(run.stderr).toBe('');
			expect(run.stdout).toContain('Schema matches the snapshot');
			expect(run.code).toBe(0);
		});

		it('sees a collection file edited by hand under the same hash', async () => {
			const file = join(directory, 'partial', 'schema.json');
			const folder = join(directory, 'partial', 'schema');
			const edited = join(folder, `${COLLECTION}.json`);
			const contents = JSON.parse(await fs.readFile(edited, 'utf8'));

			contents.fields = contents.fields.filter((field: any) => {
				return field.field !== 'note';
			});

			await writeJson(edited, contents);

			const run = await runSchemaDiff(file);

			expect(run.stdout).toContain(`Delete ${COLLECTION}.note`);
			expect(run.code).toBe(1);
		});

		it('exits 2 when no collection file sits beside the header', async () => {
			const file = await writePartial(
				join(directory, 'bare', 'schema.json'),
				snapshot,
			);

			await fs.rm(join(directory, 'bare', 'schema'), { recursive: true });
			await fs.mkdir(join(directory, 'bare', 'schema'));

			const run = await runSchemaDiff(file);

			expect(run.stderr).toContain('No collection files found in');
			expect(run.stdout).toBe('');
			expect(run.code).toBe(2);
		});

		it('exits 2 when the file is not shaped like a snapshot', async () => {
			const file = await writeJson(join(directory, 'malformed.json'), {
				version: 1,
				directus: 'x',
				fields: 'no',
			});

			const run = await runSchemaDiff(file);

			expect(run.stderr).toContain('"fields" must be an array');
			expect(run.code).toBe(2);
		});
	});
});
