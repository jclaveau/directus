import { describe, expect, it, vi } from 'vitest';
import { startServer } from '../server.js';
import cacheFlush from './commands/cache/flush.js';
import { createCli } from './index.js';
import { loadExtensions } from './load-extensions.js';

vi.mock('directus/version', () => ({ version: '0.0.0' }));
vi.mock('./load-extensions.js', () => ({ loadExtensions: vi.fn() }));
vi.mock('../emitter.js', () => ({ default: { emitInit: vi.fn() } }));
vi.mock('../server.js', () => ({ startServer: vi.fn() }));
vi.mock('./commands/cache/flush.js', () => ({ default: vi.fn() }));

describe('createCli', () => {
	// pm2 cluster mode appends the ecosystem path and a duplicated `start` to the
	// worker argv; the start command must swallow those excess positionals instead of
	// letting commander 14 reject them and crash the boot.
	it('start tolerates the excess argv pm2 cluster injects', async () => {
		const program = await createCli(['start']);
		program.exitOverride();

		await program.parseAsync(['start', '/x/ecosystem.config.cjs', 'start'], {
			from: 'user',
		});

		expect(vi.mocked(startServer)).toHaveBeenCalledOnce();
	});

	// A deploy step that changes data the cache is derived from calls this by name, so
	// the wiring is the contract; the command file alone passing proves nothing.
	it('exposes the flush as `cache flush`', async () => {
		const program = await createCli(['cache', 'flush']);
		program.exitOverride();

		await program.parseAsync(['cache', 'flush'], { from: 'user' });

		expect(vi.mocked(cacheFlush)).toHaveBeenCalledOnce();
	});

	// The gate the autoscaler is for: a loop reading the supervisor once a second
	// would otherwise carry every api-side extension the deployment ships, loaded
	// behind a database round trip it has no other reason to make.
	it.each([
		['autoscale'],
		['start'],
		['database', 'migrate:latest'],
		['schema', 'apply', 'snapshot.yaml'],
		['count', 'articles'],
	])('leaves the extensions alone for %s', async (...argv) => {
		vi.mocked(loadExtensions).mockClear();

		await createCli(argv);

		expect(vi.mocked(loadExtensions)).not.toHaveBeenCalled();
	});

	// An argument naming nothing this file declares is the one shape that can only
	// have come from an extension's `cli.before` hook, and the listing has to carry
	// whatever those registered whether or not one was asked for.
	it.each([
		[[]],
		[['--help']],
		[['-v']],
		[['whatever-an-extension-registered']],
		[['--verbose', 'whatever-an-extension-registered']],
	])('loads the extensions for %j', async (argv) => {
		vi.mocked(loadExtensions).mockClear();

		await createCli(argv);

		expect(vi.mocked(loadExtensions)).toHaveBeenCalledOnce();
	});

	// A flag in front of the command must not be read as the command — every
	// process would load the extensions again, which is the cost being gated.
	it('reads the command past the flags in front of it', async () => {
		vi.mocked(loadExtensions).mockClear();

		await createCli(['--some-option', 'autoscale']);

		expect(vi.mocked(loadExtensions)).not.toHaveBeenCalled();
	});
});
