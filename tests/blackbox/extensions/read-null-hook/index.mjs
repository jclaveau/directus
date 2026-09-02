// An `items.read` filter hook returning null, which `readByQuery` passes straight
// through: it returns whatever the hook handed back, reached via an unchecked
// `as Item[]`, and emitFilter propagates a listener's return value verbatim (only
// `undefined` is ignored). That is how `snapshots` in updateMany's revision block
// becomes null, and why the `Array.isArray(snapshots)` guard beside it is real.
//
// Scoped two ways so it cannot reach anything else: the event names one collection,
// and within it only rows carrying the marker name. Every other read of that
// collection — the setup, the assertions, the control row — answers normally.

const COLLECTION = 'test_read_hook_null';
const MARKER = 'read-returns-null';

export default function registerHooks({ filter }) {
	filter(`${COLLECTION}.items.read`, (payload) => {
		if (Array.isArray(payload) === false) {
			return payload;
		}

		if (payload.some((row) => row?.name === MARKER) === false) {
			return payload;
		}

		return null;
	});
}
