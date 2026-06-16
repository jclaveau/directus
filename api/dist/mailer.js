import { getConfigFromEnv } from "./utils/get-config-from-env.js";
import { useLogger } from "./logger/index.js";
import { createRequire } from "node:module";
import { useEnv } from "@directus/env";
import nodemailer from "nodemailer";

//#region src/mailer.ts
const require = createRequire(import.meta.url);
let transporter;
function getMailer() {
	if (transporter) return transporter;
	const env = useEnv();
	const logger = useLogger();
	const transportName = env["EMAIL_TRANSPORT"].toLowerCase();
	if (transportName === "sendmail") transporter = nodemailer.createTransport({
		sendmail: true,
		newline: env["EMAIL_SENDMAIL_NEW_LINE"] || "unix",
		path: env["EMAIL_SENDMAIL_PATH"] || "/usr/sbin/sendmail"
	});
	else if (transportName === "ses") {
		const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");
		const sesClient = new SESv2Client(getConfigFromEnv("EMAIL_SES_"));
		transporter = nodemailer.createTransport({ SES: {
			sesClient,
			SendEmailCommand
		} });
	} else if (transportName === "smtp") {
		let auth = false;
		if (env["EMAIL_SMTP_USER"] || env["EMAIL_SMTP_PASSWORD"]) auth = {
			user: env["EMAIL_SMTP_USER"],
			pass: env["EMAIL_SMTP_PASSWORD"]
		};
		const tls = getConfigFromEnv("EMAIL_SMTP_TLS_");
		transporter = nodemailer.createTransport({
			name: env["EMAIL_SMTP_NAME"],
			pool: env["EMAIL_SMTP_POOL"],
			host: env["EMAIL_SMTP_HOST"],
			port: env["EMAIL_SMTP_PORT"],
			secure: env["EMAIL_SMTP_SECURE"],
			ignoreTLS: env["EMAIL_SMTP_IGNORE_TLS"],
			auth,
			tls
		});
	} else if (transportName === "mailgun") {
		const mg = require("nodemailer-mailgun-transport");
		transporter = nodemailer.createTransport(mg({
			auth: {
				api_key: env["EMAIL_MAILGUN_API_KEY"],
				domain: env["EMAIL_MAILGUN_DOMAIN"]
			},
			host: env["EMAIL_MAILGUN_HOST"] || "api.mailgun.net"
		}));
	} else logger.warn("Illegal transport given for email. Check the EMAIL_TRANSPORT env var.");
	return transporter;
}

//#endregion
export { getMailer as default };