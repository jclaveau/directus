import { getUrl, paths } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { createReadStream } from 'node:fs';
import { join } from 'path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

const assetsDirectory = [paths.cwd, 'assets'];

const imageFile = {
	name: 'directus.png',
	type: 'image/png',
};

const imageFilePath = join(...assetsDirectory, imageFile.name);

const storages = ['local', 'minio'];

// Pins the exact `Content-Disposition` header the assets endpoint emits, so the
// content-disposition dependency bump can't silently change the RFC 6266 / 5987
// output. The header is RFC-standardised, so these literals are identical before
// (content-disposition 0.5.4) and after (2.x) the update.
//
// assets.ts emits `inline` (via content-disposition) when there is no `?download`,
// and falls back to express' `attachment` (res.attachment) when `?download` is set.
// The served filename is the optional `/:pk/:filename?` route param, defaulting to
// the file's `filename_download` — which lets us drive the encoding cases over HTTP.
describe('/assets Content-Disposition contract', () => {
	describe.each(storages)('Storage: %s', (storage) => {
		it.each(vendors)('%s', async (vendor) => {
			// Setup: upload directus.png (filename_download === 'directus.png')
			const insertResponse = await request(getUrl(vendor))
				.post('/files')
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.field('storage', storage)
				.attach('file', createReadStream(imageFilePath));

			const id = insertResponse.body.data.id;

			const read = (path: string) =>
				request(getUrl(vendor)).get(path).set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// 1. Default inline — filename comes from filename_download.
			//    NOTE: content-disposition 2.x emits a *bare token* for simple filenames
			//    (`filename=directus.png`), whereas 0.5.4 always quoted it
			//    (`filename="directus.png"`). Both are RFC 6266-valid; this asserts the
			//    post-bump form. See PR discussion — this is the one header that changed.
			const def = await read(`/assets/${id}`);
			expect(def.statusCode).toBe(200);
			expect(def.headers['content-disposition']).toBe('inline; filename=directus.png');

			// 2. Explicit ASCII filename (with a space) via the :filename route param
			const ascii = await read(`/assets/${id}/${encodeURIComponent('my report.pdf')}`);
			expect(ascii.headers['content-disposition']).toBe('inline; filename="my report.pdf"');

			// 3. Filename with parentheses — must not be token-quoted differently
			const parens = await read(`/assets/${id}/${encodeURIComponent('rapport (final).pdf')}`);
			expect(parens.headers['content-disposition']).toBe('inline; filename="rapport (final).pdf"');

			// 4. Non-ASCII filename — RFC 5987 extended encoding (the real regression risk)
			const unicode = await read(`/assets/${id}/${encodeURIComponent('файл.png')}`);
			expect(unicode.headers['content-disposition']).toBe(
				`inline; filename="????.png"; filename*=UTF-8''%D1%84%D0%B0%D0%B9%D0%BB.png`,
			);

			// 5. ?download — inline is skipped, express' attachment disposition remains.
			//    express bundles content-disposition 0.5.4, so this path still QUOTES the
			//    simple filename. After this bump directus therefore emits an unquoted
			//    inline header but a quoted attachment header (acceptable; both RFC-valid).
			const download = await read(`/assets/${id}?download`);
			expect(download.headers['content-disposition']).toBe('attachment; filename="directus.png"');
		});
	});
});
