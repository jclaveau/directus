import { useEnv, useEnvSources } from '@directus/env';
import { afterEach, expect, test, vi } from 'vitest';
import { resolveReportedEnv } from './redact-env.js';

// An explicit factory, not the automock: `useEnvSources` is new in this branch,
// so automocking resolves against a build that predates it.
vi.mock('@directus/env', () => {
	return { useEnv: vi.fn(), useEnvSources: vi.fn() };
});

afterEach(() => {
	vi.clearAllMocks();
});

function reportedEnv(
	env: Record<string, unknown>,
	sources: Record<string, string> = {},
) {
	vi.mocked(useEnv).mockReturnValue(env);
	vi.mocked(useEnvSources).mockReturnValue(sources as never);

	return resolveReportedEnv();
}

function variable(env: Record<string, unknown>, key: string) {
	return reportedEnv(env, { [key]: 'process' }).find((one) => one.key === key);
}

test('Reports every variable, sorted, with the layer it came from', () => {
	const reported = reportedEnv(
		{ PORT: 8055, HOST: '0.0.0.0', LOG_LEVEL: 'info' },
		{ PORT: 'process', HOST: 'file' },
	);

	expect(reported.map((one) => one.key)).toEqual(['HOST', 'LOG_LEVEL', 'PORT']);
	expect(reported.map((one) => one.source)).toEqual(['file', 'default', 'process']);

	// A number is reported as the string it resolved to.
	expect(reported.find((one) => one.key === 'PORT')?.value).toBe('8055');
});

test.each([
	['DB_PASSWORD', 'hunter2'],
	['SECRET', 'a-signing-secret'],
	['ADMIN_TOKEN', 'a-token'],
	['AUTH_SAML_KEY', 'a-key'],
	['ARGON2_SALT', 'a-salt'],
	['SOME_PRIVATE_THING', 'a-key'],
	['DB_CONNECTION_URI', 'postgres://host/db'],
	['SENTRY_DSN', 'https://sentry.example'],
])('Redacts %s by the shape of its key', (key, value) => {
	expect(variable({ [key]: value }, key)).toEqual({
		key,
		value: null,
		redacted: true,
		isSet: true,
		source: 'process',
	});
});

test('Redacts a credential whatever the key is called', () => {
	expect(variable({ SOME_ENDPOINT: 'redis://user:pw@host:6379' }, 'SOME_ENDPOINT'))
		.toMatchObject({ value: null, redacted: true });

	// The same host without a credential in it stays readable.
	expect(variable({ SOME_ENDPOINT: 'redis://host:6379' }, 'SOME_ENDPOINT'))
		.toMatchObject({ value: 'redis://host:6379', redacted: false });
});

test('PUBLIC_URL matches the shape but carries no credential', () => {
	expect(variable({ PUBLIC_URL: 'https://admin.example.com' }, 'PUBLIC_URL'))
		.toMatchObject({ value: 'https://admin.example.com', redacted: false });
});

test('A redacted variable still reports whether it is set', () => {
	expect(variable({ SECRET: '' }, 'SECRET'))
		.toMatchObject({ value: null, redacted: true, isSet: false });
});

test('An unset variable is reported as empty, not as null', () => {
	expect(variable({ LOG_STYLE: null }, 'LOG_STYLE'))
		.toMatchObject({ value: '', isSet: false });

	expect(variable({ ROOT_REDIRECT: undefined }, 'ROOT_REDIRECT'))
		.toMatchObject({ value: '', isSet: false });
});

test('A cast list is reported as the list it resolved to', () => {
	expect(variable({ METRICS_SERVICES: ['database', 'cache'] }, 'METRICS_SERVICES'))
		.toMatchObject({ value: '["database","cache"]' });
});

test('An over-long value is truncated rather than dumped', () => {
	const long = variable({ LONG_THING: 'x'.repeat(600) }, 'LONG_THING');

	expect(long?.value).toHaveLength(513);
	expect(long?.value?.endsWith('…')).toBe(true);

	// A value at the cap is left whole.
	const exact = variable({ LONG_THING: 'y'.repeat(512) }, 'LONG_THING');

	expect(exact?.value).toHaveLength(512);
});

test('A variable with no recorded source is reported as a default', () => {
	expect(reportedEnv({ PORT: 8055 })[0]).toMatchObject({ source: 'default' });
});
