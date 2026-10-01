import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const files = vi.hoisted(() => {
	return { readFile: vi.fn() };
});

vi.mock('node:fs/promises', () => {
	return { readFile: files.readFile };
});

const os = vi.hoisted(() => {
	return { totalmem: vi.fn(), availableParallelism: vi.fn() };
});

vi.mock('node:os', () => {
	return {
		totalmem: os.totalmem,
		availableParallelism: os.availableParallelism,
	};
});

import { forgetHostCapacity, hostCapacity } from './host-capacity.js';

/** Answers the cgroup files named, and reports the rest as absent. */
function cgroup(contents: Record<string, string>) {
	files.readFile.mockImplementation(async (path: string) => {
		const found = contents[path];

		if (found === undefined) {
			throw new Error(`ENOENT: ${path}`);
		}

		return found;
	});
}

beforeEach(() => {
	forgetHostCapacity();
	files.readFile.mockReset();
	os.totalmem.mockReturnValue(64_000_000_000);
	os.availableParallelism.mockReturnValue(32);
});

afterEach(() => {
	forgetHostCapacity();
});

test('Reads what cgroup v2 caps the container at', async () => {
	cgroup({
		'/sys/fs/cgroup/memory.max': '2147483648\n',
		'/sys/fs/cgroup/cpu.max': '50000 100000\n',
	});

	await expect(hostCapacity()).resolves.toEqual({
		memoryBytes: 2_147_483_648,
		cpuCores: 0.5,
	});
});

test('Reads the v1 files where v2 is not mounted', async () => {
	cgroup({
		'/sys/fs/cgroup/memory/memory.limit_in_bytes': '1073741824\n',
		'/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '200000\n',
		'/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000\n',
	});

	await expect(hostCapacity()).resolves.toEqual({
		memoryBytes: 1_073_741_824,
		cpuCores: 2,
	});
});

// The machine's figures are the ceiling only for a process that has no other.
test('Falls back to the machine where the container is uncapped', async () => {
	cgroup({
		'/sys/fs/cgroup/memory.max': 'max\n',
		'/sys/fs/cgroup/cpu.max': 'max 100000\n',
	});

	await expect(hostCapacity()).resolves.toEqual({
		memoryBytes: 64_000_000_000,
		cpuCores: 32,
	});
});

// cgroup v1 writes LONG_MAX rounded to a page rather than leaving it empty, and
// reporting 8 exabytes as the limit would make every usage bar read as zero.
test('Treats the v1 uncapped sentinel as no limit at all', async () => {
	cgroup({
		'/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712\n',
	});

	await expect(hostCapacity()).resolves.toMatchObject({
		memoryBytes: 64_000_000_000,
	});
});

test('Reports nothing it could not measure, rather than a zero', async () => {
	cgroup({});
	os.totalmem.mockReturnValue(0);
	os.availableParallelism.mockReturnValue(0);

	await expect(hostCapacity()).resolves.toEqual({
		memoryBytes: null,
		cpuCores: null,
	});
});

test('Measures once, however many processes ask', async () => {
	cgroup({
		'/sys/fs/cgroup/memory.max': '2147483648\n',
		'/sys/fs/cgroup/cpu.max': '100000 100000\n',
	});

	await Promise.all([hostCapacity(), hostCapacity(), hostCapacity()]);

	// four paths at most, and only on the first call: a cgroup limit cannot
	// change under a running process
	expect(files.readFile.mock.calls.length).toBeLessThanOrEqual(4);
});
