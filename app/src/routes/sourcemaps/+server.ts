import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { projectBySecretKey } from '#lib/server/projects.js';
import {
	readMapBody,
	saveSourcemap,
	TooLarge,
	validName,
	validRelease
} from '#lib/server/sourcemaps.js';
import { sourcemapsDir } from '#lib/server/sourcemaps-dir.js';
import type { RequestHandler } from './$types';

const failure = (status: number, error: string, message?: string) =>
	json(message ? { error, message } : { error }, { status });

/**
 * Uploads one source map: `POST /sourcemaps?name=~/assets/app.js&release=1.4.0` with the map as
 * the body (optionally gzipped) and the project's secret key as a bearer token. `@tracemark/cli`
 * does this for a whole build, see docs/errors.md.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const header = request.headers.get('authorization') ?? '';
	const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
	const project = key ? await projectBySecretKey(getDb(), key) : null;
	if (!project) return failure(401, 'invalid_secret_key');

	const name = url.searchParams.get('name') ?? '';
	const release = (url.searchParams.get('release') ?? '').trim();
	if (!validName(name)) {
		return failure(
			400,
			'invalid_name',
			'name must be the minified file as ~/path (any origin) or a full URL, without a query string.'
		);
	}
	if (!validRelease(release)) return failure(400, 'invalid_release');

	let map: string;
	try {
		map = await readMapBody(request.body, request.headers.get('content-encoding'));
	} catch (err) {
		if (err instanceof TooLarge) return failure(413, 'payload_too_large', err.message);
		return failure(400, 'invalid_body', err instanceof Error ? err.message : undefined);
	}
	try {
		const row = await saveSourcemap(getDb(), sourcemapsDir(), {
			projectId: project.id,
			release,
			name,
			map
		});
		return json({ name: row.name, release: row.release, size: row.size }, { status: 201 });
	} catch (err) {
		return failure(400, 'invalid_sourcemap', err instanceof Error ? err.message : undefined);
	}
};
