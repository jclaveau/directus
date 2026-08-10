import { useEnv } from '@directus/env';
import { afterEach, expect, test, vi } from 'vitest';
import {
	diagnosticsMcpEnabled,
	exposedMcpToolGroups,
	isAllowedMcpOrigin,
} from './mcp-config.js';

vi.mock('@directus/env');

afterEach(() => {
	vi.clearAllMocks();
});

test('The endpoint is served only where it was turned on', () => {
	vi.mocked(useEnv).mockReturnValue({ DIAGNOSTICS_MCP_ENABLED: true });
	expect(diagnosticsMcpEnabled()).toBe(true);

	vi.mocked(useEnv).mockReturnValue({ DIAGNOSTICS_MCP_ENABLED: false });
	expect(diagnosticsMcpEnabled()).toBe(false);

	// Absent is off: a new externally reachable surface opens deliberately.
	vi.mocked(useEnv).mockReturnValue({});
	expect(diagnosticsMcpEnabled()).toBe(false);
});

test('Only the configured subsystems are exposed', () => {
	vi.mocked(useEnv)
		.mockReturnValue({ DIAGNOSTICS_MCP_TOOLS: ['processes', 'cache'] });

	expect(exposedMcpToolGroups()).toEqual(['processes', 'cache']);

	vi.mocked(useEnv).mockReturnValue({ DIAGNOSTICS_MCP_TOOLS: [' processes '] });
	expect(exposedMcpToolGroups()).toEqual(['processes']);

	// A name that is not a subsystem is dropped rather than exposed.
	vi.mocked(useEnv)
		.mockReturnValue({ DIAGNOSTICS_MCP_TOOLS: ['cache', 'database'] });

	expect(exposedMcpToolGroups()).toEqual(['cache']);

	vi.mocked(useEnv).mockReturnValue({ DIAGNOSTICS_MCP_TOOLS: [''] });
	expect(exposedMcpToolGroups()).toEqual([]);

	// Anything that is not a list at all exposes nothing.
	vi.mocked(useEnv).mockReturnValue({ DIAGNOSTICS_MCP_TOOLS: 'cache' });
	expect(exposedMcpToolGroups()).toEqual([]);

	vi.mocked(useEnv).mockReturnValue({});
	expect(exposedMcpToolGroups()).toEqual([]);
});

test('A caller with no Origin is not a browser, and is allowed', () => {
	vi.mocked(useEnv).mockReturnValue({});

	expect(isAllowedMcpOrigin(undefined)).toBe(true);
});

test('No browser origin is allowed until one is named', () => {
	vi.mocked(useEnv).mockReturnValue({});
	expect(isAllowedMcpOrigin('https://evil.example')).toBe(false);

	vi.mocked(useEnv).mockReturnValue({ DIAGNOSTICS_MCP_ALLOWED_ORIGINS: [] });
	expect(isAllowedMcpOrigin('https://evil.example')).toBe(false);

	// Not a list at all is not an allowlist.
	vi.mocked(useEnv)
		.mockReturnValue({ DIAGNOSTICS_MCP_ALLOWED_ORIGINS: 'https://ok.example' });

	expect(isAllowedMcpOrigin('https://ok.example')).toBe(false);
});

test('A named origin is allowed, and only that one', () => {
	vi.mocked(useEnv).mockReturnValue({
		DIAGNOSTICS_MCP_ALLOWED_ORIGINS: [
			' https://ok.example ',
			'https://two.example',
		],
	});

	expect(isAllowedMcpOrigin('https://ok.example')).toBe(true);
	expect(isAllowedMcpOrigin('https://two.example')).toBe(true);

	// A rebinding attack arrives as a different origin on the same host, and a
	// prefix or a suffix of an allowed one is a different origin.
	expect(isAllowedMcpOrigin('https://evil.example')).toBe(false);
	expect(isAllowedMcpOrigin('https://ok.example.evil.test')).toBe(false);
	expect(isAllowedMcpOrigin('http://ok.example')).toBe(false);
});
