// Astro integration: adds the tracemark browser SDK to every page, with error capture if asked.
import type { Config } from '@tracemark/browser';

export interface TracemarkAstroOptions extends Config {
	/**
	 * Capture uncaught browser errors with the errors plugin. `true`, or the plugin's options.
	 * Default `false`.
	 */
	errors?: boolean | { release?: string; ignore?: string[] };
}

/** The parts of Astro's integration API used here. */
export interface AstroIntegration {
	name: string;
	hooks: {
		'astro:config:setup': (options: {
			injectScript: (stage: 'page', content: string) => void;
		}) => void;
	};
}

/** The module every page loads: the SDK set up with `options`. Exported for tests. */
export function pageScript(options: TracemarkAstroOptions): string {
	const { errors, ...config } = options;
	const lines = [
		`import { tracemark } from '@tracemark/browser';`,
		`tracemark.init(${JSON.stringify(config)});`
	];
	if (errors) {
		lines.push(
			`import { createErrors } from '@tracemark/browser/errors';`,
			`tracemark.use(createErrors(${JSON.stringify(errors === true ? {} : errors)}));`
		);
	}
	return lines.join('\n');
}

/**
 * `integrations: [tracemark({ apiKey, host })]` in `astro.config.mjs`. Page views are captured on
 * load and on client-side navigations, including view transitions.
 */
export default function tracemark(options: TracemarkAstroOptions): AstroIntegration {
	return {
		name: '@tracemark/astro',
		hooks: {
			'astro:config:setup': ({ injectScript }) => {
				injectScript('page', pageScript(options));
			}
		}
	};
}

export { tracemark };
