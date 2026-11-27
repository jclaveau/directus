import { InvalidPayloadError } from '@directus/errors';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { authenticator } from 'otplib';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchUserEmail } from '../auth/utils/user-identities.js';
import { TFAService } from './tfa.js';

vi.mock('../database/index.js', () => ({ default: vi.fn() }));

vi.mock('../auth/utils/user-identities.js', () => {
	return { fetchUserEmail: vi.fn() };
});

const db = knex.default({ client: MockClient });
const tracker = createTracker(db);

afterEach(() => {
	tracker.reset();
	vi.restoreAllMocks();
});

describe('generateTFA', () => {
	test('labels the secret with the account email', async () => {
		tracker.on.select('directus_users').response({ tfa_secret: null });

		tracker.on.select('directus_settings')
			.response({ project_name: 'Scalabus' });

		vi.mocked(fetchUserEmail).mockResolvedValue('ada@example.com');
		vi.spyOn(authenticator, 'generateSecret').mockReturnValue('SECRET');

		const generated = await new TFAService({ knex: db, schema: {} as any })
			.generateTFA('user-id-1');

		expect(generated).toStrictEqual({
			secret: 'SECRET',
			url: 'otpauth://totp/Scalabus:ada%40example.com'
				+ '?secret=SECRET&period=30&digits=6&algorithm=SHA1&issuer=Scalabus',
		});

		expect(fetchUserEmail).toHaveBeenCalledWith(db, 'user-id-1');
	});

	test('refuses an account without email', async () => {
		tracker.on.select('directus_users').response({ tfa_secret: null });
		vi.mocked(fetchUserEmail).mockResolvedValue(null);

		await expect(new TFAService({ knex: db, schema: {} as any })
			.generateTFA('user-id-2'))
			.rejects.toStrictEqual(new InvalidPayloadError({
				reason: 'User must have a valid email to enable TFA',
			}));
	});
});
