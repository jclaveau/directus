import { CronExpressionParser } from 'cron-parser';

export function validateCron(rule: string): boolean {
	try {
		CronExpressionParser.parse(rule);
	}
	catch {
		return false;
	}

	return true;
}
