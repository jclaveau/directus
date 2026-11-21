import { useUserStore } from '@/stores/user';
import { Accountability, Role, User } from '@directus/types';
import { parsePreset as parsePresetShared } from '@directus/utils';

export function parsePreset(preset: Record<string, any> | null): Record<string, any> {
	const { currentUser } = useUserStore();

	if (!currentUser) return preset ?? {};
	if (!('id' in currentUser)) return preset ?? {};

	const memberRoles = currentUser.roles.map((membership) => membership.role as Role);

	// TODO make this work with new user
	const accountability: Accountability = {
		memberRoles: memberRoles.map((role) => role.id),
		roles: currentUser.effectiveRoles.map((role) => role.id),
		user: currentUser.id,
	};

	return (
		parsePresetShared(preset, accountability, {
			$CURRENT_MEMBER_ROLES: memberRoles,
			$CURRENT_USER: currentUser as User,
		}) ?? {}
	);
}
