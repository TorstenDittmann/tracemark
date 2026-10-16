// Astro integration: adds the footprint browser SDK to every page, with error capture if asked.
import type { Config } from '@footprint/browser';

export interface FootprintAstroOptions extends Config {
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
export function pageScript(options: FootprintAstroOptions): string {
	const { errors, ...config } = options;
	const lines = [
		`import { footprint } from '@footprint/browser';`,
		`footprint.init(${JSON.stringify(config)});`
	];
	if (errors) {
		lines.push(
			`import { createErrors } from '@footprint/browser/errors';`,
			`footprint.use(createErrors(${JSON.stringify(errors === true ? {} : errors)}));`
		);
	}
	return lines.join('\n');
}

/**
 * `integrations: [footprint({ apiKey, host })]` in `astro.config.mjs`. Page views are captured on
 * load and on client-side navigations, including view transitions.
 */
export default function footprint(options: FootprintAstroOptions): AstroIntegration {
	return {
		name: '@footprint/astro',
		hooks: {
			'astro:config:setup': ({ injectScript }) => {
				injectScript('page', pageScript(options));
			}
		}
	};
}

export { footprint };
