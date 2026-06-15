import { ForbiddenError } from '@directus/errors';
import type { AbstractServiceOptions } from '@directus/types';
import { describe, expect, test, vi } from 'vitest';
import { getService } from './get-service.js';

vi.mock('../services/index.js', () => {
	const makeStub = () => vi.fn();

	return {
		AccessService: makeStub(),
		ActivityService: makeStub(),
		CommentsService: makeStub(),
		DashboardsService: makeStub(),
		DeploymentProjectsService: makeStub(),
		DeploymentRunsService: makeStub(),
		DeploymentService: makeStub(),
		FilesService: makeStub(),
		FlowsService: makeStub(),
		FoldersService: makeStub(),
		ItemsService: makeStub(),
		NotificationsService: makeStub(),
		OperationsService: makeStub(),
		PanelsService: makeStub(),
		PermissionsService: makeStub(),
		PoliciesService: makeStub(),
		PresetsService: makeStub(),
		RevisionsService: makeStub(),
		RolesService: makeStub(),
		SettingsService: makeStub(),
		SharesService: makeStub(),
		TranslationsService: makeStub(),
		UsersService: makeStub(),
		VersionsService: makeStub(),
	};
});

describe('getService', () => {
	const opts = { schema: {} as any } as AbstractServiceOptions;

	test('throws a ForbiddenError with a reason for unmapped directus_* collections', () => {
		expect(() => getService('directus_unmapped', opts)).toThrow(ForbiddenError);

		expect(() => getService('directus_unmapped', opts)).toThrowError('Forbidden access to directus_* collections');
	});

	test('returns an ItemsService for regular collections', () => {
		expect(() => getService('test_collection', opts)).not.toThrow();
	});
});
