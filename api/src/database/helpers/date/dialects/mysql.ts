import { parseISO } from '../../../../utils/date-fns-used.js';
import { DateHelper } from '../types.js';

export class DateHelperMySQL extends DateHelper {
	override readTimestampString(date: string): string { // bb-out-of-scope: #610 non-Postgres
		const parsedDate = new Date(date);
		return new Date(parsedDate.getTime() - parsedDate.getTimezoneOffset() * 60000).toISOString();
	}

	override writeTimestamp(date: string): Date { // bb-out-of-scope: #610 non-Postgres
		const parsedDate = parseISO(date);
		return new Date(parsedDate.getTime() + parsedDate.getTimezoneOffset() * 60000);
	}
}
