import type { IncomingMessage } from 'node:http';
import { PassThrough, type Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { describe, expect, test, vi } from 'vitest';
import { createBusboy } from './create-busboy.js';

describe('createBusboy', () => {
	test('reports a cut part on the parser, never as uncaught', async () => {
		const requestBody = new PassThrough();

		const busboy = createBusboy(requestBody as unknown as IncomingMessage, {
			headers: { 'content-type': 'multipart/form-data; boundary=cut' },
		});

		const reportedError = new Promise((resolve) => busboy.on('error', resolve));

		// A route refusing the part never reads it.
		busboy.on('file', () => undefined);

		busboy.end([
			'--cut',
			'Content-Disposition: form-data; name="file"; filename="a.json"',
			'Content-Type: application/json',
			'',
			'[{"name":"a"',
		].join('\r\n'));

		await expect(reportedError).resolves.toEqual(
			new Error('Unexpected end of form'),
		);
	});

	test('fails the part being read when the client aborts the request', async () => {
		const requestBody = Object.assign(new PassThrough(), { complete: false });

		const busboy = createBusboy(requestBody as unknown as IncomingMessage, {
			headers: { 'content-type': 'multipart/form-data; boundary=cut' },
		});

		const reportedError = new Promise((resolve) => busboy.on('error', resolve));
		const partStarted = new Promise((resolve) => busboy.on('file', resolve));

		requestBody.pipe(busboy);

		requestBody.write([
			'--cut',
			'Content-Disposition: form-data; name="file"; filename="a.json"',
			'Content-Type: application/json',
			'',
			'[{"name":"a"',
		].join('\r\n'));

		await partStarted;
		requestBody.destroy();

		await expect(reportedError).resolves.toEqual(
			new Error('Unexpected end of form'),
		);
	});

	test('keeps the parser of a request that completed', async () => {
		const requestBody = Object.assign(new PassThrough(), { complete: true });

		const busboy = createBusboy(requestBody as unknown as IncomingMessage, {
			headers: { 'content-type': 'multipart/form-data; boundary=cut' },
		});

		const partStarted = new Promise((resolve) => busboy.on('file', resolve));

		requestBody.pipe(busboy);

		requestBody.write([
			'--cut',
			'Content-Disposition: form-data; name="file"; filename="a.json"',
			'Content-Type: application/json',
			'',
			'[{"name":"a"',
		].join('\r\n'));

		await partStarted;

		// a request closes once its body is received, while a part is still read
		requestBody.emit('close');

		expect(busboy.destroyed).toBe(false);
	});

	test('drains the rest of the body once a part is refused', async () => {
		const requestBody = Object.assign(new PassThrough(), { complete: true });

		const busboy = createBusboy(requestBody as unknown as IncomingMessage, {
			headers: { 'content-type': 'multipart/form-data; boundary=cut' },
		});

		const reportedError = new Promise((resolve) => busboy.on('error', resolve));

		busboy.on('file', () => {
			busboy.emit('error', new Error('refused'));
		});

		requestBody.pipe(busboy);

		requestBody.write([
			'--cut',
			'Content-Disposition: form-data; name="file"; filename="a.json"',
			'Content-Type: application/json',
			'',
			'[{"name":"a"}]',
		].join('\r\n'));

		await reportedError;
		requestBody.end('\r\n--cut--\r\n');

		await vi.waitFor(() => {
			expect(requestBody.readableEnded).toBe(true);
		});
	});

	test('fails the part being read once a part is refused', async () => {
		const requestBody = Object.assign(new PassThrough(), { complete: true });

		const busboy = createBusboy(requestBody as unknown as IncomingMessage, {
			headers: { 'content-type': 'multipart/form-data; boundary=cut' },
		});

		busboy.on('error', () => undefined);

		const partStarted = new Promise<Readable>((resolve) => {
			busboy.on('file', (_fieldname, fileStream) => resolve(fileStream));
		});

		requestBody.pipe(busboy);

		requestBody.write([
			'--cut',
			'Content-Disposition: form-data; name="file"; filename="a.json"',
			'Content-Type: application/json',
			'',
			'[{"name":"a"',
		].join('\r\n'));

		const fileStream = await partStarted;
		busboy.emit('error', new Error('refused'));

		await expect(finished(fileStream)).rejects.toEqual(
			new Error('Unexpected end of file'),
		);
	});
});
