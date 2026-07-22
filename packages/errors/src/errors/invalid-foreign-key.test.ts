import { beforeEach, expect, test } from 'vitest';
import type { InvalidForeignKeyErrorExtensions } from './invalid-foreign-key.js';
import { messageConstructor } from './invalid-foreign-key.js';

let sample: InvalidForeignKeyErrorExtensions;

beforeEach(() => {
	sample = {
		collection: 'test_collection',
		field: 'test_field',
		value: 'test_value',
	};
});

test('Constructs the message using the provided field name and collection', () => {
	const result = messageConstructor(sample);

	expect(result).toBe(
		`Invalid foreign key "${sample.value}" for field "${sample.field}" in collection "${sample.collection}".`,
	);
});

test('Constructs the message using the provided field name only', () => {
	sample.collection = null;

	const result = messageConstructor(sample);
	expect(result).toBe(`Invalid foreign key "${sample.value}" for field "${sample.field}".`);
});

test('Constructs the message using the provided collection name only', () => {
	sample.field = null;

	const result = messageConstructor(sample);
	expect(result).toBe(`Invalid foreign key "${sample.value}" in collection "${sample.collection}".`);
});

test('Constructs the message using without field/collection', () => {
	sample.collection = null;
	sample.field = null;

	const result = messageConstructor(sample);
	expect(result).toBe(`Invalid foreign key "${sample.value}".`);
});

test('Constructs the message without the key', () => {
	sample.value = null;

	const result = messageConstructor(sample);
	expect(result).toBe(`Invalid foreign key for field "${sample.field}" in collection "${sample.collection}".`);
});

test('Appends the referenced collection for an invalid reference', () => {
	sample.relatedCollection = 'authors';
	sample.reason = 'invalid_reference';

	const result = messageConstructor(sample);

	expect(result).toBe(
		[
			`Invalid foreign key "${sample.value}" for field "${sample.field}"`,
			`in collection "${sample.collection}" (references "authors").`,
		].join(' '),
	);
});

test('Reasons about a still-referenced record naming the referrer', () => {
	const result = messageConstructor({
		collection: 'enrollment',
		field: 'id',
		value: null,
		relatedCollection: 'student_enrollment',
		reason: 'still_referenced',
	});

	expect(result).toBe(
		[
			'Record in collection "enrollment" is still referenced',
			'by collection "student_enrollment".',
		].join(' '),
	);
});

test('names the blocked row as collection:pk on delete', () => {
	const result = messageConstructor({
		collection: 'enrollment',
		field: 'id',
		value: '5',
		relatedCollection: 'student_enrollment',
		reason: 'still_referenced',
		operation: 'delete',
	});

	expect(result).toBe(
		[
			'Cannot delete "enrollment:5": it is still referenced',
			'by collection "student_enrollment".',
		].join(' '),
	);
});

test('names the blocked row for an update too', () => {
	const result = messageConstructor({
		collection: 'enrollment',
		field: 'id',
		value: '5',
		relatedCollection: 'student_enrollment',
		reason: 'still_referenced',
		operation: 'update',
	});

	expect(result).toBe(
		[
			'Cannot update "enrollment:5": it is still referenced',
			'by collection "student_enrollment".',
		].join(' '),
	);
});

test('falls back to the collection when the pk is unknown (mysql/sqlite)', () => {
	const result = messageConstructor({
		collection: 'enrollment',
		field: 'id',
		value: null,
		relatedCollection: 'student_enrollment',
		reason: 'still_referenced',
		operation: 'delete',
	});

	expect(result).toBe(
		[
			'Cannot delete collection "enrollment": it is still',
			'referenced by collection "student_enrollment".',
		].join(' '),
	);
});
