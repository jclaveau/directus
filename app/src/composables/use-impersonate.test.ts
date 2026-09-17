import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useImpersonate } from './use-impersonate';

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/api', () => ({ default: api }));

const unexpectedError = vi.hoisted(() => vi.fn());
vi.mock('@/utils/unexpected-error', () => ({ unexpectedError }));

// What the tab still had as opener when it was sent somewhere
let openerAtSend: unknown = 'unsent';

const tab = {
	opener: window as unknown,
	location: {
		_href: '',
		get href() {
			return this._href;
		},
		set href(value: string) {
			openerAtSend = tab.opener;
			this._href = value;
		},
	},
	close: vi.fn(),
};

const open = vi.fn(() => tab);
const reload = vi.fn();

beforeEach(() => {
	vi.stubGlobal('open', open);
	vi.stubGlobal('location', { reload });
	tab.location.href = '';
	tab.opener = window;
	openerAtSend = 'unsent';
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

test('cookie mode opens the tab on the click, sends it once done', async () => {
	let answer!: () => void;
	api.post.mockReturnValue(new Promise<void>((resolve) => (answer = resolve)));

	const { impersonate, impersonating } = useImpersonate();
	const done = impersonate('jane', 'cookie', 'https://project.example');

	// Opened before the request answers: the click is what the browser allows
	expect(open).toHaveBeenCalledWith('', '_blank');
	expect(tab.location.href).toBe('');
	expect(impersonating.value).toBe(true);

	answer();

	expect(await done).toBe(true);

	expect(api.post)
		.toHaveBeenCalledWith('/auth/impersonate', { user: 'jane', mode: 'cookie' });

	expect(tab.location.href).toBe('https://project.example');
	expect(reload).not.toHaveBeenCalled();
	expect(impersonating.value).toBe(false);

	// Sent with no way back to the Studio window
	expect(openerAtSend).toBeNull();
});

test.each([
	['javascript:alert(document.cookie)'],
	['data:text/html,<script>alert(1)</script>'],
	['project.example'],
	[null],
])('cookie mode sends the tab nowhere but the web (%s)', async (projectUrl) => {
	expect(await useImpersonate().impersonate('jane', 'cookie', projectUrl))
		.toBe(false);

	expect(open).not.toHaveBeenCalled();
	expect(api.post).not.toHaveBeenCalled();
	expect(unexpectedError).toHaveBeenCalledOnce();
});

test('a refused cookie impersonation closes the tab it opened', async () => {
	const error = new Error('403');
	api.post.mockRejectedValue(error);

	expect(await useImpersonate().impersonate('jane', 'cookie', 'https://p')).toBe(false);

	expect(tab.close).toHaveBeenCalledOnce();
	expect(unexpectedError).toHaveBeenCalledWith(error);
});

test('session mode opens nothing and reloads', async () => {
	api.post.mockResolvedValue({});

	expect(await useImpersonate().impersonate('jane', 'session', null)).toBe(true);

	expect(open).not.toHaveBeenCalled();
	expect(reload).toHaveBeenCalledOnce();
});

test('a click while one is in flight does nothing', async () => {
	api.post.mockReturnValue(new Promise(() => {}));
	const { impersonate } = useImpersonate();

	void impersonate('jane', 'session', null);
	expect(await impersonate('jane', 'session', null)).toBe(false);

	expect(api.post).toHaveBeenCalledOnce();
});
