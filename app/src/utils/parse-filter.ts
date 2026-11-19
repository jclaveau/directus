import { useUserStore } from '@/stores/user';
import { Accountability, Filter, Role } from '@directus/types';
import { parseFilter as parseFilterShared } from '@directus/utils';

export function parseFilter(filter: Filter | null): Filter {
	const { currentUser } = useUserStore();

	if (!currentUser) return filter ?? {};
	if (!('id' in currentUser)) return filter ?? {};

	const memberRoles = currentUser.roles.map((membership) => membership.role as Role);

	// TODO should this work with policies app side? Is that a dynamic variable that we expose in other filters, that are not permissions?
	const accountability: Accountability = {
		memberRoles: memberRoles.map((role) => role.id),
		roles: currentUser.effectiveRoles.map((role) => role.id),
		user: currentUser.id,
	} as Accountability;

	return (
		parseFilterShared(filter, accountability, {
			$CURRENT_MEMBER_ROLES: memberRoles,
			$CURRENT_ROLES: currentUser.effectiveRoles,
			$CURRENT_USER: currentUser,
		}) ?? {}
	);
}
