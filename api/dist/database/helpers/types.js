//#region src/database/helpers/types.ts
var DatabaseHelper = class {
	constructor(knex) {
		this.knex = knex;
	}
};

//#endregion
export { DatabaseHelper };