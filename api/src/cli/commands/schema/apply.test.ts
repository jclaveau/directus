import { DiffKind, type Snapshot, type SnapshotDiff } from '@directus/types';
import inquirer from 'inquirer';
import { afterEach, expect, test, vi } from 'vitest';
import getDatabase, {
	isInstalled,
	validateDatabaseConnection,
} from '../../../database/index.js';
import { useLogger } from '../../../logger/index.js';
import { applySnapshot } from '../../../utils/apply-snapshot.js';
import { getSnapshotDiff } from '../../../utils/get-snapshot-diff.js';
import { getSnapshot } from '../../../utils/get-snapshot.js';
import { apply } from './apply.js';
import { loadSnapshotFile } from './load-snapshot.js';

vi.mock('inquirer');
vi.mock('../../../database/index.js');
vi.mock('../../../logger/index.js');
vi.mock('../../../utils/apply-snapshot.js');
vi.mock('../../../utils/get-snapshot-diff.js');
vi.mock('../../../utils/get-snapshot.js');
vi.mock('./load-snapshot.js');

const error = vi.fn();
const info = vi.fn();
const destroy = vi.fn();
const log = vi.spyOn(console, 'log').mockImplementation(() => {});

// A thrown exit stops the function the way the real one does, but the command
// exits from inside its `try`, so the catch reports it and exits again: the
// outcome is the first exit, the rejection only says the function stopped.
const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
	throw new Error(`exit:${code}`);
});

async function stops(run: Promise<void>, code: number) {
	await expect(run).rejects.toThrowError(/^exit:/);
	expect(exit).toHaveBeenNthCalledWith(1, code);
}

const snapshot = { version: 1 } as Snapshot;
const current = { version: 1, vendor: 'postgres' } as Snapshot;

function fieldDiff(): SnapshotDiff {
	return {
		collections: [],
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
	vi.mocked(useLogger).mockReturnValue(
		{ error, info } as unknown as ReturnType<typeof useLogger>,
	);

	vi.mocked(getDatabase).mockReturnValue(
		{ destroy } as unknown as ReturnType<typeof getDatabase>,
	);

	vi.mocked(validateDatabaseConnection).mockResolvedValue();
	vi.mocked(isInstalled).mockResolvedValue(true);
	vi.mocked(loadSnapshotFile).mockResolvedValue(snapshot);
	vi.mocked(getSnapshot).mockResolvedValue(current);
	vi.mocked(getSnapshotDiff).mockReturnValue(fieldDiff());
	vi.mocked(applySnapshot).mockResolvedValue();
}

mockAll();

afterEach(() => {
	vi.clearAllMocks();
	mockAll();
});

test('reads the snapshot through the shared loader', async () => {
	await stops(apply('data/schema.json', {
		yes: true,
		dryRun: false,
		ignoreRules: '',
	}), 0);

	expect(loadSnapshotFile).toHaveBeenCalledWith(
		`${process.cwd()}/data/schema.json`,
	);

	expect(applySnapshot).toHaveBeenCalledWith(snapshot, {
		current,
		diff: fieldDiff(),
		database: { destroy },
	});

	expect(info).toHaveBeenCalledWith('Snapshot applied successfully');
});

test('has nothing to apply once the ignored items are dropped', async () => {
	await stops(apply('snap.yaml', {
		yes: true,
		dryRun: false,
		ignoreRules: 'articles.title',
	}), 0);

	expect(info).toHaveBeenCalledWith('No changes to apply.');
	expect(applySnapshot).not.toHaveBeenCalled();
});

test('prints the listing and stops on a dry run', async () => {
	await stops(apply('snap.yaml', {
		yes: false,
		dryRun: true,
		ignoreRules: '',
	}), 0);

	const [message] = log.mock.calls[0]!;

	expect(message).toMatch(/^The following changes will be applied:\n\n/);
	expect(message).toContain('Create articles.title');
	expect(applySnapshot).not.toHaveBeenCalled();
});

test('asks with the listing and applies on a yes', async () => {
	vi.mocked(inquirer.prompt).mockResolvedValue({ proceed: true });

	await stops(apply('snap.yaml', {
		yes: false,
		dryRun: false,
		ignoreRules: '',
	}), 0);

	const [questions] = vi.mocked(inquirer.prompt).mock.calls[0]!;

	expect((questions as unknown as { message: string }[])[0]!.message)
		.toContain('Create articles.title');

	expect(applySnapshot).toHaveBeenCalledOnce();
});

test('exits 1 on a snapshot it cannot read', async () => {
	const failure = new Error('ENOENT');
	vi.mocked(loadSnapshotFile).mockRejectedValue(failure);

	await stops(apply('snap.yaml'), 1);

	expect(error).toHaveBeenCalledWith(failure);
	expect(destroy).toHaveBeenCalledOnce();
});
