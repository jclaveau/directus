import { useEnv } from '@directus/env';
import { beforeEach, expect, test, vi } from 'vitest';
import { CORE_MOUNTS, coreMountPaths, coreRootPaths } from './core-mounts.js';

vi.mock('@directus/env');

beforeEach(() => {
	vi.mocked(useEnv).mockReturnValue({});
});

test('mounts only what the environment turns on, in mount order', () => {
	const off = coreMountPaths();

	expect(off).not.toContain('/files/tus');
	expect(off).not.toContain('/system-mcp');
	expect(off).not.toContain('/metrics');
	expect(off.indexOf('/auth')).toBe(0);
	expect(off.indexOf('/graphql')).toBe(1);

	vi.mocked(useEnv).mockReturnValue({
		TUS_ENABLED: true,
		SYSTEM_MCP_ENABLED: true,
		METRICS_ENABLED: true,
	});

	const on = coreMountPaths();

	expect(on).toEqual(CORE_MOUNTS.map((mount) => mount.path));
	expect(on.indexOf('/files/tus')).toBeLessThan(on.indexOf('/files'));
});

test('lists each root once, the root handlers first', () => {
	vi.mocked(useEnv).mockReturnValue({ TUS_ENABLED: true, SERVE_APP: true });

	const roots = coreRootPaths();

	expect(roots.slice(0, 5)).toEqual([
		'/',
		'/robots.txt',
		'/admin',
		'/auth',
		'/graphql',
	]);

	expect(roots.filter((root) => root === '/files')).toHaveLength(1);
	expect(roots).not.toContain('/files/tus');
	expect(roots).not.toContain('/metrics');
});

test('leaves the admin app out when it is not served', () => {
	expect(coreRootPaths()).not.toContain('/admin');
});

test('adds each websocket controller on, on the root of its own path', () => {
	vi.mocked(useEnv).mockReturnValue({
		WEBSOCKETS_ENABLED: true,
		WEBSOCKETS_REST_ENABLED: true,
		WEBSOCKETS_REST_PATH: '/websocket',
		WEBSOCKETS_GRAPHQL_ENABLED: false,
		WEBSOCKETS_GRAPHQL_PATH: '/graphql',
		WEBSOCKETS_LOGS_ENABLED: true,
		WEBSOCKETS_LOGS_PATH: '/ws/logs',
	});

	const roots = coreRootPaths();

	expect(roots.slice(0, 5)).toEqual([
		'/',
		'/robots.txt',
		'/websocket',
		'/ws',
		'/auth',
	]);

	expect(roots.filter((root) => root === '/graphql')).toHaveLength(1);
});

test('leaves the websocket paths out when websockets are off', () => {
	vi.mocked(useEnv).mockReturnValue({
		WEBSOCKETS_ENABLED: false,
		WEBSOCKETS_REST_ENABLED: true,
		WEBSOCKETS_REST_PATH: '/websocket',
	});

	expect(coreRootPaths()).not.toContain('/websocket');
});
