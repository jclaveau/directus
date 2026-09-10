import { describe, expect, it, vi } from 'vitest';
import { startServer } from '../server.js';
import cacheFlush from './commands/cache/flush.js';
import { createCli } from './index.js';

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
		const program = await createCli();
		program.exitOverride();

		await program.parseAsync(['start', '/x/ecosystem.config.cjs', 'start'], {
			from: 'user',
		});

		expect(vi.mocked(startServer)).toHaveBeenCalledOnce();
	});

	// A deploy step that changes data the cache is derived from calls this by name, so
	// the wiring is the contract; the command file alone passing proves nothing.
	it('exposes the flush as `cache flush`', async () => {
		const program = await createCli();
		program.exitOverride();

		await program.parseAsync(['cache', 'flush'], { from: 'user' });

		expect(vi.mocked(cacheFlush)).toHaveBeenCalledOnce();
	});
});
