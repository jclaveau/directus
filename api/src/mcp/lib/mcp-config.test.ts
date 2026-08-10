import { useEnv } from '@directus/env';
import { afterEach, expect, test, vi } from 'vitest';
import {
	diagnosticsMcpEnabled,
	exposedMcpToolGroups,
	mcpTokenAccountability,
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

test('A configured token is answered with an admin identity', () => {
	vi.mocked(useEnv).mockReturnValue({ DIAGNOSTICS_MCP_TOKENS: ['first', 'second'] });

	expect(mcpTokenAccountability('Mcp second', '10.0.0.1')).toEqual({
		role: null,
		roles: [],
		user: null,
		admin: true,
		app: false,
		ip: '10.0.0.1',
	});
});

test('The scheme is matched without regard to case', () => {
	vi.mocked(useEnv).mockReturnValue({ DIAGNOSTICS_MCP_TOKENS: ['first'] });

	expect(mcpTokenAccountability('mcp first', null)?.admin).toBe(true);
	expect(mcpTokenAccountability('MCP first', null)?.admin).toBe(true);
});

test.each([
	['no header at all', undefined],
	['another scheme', 'Bearer first'],
	['no token after the scheme', 'Mcp'],
	['more than a scheme and a token', 'Mcp first and-then-some'],
	['a token that is not configured', 'Mcp third'],
	['a token that only prefixes a configured one', 'Mcp firs'],
	['a token that only extends a configured one', 'Mcp firstly'],
])('Refuses %s', (_case, header) => {
	vi.mocked(useEnv).mockReturnValue({ DIAGNOSTICS_MCP_TOKENS: ['first', 'second'] });

	expect(mcpTokenAccountability(header, null)).toBeNull();
});

test('Refuses every token where none is configured', () => {
	vi.mocked(useEnv).mockReturnValue({});
	expect(mcpTokenAccountability('Mcp first', null)).toBeNull();

	// An empty entry is not a token that matches an empty presentation.
	vi.mocked(useEnv).mockReturnValue({ DIAGNOSTICS_MCP_TOKENS: ['', '  '] });
	expect(mcpTokenAccountability('Mcp ', null)).toBeNull();

	vi.mocked(useEnv).mockReturnValue({ DIAGNOSTICS_MCP_TOKENS: 'not-an-array' });
	expect(mcpTokenAccountability('Mcp first', null)).toBeNull();
});
