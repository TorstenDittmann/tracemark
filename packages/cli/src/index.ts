#!/usr/bin/env node
// tracemark CLI. `tracemark sourcemaps upload <dir>` is the only command so far.
import { parseArgs } from 'node:util';
import { findSourcemaps, uploadSourcemaps } from './sourcemaps';

const HELP = `Usage: tracemark sourcemaps upload <dir> [options]

Uploads the source maps of a build so tracemark shows original source in error stack traces.
Each script under <dir> with a map (its sourceMappingURL, or <script>.map beside it) is uploaded
under the URL it is served from: --url-prefix plus its path in <dir>.

Options:
  --host <url>         Your tracemark instance (env TRACEMARK_HOST)
  --secret-key <key>   The project's secret key, fp_sec_… (env TRACEMARK_SECRET_KEY)
  --release <version>  Release the build belongs to; set the same \`release\` in the SDK
                       (env TRACEMARK_RELEASE). Without one, maps match events of any release.
  --url-prefix <path>  Where <dir> is served: ~/ for the site root on any origin (default),
                       ~/static/, or a full URL such as https://cdn.example.com/app/
  --delete-after       Delete the map files once uploaded, so they aren't deployed
  --dry-run            List what would be uploaded
  -h, --help           Show this help
`;

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			host: { type: 'string' },
			'secret-key': { type: 'string' },
			release: { type: 'string' },
			'url-prefix': { type: 'string', default: '~/' },
			'delete-after': { type: 'boolean', default: false },
			'dry-run': { type: 'boolean', default: false },
			help: { type: 'boolean', short: 'h', default: false }
		}
	});
	const [group, command, dir, ...rest] = positionals;
	if (values.help || group !== 'sourcemaps' || command !== 'upload' || !dir || rest.length) {
		(values.help ? console.log : console.error)(HELP);
		return values.help ? 0 : 2;
	}

	const env = process.env;
	const host = values.host ?? env.TRACEMARK_HOST;
	const secretKey = values['secret-key'] ?? env.TRACEMARK_SECRET_KEY;
	const release = values.release ?? env.TRACEMARK_RELEASE;

	const maps = await findSourcemaps(dir, values['url-prefix']);
	if (!maps.length) {
		console.error(`No source maps found under ${dir}. Is the build configured to emit them?`);
		return 1;
	}
	if (values['dry-run']) {
		for (const map of maps) console.log(`${map.name}  ${map.path ?? '(inline)'}`);
		console.log(`${maps.length} source maps${release ? ` for release ${release}` : ''}.`);
		return 0;
	}
	if (!host || !secretKey) {
		console.error('Set --host and --secret-key, or TRACEMARK_HOST and TRACEMARK_SECRET_KEY.');
		return 2;
	}

	const result = await uploadSourcemaps(maps, {
		host,
		secretKey,
		release,
		deleteAfter: values['delete-after'],
		log: console.log
	});
	const skipped = maps.length - result.uploaded.length - result.failed.length;
	console.log(
		`Uploaded ${result.uploaded.length} of ${maps.length} source maps${release ? ` for release ${release}` : ''}.` +
			(skipped ? ` ${skipped} skipped after the key was refused.` : '')
	);
	return result.uploaded.length === maps.length ? 0 : 1;
}

main(process.argv.slice(2)).then(
	(code) => {
		process.exitCode = code;
	},
	(err: unknown) => {
		console.error(err instanceof Error ? err.message : err);
		process.exitCode = 1;
	}
);
