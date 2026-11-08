import { InvalidPayloadError } from '@directus/errors';
import { PassThrough, Readable } from 'node:stream';
import { expect, test, vi } from 'vitest';
import router from './schema.js';

vi.mock('../database/index.js', () => ({ default: vi.fn() }));
vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));
vi.mock('../services/schema.js', () => ({ SchemaService: vi.fn() }));

test('POST /diff answers once, refusing the second file of a cut body', async () => {
	const diffRoute = router.stack.find((layer) => layer.route?.path === '/diff')!;
	const requestBody = new PassThrough();
	const next = vi.fn();

	await diffRoute.route!.stack[0]!.handle(
		Object.assign(requestBody, {
			headers: { 'content-type': 'multipart/form-data; boundary=cut' },
			is: (mimeType: string) => mimeType === 'multipart/form-data',
		}) as any,
		{ locals: {} } as any,
		next,
	);

	requestBody.end([
		'--cut',
		'Content-Disposition: form-data; name="file"; filename="a.json"',
		'Content-Type: application/json',
		'',
		'{"version":1}',
		'--cut',
		'Content-Disposition: form-data; name="file"; filename="b.json"',
		'Content-Type: application/json',
		'',
		'{"version":1',
	].join('\r\n'));

	await vi.waitFor(() => {
		expect(next).toHaveBeenCalled();
	});

	// the parser fails and the first file is read after the second one is refused
	await new Promise((resolve) => setTimeout(resolve, 50));

	expect(next.mock.calls).toEqual([
		[
			new InvalidPayloadError({
				reason: 'More than one file was included in the body',
			}),
		],
	]);
});

test('POST /diff drains the body after refusing a second file', async () => {
	const diffRoute = router.stack.find((layer) => layer.route?.path === '/diff')!;
	const requestBody = new PassThrough();
	const next = vi.fn();

	await diffRoute.route!.stack[0]!.handle(
		Object.assign(requestBody, {
			headers: { 'content-type': 'multipart/form-data; boundary=cut' },
			is: (mimeType: string) => mimeType === 'multipart/form-data',
		}) as any,
		{ locals: {} } as any,
		next,
	);

	const fileChunk = 'x'.repeat(100_000);

	Readable.from([
		[
			'--cut',
			'Content-Disposition: form-data; name="file"; filename="a.json"',
			'Content-Type: application/json',
			'',
			'{"version":1}',
			'--cut',
			'Content-Disposition: form-data; name="file"; filename="b.json"',
			'Content-Type: application/json',
			'',
			'',
		].join('\r\n'),
		fileChunk,
		fileChunk,
		fileChunk,
		'\r\n--cut--\r\n',
	]).pipe(requestBody);

	await vi.waitFor(() => {
		expect(requestBody.readableEnded).toBe(true);
	});

	expect(next.mock.calls).toEqual([
		[
			new InvalidPayloadError({
				reason: 'More than one file was included in the body',
			}),
		],
	]);
});

test('POST /diff waits for the end of the body to answer', async () => {
	const diffRoute = router.stack.find((layer) => layer.route?.path === '/diff')!;
	const requestBody = new PassThrough();
	const res = { locals: {} };
	const next = vi.fn();

	await diffRoute.route!.stack[0]!.handle(
		Object.assign(requestBody, {
			headers: { 'content-type': 'multipart/form-data; boundary=cut' },
			is: (mimeType: string) => mimeType === 'multipart/form-data',
		}) as any,
		res as any,
		next,
	);

	requestBody.write([
		'--cut',
		'Content-Disposition: form-data; name="file"; filename="a.json"',
		'Content-Type: application/json',
		'',
		'{"version":1}',
		'--cut',
	].join('\r\n'));

	// nothing to wait on: the file is read in the route, and no answer may come
	await new Promise((resolve) => setTimeout(resolve, 50));

	expect(next.mock.calls).toEqual([]);

	requestBody.end('--\r\n');

	await vi.waitFor(() => {
		expect(next).toHaveBeenCalled();
	});

	expect(next.mock.calls).toEqual([[undefined]]);
	expect(res.locals).toEqual({ upload: { version: 1 } });
});
