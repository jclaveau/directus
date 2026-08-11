import { useEnv } from '@directus/env';
import { afterEach, expect, test, vi } from 'vitest';
import {
	systemMcpEnabled,
	systemMcpToolGroups,
	systemMcpAllowsOrigin,
} from './mcp-config.js';

vi.mock('@directus/env');

afterEach(() => {
	vi.clearAllMocks();
});

test('The endpoint is served only where it was turned on', () => {
	vi.mocked(useEnv).mockReturnValue({ SYSTEM_MCP_ENABLED: true });
	expect(systemMcpEnabled()).toBe(true);

	vi.mocked(useEnv).mockReturnValue({ SYSTEM_MCP_ENABLED: false });
	expect(systemMcpEnabled()).toBe(false);

	// Absent is off: a new externally reachable surface opens deliberately.
	vi.mocked(useEnv).mockReturnValue({});
	expect(systemMcpEnabled()).toBe(false);
});

test('Only the configured subsystems are exposed', () => {
	vi.mocked(useEnv)
		.mockReturnValue({ SYSTEM_MCP_TOOLS: ['processes', 'cache'] });

	expect(systemMcpToolGroups()).toEqual(['processes', 'cache']);

	vi.mocked(useEnv).mockReturnValue({ SYSTEM_MCP_TOOLS: [' processes '] });
	expect(systemMcpToolGroups()).toEqual(['processes']);

	// A name that is not a subsystem is dropped rather than exposed.
	vi.mocked(useEnv)
		.mockReturnValue({ SYSTEM_MCP_TOOLS: ['cache', 'database'] });

	expect(systemMcpToolGroups()).toEqual(['cache']);

	vi.mocked(useEnv).mockReturnValue({ SYSTEM_MCP_TOOLS: [''] });
	expect(systemMcpToolGroups()).toEqual([]);

	// Anything that is not a list at all exposes nothing.
	vi.mocked(useEnv).mockReturnValue({ SYSTEM_MCP_TOOLS: 'cache' });
	expect(systemMcpToolGroups()).toEqual([]);

	vi.mocked(useEnv).mockReturnValue({});
	expect(systemMcpToolGroups()).toEqual([]);
});

test('A caller with no Origin is not a browser, and is allowed', () => {
	vi.mocked(useEnv).mockReturnValue({});

	expect(systemMcpAllowsOrigin(undefined)).toBe(true);
});

test('No browser origin is allowed until one is named', () => {
	vi.mocked(useEnv).mockReturnValue({});
	expect(systemMcpAllowsOrigin('https://evil.example')).toBe(false);

	vi.mocked(useEnv).mockReturnValue({ SYSTEM_MCP_ALLOWED_ORIGINS: [] });
	expect(systemMcpAllowsOrigin('https://evil.example')).toBe(false);

	// Not a list at all is not an allowlist.
	vi.mocked(useEnv)
		.mockReturnValue({ SYSTEM_MCP_ALLOWED_ORIGINS: 'https://ok.example' });

	expect(systemMcpAllowsOrigin('https://ok.example')).toBe(false);
});

test('A named origin is allowed, and only that one', () => {
	vi.mocked(useEnv).mockReturnValue({
		SYSTEM_MCP_ALLOWED_ORIGINS: [
			' https://ok.example ',
			'https://two.example',
		],
	});

	expect(systemMcpAllowsOrigin('https://ok.example')).toBe(true);
	expect(systemMcpAllowsOrigin('https://two.example')).toBe(true);

	// A rebinding attack arrives as a different origin on the same host, and a
	// prefix or a suffix of an allowed one is a different origin.
	expect(systemMcpAllowsOrigin('https://evil.example')).toBe(false);
	expect(systemMcpAllowsOrigin('https://ok.example.evil.test')).toBe(false);
	expect(systemMcpAllowsOrigin('http://ok.example')).toBe(false);
});
