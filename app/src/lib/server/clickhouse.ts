export interface ClickHouseConfig {
	url: string;
	user: string;
	password: string;
	database: string;
}

/** Runs a statement over ClickHouse's HTTP interface and returns the raw response body. */
export async function clickhouseQuery(
	config: ClickHouseConfig,
	query: string,
	options: { database?: string | null; params?: Record<string, string | string[]> } = {}
): Promise<string> {
	const url = new URL(config.url);
	const database = options.database === undefined ? config.database : options.database;
	if (database) url.searchParams.set('database', database);
	// Bound to {name:Type} placeholders server-side, see ClickHouse "queries with parameters".
	// Values are read in ClickHouse's escaped text format, so they are escaped here: an id with a
	// backslash or tab would otherwise fail to parse or be cut short. Arrays bind to Array(String).
	for (const [name, value] of Object.entries(options.params ?? {})) {
		url.searchParams.set(
			`param_${name}`,
			Array.isArray(value) ? arrayParam(value) : escaped(value)
		);
	}

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			authorization: `Basic ${btoa(`${config.user}:${config.password}`)}`
		},
		body: query
	});
	const body = await response.text();
	if (!response.ok) {
		throw new Error(`ClickHouse error ${response.status}: ${body.trim()}`);
	}
	return body;
}

const ESCAPES: Record<string, string> = {
	'\\': '\\\\',
	'\t': '\\t',
	'\n': '\\n',
	'\r': '\\r',
	'\0': '\\0',
	"'": "\\'"
};

/** A string in ClickHouse's escaped text format. */
export function escaped(value: string): string {
	return value.replace(/[\\\t\n\r\0]/g, (char) => ESCAPES[char]);
}

/** Strings as an `Array(String)` value: quoted, with quotes and escapes escaped. */
export function arrayParam(values: string[]): string {
	return `[${values.map((value) => `'${value.replace(/[\\\t\n\r\0']/g, (char) => ESCAPES[char])}'`).join(',')}]`;
}
