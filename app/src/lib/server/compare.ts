import type { Operator } from '../insights';

/** `value` (a String expression) compared by `operator` to the String parameter `param`. */
export function compareSql(value: string, operator: Operator, param: string): string {
	switch (operator) {
		case 'eq':
			return `${value} = {${param}:String}`;
		case 'neq':
			return `${value} != {${param}:String}`;
		case 'contains':
			return `positionCaseInsensitive(${value}, {${param}:String}) > 0`;
		case 'not_contains':
			return `positionCaseInsensitive(${value}, {${param}:String}) = 0`;
		case 'gt':
			return `toFloat64OrNull(${value}) > toFloat64OrNull({${param}:String})`;
		case 'lt':
			return `toFloat64OrNull(${value}) < toFloat64OrNull({${param}:String})`;
		case 'is_set':
			return `${value} != ''`;
		case 'is_not_set':
			return `${value} = ''`;
	}
}
