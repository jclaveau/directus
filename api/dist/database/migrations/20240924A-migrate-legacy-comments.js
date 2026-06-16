import { Action } from "@directus/constants";
import { randomUUID } from "node:crypto";

//#region src/database/migrations/20240924A-migrate-legacy-comments.ts
async function up(knex) {
	try {
		await knex.schema.alterTable("directus_comments", (table) => {
			table.dropForeign("collection");
		});
	} catch {}
	const rowsLimit = 50;
	let hasMore = true;
	const existingUsers = /* @__PURE__ */ new Set();
	const missingUsers = /* @__PURE__ */ new Set();
	while (hasMore) {
		const legacyComments = await knex.select("*").from("directus_activity").where("action", "=", Action.COMMENT).limit(rowsLimit);
		if (legacyComments.length === 0) {
			hasMore = false;
			break;
		}
		await knex.transaction(async (trx) => {
			for (const legacyComment of legacyComments) {
				let primaryKey;
				if (legacyComment["action"] === Action.COMMENT) {
					primaryKey = randomUUID();
					let legacyCommentUserId = legacyComment.user;
					if (legacyCommentUserId) {
						if (missingUsers.has(legacyCommentUserId)) legacyCommentUserId = null;
						else if (!existingUsers.has(legacyCommentUserId)) if (await trx.select("id").from("directus_users").where("id", "=", legacyCommentUserId).first()) existingUsers.add(legacyCommentUserId);
						else {
							missingUsers.add(legacyCommentUserId);
							legacyCommentUserId = null;
						}
					}
					await trx("directus_comments").insert({
						id: primaryKey,
						collection: legacyComment.collection,
						item: legacyComment.item,
						comment: legacyComment.comment,
						user_created: legacyCommentUserId,
						date_created: legacyComment.timestamp
					});
					await trx("directus_activity").update({
						action: Action.CREATE,
						collection: "directus_comments",
						item: primaryKey,
						comment: null
					}).where("id", "=", legacyComment.id);
				}
			}
		});
	}
	await knex.schema.alterTable("directus_activity", (table) => {
		table.dropColumn("comment");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_activity", (table) => {
		table.text("comment");
	});
}

//#endregion
export { down, up };