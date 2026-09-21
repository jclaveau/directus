import express from 'express';
import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { coreRootPaths } from '../../../core-mounts.js';
import getDatabase, {
	isInstalled,
	validateDatabaseConnection,
} from '../../../database/index.js';
import { getExtensionManager } from '../../../extensions/index.js';
import { useLogger } from '../../../logger/index.js';
import { drainStdout } from '../../utils/drain-stdout.js';
import edgeAllowList, { type AllowListOptions } from './allow-list.js';

// The version module reads its package.json through the same module
vi.mock('node:fs/promises', async (importOriginal) => {
	return { ...(await importOriginal<object>()), writeFile: vi.fn() };
});

vi.mock('../../../core-mounts.js');
vi.mock('../../../database/index.js');
vi.mock('../../../extensions/index.js');
vi.mock('../../../logger/index.js');
vi.mock('../../utils/drain-stdout.js');

const error = vi.fn();
const info = vi.fn();
const warn = vi.fn();
const destroy = vi.fn();
const initialize = vi.fn();
const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
	throw new Error(`exit:${code}`);
});

const endpointRouter = express.Router();

function options(overrides: Partial<AllowListOptions> = {}): AllowListOptions {
	return {
		format: 'railway',
		blockStatus: '404',
		include: [],
		exclude: [],
		...overrides,
	};
}

function printed(): string {
	return write.mock.calls.map(([chunk]) => String(chunk)).join('');
}

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue(
		{ error, info, warn } as unknown as ReturnType<typeof useLogger>,
	);

	vi.mocked(getDatabase).mockReturnValue(
		{ destroy } as unknown as ReturnType<typeof getDatabase>,
	);

	vi.mocked(getExtensionManager).mockReturnValue({
		initialize,
		getEndpointRouter: () => endpointRouter,
	} as unknown as ReturnType<typeof getExtensionManager>);

	vi.mocked(isInstalled).mockResolvedValue(true);
	vi.mocked(coreRootPaths).mockReturnValue(['/', '/admin', '/items', '/server']);

	endpointRouter.stack = [];
	endpointRouter.use('/studying', express.Router());
});

afterEach(() => {
	vi.clearAllMocks();
});

test('prints the core and extension roots as a Railway ruleset', async () => {
	await expect(edgeAllowList(undefined, options())).rejects.toThrow('exit:0');

	expect(initialize).toHaveBeenCalledExactlyOnceWith({
		schedule: false,
		watch: false,
	});

	expect(validateDatabaseConnection).toHaveBeenCalledOnce();

	const ruleset = JSON.parse(printed());

	expect(ruleset.rules).toHaveLength(2);

	expect(ruleset.rules[0].if.or.map((clause: { value: string }) => clause.value))
		.toEqual([
			'/',
			'/admin',
			'/admin/*',
			'/items',
			'/items/*',
			'/server',
			'/server/*',
			'/studying',
			'/studying/*',
		]);

	expect(ruleset.rules[1].then).toEqual({
		action: 'block',
		params: { status: 404 },
	});

	expect(drainStdout).toHaveBeenCalledOnce();
	expect(destroy).toHaveBeenCalledOnce();
	expect(warn).not.toHaveBeenCalled();
});

test('prints one sorted root per line, includes and excludes applied', async () => {
	const run = edgeAllowList(undefined, options({
		format: 'plain',
		include: ['/health', '/items'],
		exclude: ['/admin'],
	}));

	await expect(run).rejects.toThrow('exit:0');

	expect(printed()).toBe('/\n/health\n/items\n/server\n/studying\n');
});

test('writes the file instead of stdout when a path is given', async () => {
	vi.mocked(writeFile).mockResolvedValue();

	const run = edgeAllowList('out/rules.json', options({ format: 'plain' }));

	await expect(run).rejects.toThrow('exit:0');

	const filename = `${process.cwd()}/out/rules.json`;

	expect(writeFile).toHaveBeenCalledExactlyOnceWith(
		filename,
		'/\n/admin\n/items\n/server\n/studying\n',
	);

	expect(info).toHaveBeenCalledExactlyOnceWith(
		`Allow-list saved to ${filename}`,
	);

	expect(write).not.toHaveBeenCalled();
});

test('exits 1 when the file cannot be written', async () => {
	vi.mocked(writeFile).mockRejectedValue(new Error('EACCES'));

	const run = edgeAllowList('rules.json', options());

	await expect(run).rejects.toThrow('exit:1');

	expect(error).toHaveBeenCalledExactlyOnceWith(new Error('EACCES'));
	expect(write).not.toHaveBeenCalled();
});

test('says which extension route no prefix can stand for', async () => {
	const bundle = express.Router();

	bundle.get('/:pk', () => {});
	endpointRouter.use('/', bundle);

	const run = edgeAllowList(undefined, options({ format: 'plain' }));

	await expect(run).rejects.toThrow('exit:0');

	expect(warn).toHaveBeenCalledExactlyOnceWith(
		'An extension answers on any root path (/:pk); '
		+ 'no prefix stands for it, so the allow-list leaves it out',
	);

	expect(printed()).toBe('/\n/admin\n/items\n/server\n/studying\n');
});

test.each([
	['abc'],
	['200'],
	['500'],
	['404.5'],
])('refuses --block-status %s before touching the database', async (status) => {
	const run = edgeAllowList(undefined, options({ blockStatus: status }));

	await expect(run).rejects.toThrow('exit:2');

	expect(error).toHaveBeenCalledExactlyOnceWith(
		`--block-status must be a 4xx status, got "${status}"`,
	);

	expect(getDatabase).not.toHaveBeenCalled();
});

test('refuses a path that does not start with a slash', async () => {
	const run = edgeAllowList(undefined, options({
		include: ['/ok'],
		exclude: ['nope'],
	}));

	await expect(run).rejects.toThrow('exit:2');

	expect(error).toHaveBeenCalledExactlyOnceWith(
		'A path starts with "/", got "nope"',
	);

	expect(getDatabase).not.toHaveBeenCalled();
});

test('exits 1 when Directus is not installed', async () => {
	vi.mocked(isInstalled).mockResolvedValue(false);

	await expect(edgeAllowList(undefined, options())).rejects.toThrow('exit:1');

	expect(error).toHaveBeenCalledOnce();
	expect(error.mock.calls[0]![0].message).toMatch(/isn't installed/);
	expect(write).not.toHaveBeenCalled();
	expect(destroy).toHaveBeenCalledOnce();
	expect(exit).toHaveBeenCalledExactlyOnceWith(1);
});

test('exits 1 when the extensions fail to load', async () => {
	initialize.mockRejectedValue(new Error('boom'));

	await expect(edgeAllowList(undefined, options())).rejects.toThrow('exit:1');

	expect(error).toHaveBeenCalledExactlyOnceWith(new Error('boom'));
	expect(write).not.toHaveBeenCalled();
});
