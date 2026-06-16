import { SchemaBuilder } from '@directus/schema-builder';
import knex from 'knex';
import { createTracker, MockClient } from 'knex-mock-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemsService, NotificationsService } from './index.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('@directus/env', () => ({
	useEnv: vi.fn().mockReturnValue({
		PUBLIC_URL: 'http://example.com',
		EMAIL_TEMPLATES_PATH: './templates',
	}),
}));

vi.mock('./mail/index.js', () => {
	const MailService = vi.fn();
	MailService.prototype.send = vi.fn().mockResolvedValue(undefined);
	return { MailService };
});

const schema = new SchemaBuilder()
	.collection('directus_notifications', (c) => {
		c.field('id').uuid().primary();
	})
	.build();

describe('Integration Tests', () => {
	const db = vi.mocked(knex.default({ client: MockClient }));
	createTracker(db);

	describe('Services / Notifications', () => {
		const service = new NotificationsService({ knex: db, schema });

		let superCreateManySpy: ReturnType<typeof vi.spyOn>;
		let sendEmailSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			superCreateManySpy = vi.spyOn(ItemsService.prototype, 'createMany').mockResolvedValue(['notification-id-1']);
			sendEmailSpy = vi.spyOn(NotificationsService.prototype, 'sendEmail').mockResolvedValue(undefined);
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it('persists via super.createMany and sends an email per notification', async () => {
			const result = await service.createMany([{ recipient: 'user-1' }, { recipient: 'user-2' }]);

			expect(result).toEqual(['notification-id-1']);
			expect(superCreateManySpy).toHaveBeenCalledTimes(1);
			expect(sendEmailSpy).toHaveBeenCalledTimes(2);
		});
	});
});
