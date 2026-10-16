// Answers the grouped write filters the ways no well-behaved hook does, for
// write-hook-answers.test.ts, so the checks on a filter's answer run.
//
// Every extension here loads into every instance, so this one only reacts to
// its own collection. It never writes through the pool, so it runs on every
// vendor.
//
// The create filter acts on a row's name:
//   'answer-null'      → answers null, cancelling the whole create.
//   'answer-hole'      → deletes that row's entry, leaving a hole in the list.
//   'answer-overwrite' → replaces that row's entry by its index, naming it
//     'overwritten'.
//   'answer-twice'     → answers that row as { data } and { key } at once.
// The update filter acts on a group's status:
//   'answer-null'       → answers null, cancelling the whole update.
//   'answer-drop-key'   → drops that group's keys, cancelling its rows.
//   'answer-bad-key'    → adds the key 'not-a-number' to that group.
//   'answer-both-ways'  → also answers that group's first row as { key }.
//   'answer-add-row'    → adds row 109 to that group.
//   'answer-big-number' → writes amount 7 as a BigInt.
// The delete filter answers null when it deletes row 108.
// The update filter of `test_write_answer_ledger`, which keeps revisions, writes
// amount 9007199254740993 as a BigInt for a group whose status is
// 'answer-big-number'.

const COLLECTION = 'test_write_answer_row';
const LEDGER_COLLECTION = 'test_write_answer_ledger';
const HOOK_ADDED_KEY = 109;
const UNDELETABLE_KEY = '108';

function answerCreate(entries) {
	const names = entries.map((entry) => entry?.data?.name);

	if (names.includes('answer-null')) {
		return null;
	}

	const holeIndex = names.indexOf('answer-hole');

	if (holeIndex !== -1) {
		delete entries[holeIndex];

		return entries;
	}

	const overwriteIndex = names.indexOf('answer-overwrite');

	if (overwriteIndex !== -1) {
		entries[overwriteIndex] = {
			data: { ...entries[overwriteIndex].data, name: 'overwritten' },
		};

		return entries;
	}

	return entries.map((entry) => {
		return entry?.data?.name === 'answer-twice'
			? { data: entry.data, key: entry.data.id }
			: entry;
	});
}

function answerUpdate(groups) {
	if (groups.some((group) => group?.data?.status === 'answer-null')) {
		return null;
	}

	return groups.flatMap((group) => {
		switch (group?.data?.status) {
			case 'answer-drop-key':
				return { ...group, keys: [] };
			case 'answer-bad-key':
				return { ...group, keys: [...group.keys, 'not-a-number'] };
			case 'answer-both-ways':
				return [group, { key: group.keys[0] }];
			case 'answer-add-row':
				return { ...group, keys: [...group.keys, HOOK_ADDED_KEY] };
			case 'answer-big-number':
				return { ...group, data: { ...group.data, amount: 7n } };
			default:
				return group;
		}
	});
}

export default function registerHooks({ filter }) {
	filter(`${COLLECTION}.items.create`, (entries) => {
		return Array.isArray(entries)
			? answerCreate(entries)
			: entries;
	});

	filter(`${COLLECTION}.items.update`, (groups) => {
		return Array.isArray(groups)
			? answerUpdate(groups)
			: groups;
	});

	filter(`${LEDGER_COLLECTION}.items.update`, (groups) => {
		return Array.isArray(groups)
			? groups.map((group) => {
				return group?.data?.status === 'answer-big-number'
					? { ...group, data: { ...group.data, amount: 9007199254740993n } }
					: group;
			})
			: groups;
	});

	filter(`${COLLECTION}.items.delete`, (keys) => {
		return Array.isArray(keys)
			&& keys.some((key) => String(key) === UNDELETABLE_KEY)
			? null
			: keys;
	});
}
