//#region src/database/migrations/20260825B-drop-the-descriptor-url.ts
/**
* `directus_cache_descriptors.url` held its row's path a second time.
*
* - It was `req.originalUrl`, and `path` beside it is that same string with the
*   query part cut off, so the two duplicated every byte of the path. Measured
*   on production: `url LIKE path || '%'` held for 575 434 of 575 442 rows, and
*   the column weighed 128 MB of a 462 MB table — the heaviest one in it.
* - The other 115 MB it carried is the query string, which `query` now holds
*   verbatim rather than as the sanitized reading of it, so the URL rebuilds
*   from the two columns exactly as it was sent (see descriptorUrl()).
* - The eight rows where it did not hold are GraphQL reads, whose document
*   travels in a POST body: their `url` was empty and stays that way.
*
* Rows written before this keep the sanitized JSON in `query` and so cannot
* rebuild a URL; they show their path alone until they are re-filled or reaped.
*/
async function up(knex) {
	await knex.schema.alterTable("directus_cache_descriptors", (table) => {
		table.dropColumn("url");
	});
}
/**
* The column comes back empty. Its values were never anything but `path` and
* `query` joined, and the rows that would fill it are re-filled by the traffic
* that wrote them.
*/
async function down(knex) {
	await knex.schema.alterTable("directus_cache_descriptors", (table) => {
		table.text("url").nullable();
	});
}

//#endregion
export { down, up };