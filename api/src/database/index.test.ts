import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnv, state } = vi.hoisted(() => {
	return {
		mockEnv: {} as Record<string, any>,
		state: {
			coreFiles: [] as string[],
			customFiles: [] as string[],
			customExists: false,
			completed: [] as { version: string }[],
			readdirFails: false,
			selectFails: false,
		},
	};
});

vi.mock('@directus/env', () => {
	return { useEnv: () => mockEnv };
});

vi.mock('knex', () => {
	return {
		default: {
			default: () => {
				return {
					client: { constructor: { name: 'Client_PG' } },
					on: vi.fn(function (this: unknown) {
						return this;
					}),
					select: () => {
						return {
							from: () => {
								if (state.selectFails) {
									return Promise.reject(new Error('pool exhausted'));
								}

								return Promise.resolve(state.completed);
							},
						};
					},
				};
			},
		},
	};
});

vi.mock('../logger/index.js', () => {
	return {
		useLogger: () => {
			return { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
		},
	};
});

vi.mock('../metrics/index.js', () => {
	return { useMetrics: () => undefined };
});

vi.mock('../utils/node-id.js', () => {
	return { nodeId: 'testnode' };
});

vi.mock('../extensions/lib/get-extensions-path.js', () => {
	return { getExtensionsPath: () => '/extensions' };
});

vi.mock('fs-extra', () => {
	return {
		default: {
			readdir: async (target: string) => {
				if (state.readdirFails) {
					throw new Error('ENOENT');
				}

				if (target.startsWith('/extensions')) {
					return state.customFiles;
				}

				return state.coreFiles;
			},
			pathExists: async () => state.customExists,
		},
	};
});

async function loadDatabase() {
	vi.resetModules();
	return await import('./index.js');
}

function resetState() {
	mockEnv['DB_CLIENT'] = 'pg';
	mockEnv['DB_CONNECTION_STRING'] = 'postgres://localhost/directus';
	state.coreFiles = ['20990101A-first.js', '20990102A-second.js'];
	state.customFiles = [];
	state.customExists = false;
	state.completed = [];
	state.readdirFails = false;
	state.selectFails = false;
}

describe('outstandingMigrations', () => {
	beforeEach(resetState);

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('names the versions the database has not recorded', async () => {
		state.completed = [{ version: '20990101A' }];

		const { outstandingMigrations } = await loadDatabase();

		expect(await outstandingMigrations()).toEqual(['20990102A']);
	});

	it('names nothing once every version is recorded', async () => {
		state.completed = [{ version: '20990101A' }, { version: '20990102A' }];

		const { outstandingMigrations } = await loadDatabase();

		expect(await outstandingMigrations()).toEqual([]);
	});

	it('counts the migrations staged in the extensions path too', async () => {
		state.customExists = true;
		state.customFiles = ['20990103A-custom.js'];
		state.completed = [{ version: '20990101A' }, { version: '20990102A' }];

		const { outstandingMigrations } = await loadDatabase();

		expect(await outstandingMigrations()).toEqual(['20990103A']);
	});

	it('ignores the runner and its type declarations', async () => {
		state.coreFiles = ['run.js', 'run.d.ts', '20990101A-first.js'];

		const { outstandingMigrations } = await loadDatabase();

		expect(await outstandingMigrations()).toEqual(['20990101A']);
	});

	it('exits when the migrations directory cannot be read', async () => {
		state.readdirFails = true;

		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exited');
		});

		const { outstandingMigrations } = await loadDatabase();

		await expect(outstandingMigrations()).rejects.toThrow('exited');
		expect(exit).toHaveBeenCalledWith(1);
	});

	it('lets a database error reach the caller so the watch can retry', async () => {
		state.selectFails = true;

		const { outstandingMigrations } = await loadDatabase();

		await expect(outstandingMigrations()).rejects.toThrow('pool exhausted');
	});
});

describe('validateMigrations', () => {
	beforeEach(() => {
		resetState();
		state.coreFiles = ['20990101A-first.js'];
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('is true when the database has recorded every version', async () => {
		state.completed = [{ version: '20990101A' }];

		const { validateMigrations } = await loadDatabase();

		expect(await validateMigrations()).toBe(true);
	});

	it('is false while a version is outstanding', async () => {
		const { validateMigrations } = await loadDatabase();

		expect(await validateMigrations()).toBe(false);
	});

	it('exits when the database cannot be read', async () => {
		state.selectFails = true;

		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exited');
		});

		const { validateMigrations } = await loadDatabase();

		await expect(validateMigrations()).rejects.toThrow('exited');
		expect(exit).toHaveBeenCalledWith(1);
	});
});
