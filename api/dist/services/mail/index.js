import { useLogger } from "../../logger/index.js";
import database_default from "../../database/index.js";
import emitter_default from "../../emitter.js";
import { Url } from "../../utils/url.js";
import getMailer from "../../mailer.js";
import { useEmailRateLimiterQueue } from "./rate-limiter.js";
import path from "path";
import { useEnv } from "@directus/env";
import { InvalidPayloadError } from "@directus/errors";
import { isObject } from "@directus/utils";
import fse from "fs-extra";
import { fileURLToPath } from "url";
import { Liquid } from "liquidjs";

//#region src/services/mail/index.ts
const env = useEnv();
const logger = useLogger();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const liquidEngine = new Liquid({
	root: [path.resolve(env["EMAIL_TEMPLATES_PATH"]), path.resolve(__dirname, "templates")],
	extname: ".liquid"
});
var MailService = class {
	schema;
	accountability;
	knex;
	mailer;
	constructor(opts) {
		this.schema = opts.schema;
		this.accountability = opts.accountability || null;
		this.knex = opts?.knex || database_default();
		this.mailer = getMailer();
		if (env["EMAIL_VERIFY_SETUP"]) this.mailer.verify((error) => {
			if (error) {
				logger.warn(`Email connection failed:`);
				logger.warn(error);
			}
		});
	}
	async send(data, options) {
		await useEmailRateLimiterQueue();
		const payload = await emitter_default.emitFilter(`email.send`, data, {});
		if (!payload) return null;
		const { template,...emailOptions } = payload;
		let { html } = data;
		const defaultTemplateData = options?.defaultTemplateData ?? await this.getDefaultTemplateData();
		if (isObject(emailOptions.from) && (!emailOptions.from.name || !emailOptions.from.address)) throw new InvalidPayloadError({ reason: "A name and address property are required in the \"from\" object" });
		const from = isObject(emailOptions.from) ? emailOptions.from : {
			name: defaultTemplateData.projectName,
			address: emailOptions.from || env["EMAIL_FROM"]
		};
		if (template) {
			let templateData = template.data;
			templateData = {
				...defaultTemplateData,
				...templateData
			};
			html = await this.renderTemplate(template.name, templateData);
		}
		if (typeof html === "string") html = html.split("\n").map((line) => line.trim()).join("\n");
		return await this.mailer.sendMail({
			...emailOptions,
			from,
			html
		});
	}
	async renderTemplate(template, variables) {
		const customTemplatePath = path.resolve(env["EMAIL_TEMPLATES_PATH"], template + ".liquid");
		const systemTemplatePath = path.join(__dirname, "templates", template + ".liquid");
		const templatePath = await fse.pathExists(customTemplatePath) ? customTemplatePath : systemTemplatePath;
		if (await fse.pathExists(templatePath) === false) throw new InvalidPayloadError({ reason: `Template "${template}" doesn't exist` });
		const templateString = await fse.readFile(templatePath, "utf8");
		return await liquidEngine.parseAndRender(templateString, variables);
	}
	async getDefaultTemplateData() {
		const projectInfo = await this.knex.select([
			"project_name",
			"project_logo",
			"project_color",
			"project_url"
		]).from("directus_settings").first();
		return {
			projectName: projectInfo?.project_name || "Directus",
			projectColor: projectInfo?.project_color || "#171717",
			projectLogo: getProjectLogoURL(projectInfo?.project_logo),
			projectUrl: projectInfo?.project_url || ""
		};
		function getProjectLogoURL(logoID) {
			const projectLogoUrl = new Url(env["PUBLIC_URL"]);
			if (logoID) projectLogoUrl.addPath("assets", logoID);
			else projectLogoUrl.addPath("admin", "img", "directus-white.png");
			return projectLogoUrl.toString();
		}
	}
};

//#endregion
export { MailService };