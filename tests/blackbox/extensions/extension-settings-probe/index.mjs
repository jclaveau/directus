// Reads and plants directus_extensions rows, because the routes that
// write them need rows no HTTP route creates: a registry install needs the
// marketplace.
//
//   GET  /                   — this extension's own settings row.
//   POST /registry-rows      — plants a registry row for `folder`.
//   GET  /registry-rows/:id  — that row, or null once it is gone.
//
// A package of its own rather than a bundle entry: toggling its row would
// otherwise switch every harness endpoint off with it.
//
// Routes here have no asyncHandler around them, so an escaping rejection
// would exit the shared test server: every one answers with a status instead.

import { randomUUID } from 'node:crypto';

const PACKAGE_NAME = 'extension-settings-probe';
const ROW_COLUMNS = ['id', 'folder', 'source', 'bundle'];

export default {
	id: PACKAGE_NAME,
	handler(router, { database }) {
		function answerWith(readRow) {
			return async (req, res) => {
				if (!req.accountability?.admin) {
					return res.status(403).json({ errors: [{ message: 'admin only' }] });
				}

				try {
					return res.json({ data: (await readRow(req)) ?? null });
				}
				catch (error) {
					return res.status(500).json({ errors: [{ message: error.message }] });
				}
			};
		}

		function readRowById(rowId) {
			return database('directus_extensions')
				.select(ROW_COLUMNS)
				.where('id', rowId)
				.first();
		}

		router.get('/', answerWith(() => {
			return database('directus_extensions')
				.select(ROW_COLUMNS)
				.where({ folder: PACKAGE_NAME, source: 'module' })
				.first();
		}));

		router.post('/registry-rows', answerWith(async (req) => {
			const rowId = randomUUID();

			await database('directus_extensions').insert({
				id: rowId,
				enabled: true,
				source: 'registry',
				bundle: null,
				folder: req.body.folder,
			});

			return readRowById(rowId);
		}));

		router.get('/registry-rows/:id', answerWith((req) => {
			return readRowById(req.params.id);
		}));
	},
};
