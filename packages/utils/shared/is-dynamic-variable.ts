const dynamicVariablePrefixes = [
	'$NOW',
	'$CURRENT_USER',
	'$CURRENT_MEMBER_ROLES',
	'$CURRENT_ROLES',
	'$CURRENT_POLICIES',
];

export function isDynamicVariable(value: any) {
	return typeof value === 'string' && dynamicVariablePrefixes.some((prefix) => value.startsWith(prefix));
}
