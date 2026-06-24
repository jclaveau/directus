import { UsersService } from "../services/users.js";

//#region src/auth/auth.ts
var AuthDriver = class {
	knex;
	constructor(options, _config) {
		this.knex = options.knex;
	}
	getUsersService(schema) {
		return new UsersService({
			knex: this.knex,
			schema
		});
	}
	/**
	* Check with the (external) provider if the user is allowed entry to Directus
	*
	* @param _user User information
	* @param _payload Any data that the user might've provided
	* @throws InvalidCredentialsError
	* @returns Data to be stored with the session
	*/
	async login(_user, _payload) {}
	/**
	* Handle user session refresh
	*
	* @param _user User information
	* @throws InvalidCredentialsError
	*/
	async refresh(_user) {}
	/**
	* Handle user session termination
	*
	* @param _user User information
	*/
	async logout(_user) {}
};

//#endregion
export { AuthDriver };