import { defaultSerialize } from '@keyv/serialize';
import { describe, expect, test } from 'vitest';
import {
	deserializeCacheEnvelope,
	serializeCacheEnvelope,
} from './cache-envelope.js';

describe('cache envelope', () => {
	describe('what it writes', () => {
		test('a plain value is one JSON document led by the envelope version', () => {
			const raw = serializeCacheEnvelope({
				value: { data: [{ id: 1, name: 'a' }] },
				expires: 1000,
			});

			expect(raw).toBe(
				'{"envelope":2,"value":{"data":[{"id":1,"name":"a"}]},"expires":1000}',
			);
		});

		test('a Buffer value rides as base64 under its own key', () => {
			const raw = JSON.parse(serializeCacheEnvelope({
				value: Buffer.from('snappy bytes'),
				expires: 1000,
			}));

			expect(raw).toEqual({
				envelope: 2,
				base64: Buffer.from('snappy bytes').toString('base64'),
				expires: 1000,
			});
		});

		test('no expiry (a TTL-less tier) writes no `expires`', () => {
			expect(JSON.parse(serializeCacheEnvelope({ value: 'v' })))
				.toEqual({ envelope: 2, value: 'v' });
		});

		test('strings are stored as they are, whatever they start with', () => {
			const value = { a: ':leading', b: '::double', c: ':base64:notreally' };

			expect(JSON.parse(serializeCacheEnvelope({ value })).value).toEqual(value);
		});

		test('a Buffer nested in a value serializes as its own toJSON', () => {
			const raw = serializeCacheEnvelope({ value: { blob: Buffer.from([1, 2]) } });

			expect(JSON.parse(raw).value).toEqual({
				blob: { type: 'Buffer', data: [1, 2] },
			});
		});
	});

	describe('what it reads back', () => {
		test('round-trips a plain value with its expiry', () => {
			const data = { value: { data: [{ id: 1, tag: ':x' }] }, expires: 42 };

			expect(deserializeCacheEnvelope(serializeCacheEnvelope(data))).toEqual(data);
		});

		test('round-trips a Buffer value as a Buffer', () => {
			const value = Buffer.from([0, 255, 10, 13]);

			const read = deserializeCacheEnvelope<Buffer>(
				serializeCacheEnvelope({ value, expires: 42 }),
			);

			expect(Buffer.isBuffer(read.value)).toBe(true);
			expect(read.value!.equals(value)).toBe(true);
			expect(read.expires).toBe(42);
		});

		test('a missing expiry reads back undefined', () => {
			expect(deserializeCacheEnvelope(serializeCacheEnvelope({ value: 1 })))
				.toEqual({ value: 1 });
		});
	});

	describe('an entry written by @keyv/serialize (the deploy window)', () => {
		test('a Buffer value comes back a Buffer', () => {
			const value = Buffer.from('compressed');
			const raw = defaultSerialize({ value, expires: 7 });

			expect(raw).toContain(':base64:');

			const read = deserializeCacheEnvelope<Buffer>(raw);

			expect(Buffer.isBuffer(read.value)).toBe(true);
			expect(read.value!.equals(value)).toBe(true);
			expect(read.expires).toBe(7);
		});

		test('its string escapes are undone, nested anywhere', () => {
			const value = {
				a: ':leading',
				b: '::double',
				c: 'plain',
				d: [':in-list', { e: ':deep' }],
			};

			expect(deserializeCacheEnvelope(defaultSerialize({ value, expires: 7 })))
				.toEqual({ value, expires: 7 });
		});

		test('an `envelope` key inside a legacy value does not fool the sniff', () => {
			// The head check is on the document's first bytes, and the legacy writer
			// always leads with `value`.
			const value = { envelope: 2, base64: 'not-a-buffer' };

			expect(deserializeCacheEnvelope(defaultSerialize({ value })).value)
				.toEqual(value);
		});
	});
});
