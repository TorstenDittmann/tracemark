const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const steps: [Intl.RelativeTimeFormatUnit, number][] = [
	['second', 60],
	['minute', 60],
	['hour', 24],
	['day', 7],
	['week', 4.35],
	['month', 12],
	['year', Number.POSITIVE_INFINITY]
];

/** "3 minutes ago", "yesterday", "now". */
export function timeAgo(date: string | Date, now = Date.now()): string {
	let value = (new Date(date).getTime() - now) / 1000;
	if (Math.abs(value) < 10) return 'just now';
	for (const [unit, size] of steps) {
		if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
		value /= size;
	}
	return relative.format(Math.round(value), 'year');
}
