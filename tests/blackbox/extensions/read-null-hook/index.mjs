// An `items.read` filter hook answering with something other than the list it
// was given: null for rows carrying one marker name, a lone object for rows
// carrying the other. emitFilter propagates a listener's return value verbatim
// (only `undefined` is ignored), so `readByQuery` is the one to refuse it.
//
// Scoped two ways so it cannot reach anything else: the event names one collection,
// and within it only rows carrying a marker name. Every other read of that
// collection — the setup, the assertions, the control row — answers normally.

const COLLECTION = 'test_read_hook_null';
const NULL_MARKER = 'read-returns-null';
const OBJECT_MARKER = 'read-returns-object';

export default function registerHooks({ filter }) {
	filter(`${COLLECTION}.items.read`, (payload) => {
		if (Array.isArray(payload) === false) {
			return payload;
		}

		if (payload.some((row) => row?.name === NULL_MARKER)) {
			return null;
		}

		if (payload.some((row) => row?.name === OBJECT_MARKER)) {
			return { id: 0, name: 'hooked' };
		}

		return payload;
	});
}
