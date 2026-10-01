import { parseISO } from '../../../../utils/date-fns-used.js';
import { DateHelper } from '../types.js';

export class DateHelperMSSQL extends DateHelper {
	override writeTimestamp(date: string): Date {
		const parsedDate = parseISO(date);
		return new Date(parsedDate.getTime() + parsedDate.getTimezoneOffset() * 60000);
	}
}
