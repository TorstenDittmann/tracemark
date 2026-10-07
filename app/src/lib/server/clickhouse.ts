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
	options: { database?: string | null } = {}
): Promise<string> {
	const url = new URL(config.url);
	const database = options.database === undefined ? config.database : options.database;
	if (database) url.searchParams.set('database', database);

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
