import { usePresetsStore } from '@/stores/presets';
import { useUserStore } from '@/stores/user';
import { createTestingPinia } from '@pinia/testing';
import { setActivePinia } from 'pinia';
import { beforeEach, expect, test, vi } from 'vitest';
import { ref } from 'vue';
import { usePreset } from './use-preset';

beforeEach(() => {
	setActivePinia(createTestingPinia({ createSpy: vi.fn }));

	const userStore = useUserStore();
	userStore.currentUser = { id: 'jane' } as never;

	const presetsStore = usePresetsStore();
	presetsStore.getPresetForCollection = () => ({ collection: 'articles' }) as never;
	presetsStore.savePreset = vi.fn().mockResolvedValue({ id: 7, user: 'jane' });
});

test('saves the preset as the current user', async () => {
	const { savePreset, localPreset } = usePreset(ref('articles'));
	await savePreset();

	expect(usePresetsStore().savePreset).toHaveBeenCalledTimes(1);
	expect(localPreset.value).toMatchObject({ id: 7, user: 'jane' });
});

test('an impersonating admin never rewrites what the target sees', async () => {
	useUserStore().impersonator = { id: 'admin' } as never;

	const { savePreset, busy } = usePreset(ref('articles'));
	await savePreset();

	expect(usePresetsStore().savePreset).not.toHaveBeenCalled();
	expect(busy.value).toBe(false);
});
