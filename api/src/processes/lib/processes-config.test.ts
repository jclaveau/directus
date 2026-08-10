import { useEnv } from '@directus/env';
import { hostname } from 'node:os';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	processesCollectTimeoutMs,
	processesReplicaId,
	processesReportEnabled,
	processesServiceName,
	reportedProcessDetails,
} from './processes-config.js';

vi.mock('@directus/env');

const platform = { ...process.env };

beforeEach(() => {
	delete process.env['RAILWAY_SERVICE_NAME'];
	delete process.env['RAILWAY_REPLICA_ID'];
	delete process.env['name'];
});

afterEach(() => {
	vi.clearAllMocks();
	process.env = { ...platform };
});

test('The report is served only where it was turned on', () => {
	vi.mocked(useEnv).mockReturnValue({ PROCESSES_ENABLED: true });
	expect(processesReportEnabled()).toBe(true);

	vi.mocked(useEnv).mockReturnValue({ PROCESSES_ENABLED: false });
	expect(processesReportEnabled()).toBe(false);

	vi.mocked(useEnv).mockReturnValue({});
	expect(processesReportEnabled()).toBe(false);
});

test('Only the halves this node is configured to report are reported', () => {
	vi.mocked(useEnv).mockReturnValue({ PROCESSES_DETAILS: ['stats', 'env'] });
	expect(reportedProcessDetails()).toEqual(['stats', 'env']);

	vi.mocked(useEnv).mockReturnValue({ PROCESSES_DETAILS: [' stats '] });
	expect(reportedProcessDetails()).toEqual(['stats']);

	// A name that is not a half is dropped rather than reported back.
	vi.mocked(useEnv).mockReturnValue({ PROCESSES_DETAILS: ['stats', 'secrets'] });
	expect(reportedProcessDetails()).toEqual(['stats']);

	vi.mocked(useEnv).mockReturnValue({ PROCESSES_DETAILS: [''] });
	expect(reportedProcessDetails()).toEqual([]);

	// Anything that is not a list at all reports nothing.
	vi.mocked(useEnv).mockReturnValue({ PROCESSES_DETAILS: 'stats' });
	expect(reportedProcessDetails()).toEqual([]);

	vi.mocked(useEnv).mockReturnValue({});
	expect(reportedProcessDetails()).toEqual([]);
});

test('The service is named by configuration first', () => {
	vi.mocked(useEnv).mockReturnValue({ PROCESSES_SERVICE_NAME: '  api  ' });
	expect(processesServiceName()).toBe('api');
});

test('Then by the platform, then by the supervisor, then by nothing', () => {
	vi.mocked(useEnv).mockReturnValue({ PROCESSES_SERVICE_NAME: '   ' });

	process.env['RAILWAY_SERVICE_NAME'] = 'from-the-platform';
	expect(processesServiceName()).toBe('from-the-platform');

	delete process.env['RAILWAY_SERVICE_NAME'];
	process.env['name'] = 'from-pm2';
	expect(processesServiceName()).toBe('from-pm2');

	delete process.env['name'];
	expect(processesServiceName()).toBe('directus');
});

test('The replica is the platform id, else the host it runs on', () => {
	process.env['RAILWAY_REPLICA_ID'] = 'replica-a';
	expect(processesReplicaId()).toBe('replica-a');

	delete process.env['RAILWAY_REPLICA_ID'];
	expect(processesReplicaId()).toBe(hostname());
});

test('The collection window is a duration, and 750ms by default', () => {
	vi.mocked(useEnv).mockReturnValue({ PROCESSES_COLLECT_TIMEOUT: '3s' });
	expect(processesCollectTimeoutMs()).toBe(3000);

	vi.mocked(useEnv).mockReturnValue({});
	expect(processesCollectTimeoutMs()).toBe(750);
});
