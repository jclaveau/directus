//#region src/storage/get-storage-driver.ts
const _aliasMap = {
	local: "@directus/storage-driver-local",
	s3: "@directus/storage-driver-s3",
	supabase: "@directus/storage-driver-supabase",
	gcs: "@directus/storage-driver-gcs",
	azure: "@directus/storage-driver-azure",
	cloudinary: "@directus/storage-driver-cloudinary"
};
const getStorageDriver = async (driverName) => {
	if (driverName in _aliasMap) driverName = _aliasMap[driverName];
	else throw new Error(`Driver "${driverName}" doesn't exist.`);
	return (await import(driverName)).default;
};

//#endregion
export { _aliasMap, getStorageDriver };