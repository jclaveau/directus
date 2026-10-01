import { DiffKind, type Snapshot, type SnapshotDiff } from '@directus/types';
import { afterEach, expect, test, vi } from 'vitest';
import getDatabase, {
	isInstalled,
	validateDatabaseConnection,
} from '../../../database/index.js';
import { getSnapshotDiff } from '../../../utils/get-snapshot-diff.js';
import { getSnapshot } from '../../../utils/get-snapshot.js';
import { validateSnapshot } from '../../../utils/validate-snapshot.js';
import { drainStdout } from '../../utils/drain-stdout.js';
import schemaDiff from './diff.js';
import { loadSnapshotFile } from './load-snapshot.js';

vi.mock('../../../database/index.js');
vi.mock('../../../utils/get-snapshot-diff.js');
vi.mock('../../../utils/get-snapshot.js');
vi.mock('../../../utils/validate-snapshot.js');
vi.mock('../../utils/drain-stdout.js');
vi.mock('./load-snapshot.js');

const destroy = vi.fn();
const snapshot = { version: 1, directus: 'file' } as unknown as Snapshot;
const current = { version: 1, directus: 'database' } as unknown as Snapshot;
const log = vi.spyOn(console, 'log').mockImplementation(() => {});
const error = vi.spyOn(console, 'error').mockImplementation(() => {});

// The command's whole contract is its exit code, so the exit has to stop the
// function the way the real one does rather than run on into the next statement.
const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
	throw new Error(`exit:${code}`);
});

function collectionDiff(): SnapshotDiff {
	return {
		collections: [
			{
				collection: 'articles',
				diff: [
					{
						kind: DiffKind.EDIT,
						path: ['meta', 'scoped_cache_fields'],
						lhs: ['author'],
						rhs: ['author', 'course'],
					},
				],
			},
		],
		fields: [
			{
				collection: 'articles',
				field: 'title',
				diff: [{ kind: DiffKind.NEW, rhs: { field: 'title' } }],
			},
		],
		relations: [],
	} as unknown as SnapshotDiff;
}

function mockAll() {
	vi.mocked(getDatabase).mockReturnValue(
		{ destroy } as unknown as ReturnType<typeof getDatabase>,
	);

	vi.mocked(validateDatabaseConnection).mockResolvedValue();
	vi.mocked(isInstalled).mockResolvedValue(true);
	vi.mocked(loadSnapshotFile).mockResolvedValue(snapshot);
	vi.mocked(validateSnapshot).mockReturnValue();
	vi.mocked(getSnapshot).mockResolvedValue(current);

	vi.mocked(getSnapshotDiff).mockReturnValue({
		collections: [],
		fields: [],
		relations: [],
	});

	vi.mocked(drainStdout).mockResolvedValue();
}

mockAll();

afterEach(() => {
	vi.clearAllMocks();
	mockAll();
});

test('exits 0 and says so when the database matches the snapshot', async () => {
	await expect(schemaDiff('snap.json')).rejects.toThrowError('exit:0');

	expect(log).toHaveBeenCalledExactlyOnceWith('Schema matches the snapshot');
	expect(error).not.toHaveBeenCalled();
	expect(destroy).toHaveBeenCalledOnce();
});

// The listing says what the snapshot would set, so the database has to be the
// side the diff starts from.
test('diffs from the database towards the file', async () => {
	await expect(schemaDiff('snap.json')).rejects.toThrowError('exit:0');

	expect(getSnapshotDiff).toHaveBeenCalledExactlyOnceWith(current, snapshot);
});

test('checks the file has the shape of a snapshot, nothing more', async () => {
	await expect(schemaDiff('snap.json')).rejects.toThrowError('exit:0');

	expect(validateSnapshot).toHaveBeenCalledExactlyOnceWith(snapshot, true);
});

test('exits 1 and lists the changes when the database differs', async () => {
	vi.mocked(getSnapshotDiff).mockReturnValue(collectionDiff());

	await expect(schemaDiff('snap.json')).rejects.toThrowError('exit:1');

	const [listing] = log.mock.calls[0]!;

	expect(listing).toMatch(/^Schema differs from the snapshot:\n\n/);
	expect(listing).toContain('Update articles');
	expect(listing).toContain('Set scoped_cache_fields to author,course');
	expect(listing).toContain('Create articles.title');
	expect(error).not.toHaveBeenCalled();
});

test('exits with the code alone under --quiet', async () => {
	vi.mocked(getSnapshotDiff).mockReturnValue(collectionDiff());

	await expect(schemaDiff('snap.json', { quiet: true }))
		.rejects.toThrowError('exit:1');

	expect(log).not.toHaveBeenCalled();
});

test('drops the ignored collections and fields before deciding', async () => {
	vi.mocked(getSnapshotDiff).mockReturnValue(collectionDiff());

	await expect(schemaDiff('snap.json', { ignoreRules: 'articles' }))
		.rejects.toThrowError('exit:0');

	expect(log).toHaveBeenCalledExactlyOnceWith('Schema matches the snapshot');
});

test('resolves the path against the working directory', async () => {
	await expect(schemaDiff('data/schema.json')).rejects.toThrowError('exit:0');

	expect(loadSnapshotFile).toHaveBeenCalledWith(
		`${process.cwd()}/data/schema.json`,
	);
});

test('exits 2 when the snapshot cannot be read', async () => {
	const failure = new Error('ENOENT');
	vi.mocked(loadSnapshotFile).mockRejectedValue(failure);

	await expect(schemaDiff('snap.json')).rejects.toThrowError('exit:2');

	expect(error).toHaveBeenCalledExactlyOnceWith(failure);
	expect(log).not.toHaveBeenCalled();
	expect(destroy).toHaveBeenCalledOnce();
});

test('exits 2 when the file is not shaped like a snapshot', async () => {
	const failure = new Error('"fields" must be an array');

	vi.mocked(validateSnapshot).mockImplementation(() => {
		throw failure;
	});

	await expect(schemaDiff('snap.json')).rejects.toThrowError('exit:2');

	expect(error).toHaveBeenCalledExactlyOnceWith(failure);
	expect(getSnapshot).not.toHaveBeenCalled();
});

test('exits 2 on a database Directus is not installed on', async () => {
	vi.mocked(isInstalled).mockResolvedValue(false);

	await expect(schemaDiff('snap.json')).rejects.toThrowError('exit:2');

	expect(error).toHaveBeenCalledWith(
		expect.objectContaining({ message: expect.stringContaining('bootstrap') }),
	);

	expect(getSnapshot).not.toHaveBeenCalled();
});

// A deploy step reads the exit code off a piped stdout, which an immediate exit
// truncates.
test('drains stdout before every exit', async () => {
	await expect(schemaDiff('snap.json')).rejects.toThrowError('exit:0');

	expect(drainStdout).toHaveBeenCalledOnce();
	expect(exit).toHaveBeenCalledWith(0);
});
