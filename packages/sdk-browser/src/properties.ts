import { VERSION } from './version';

export type Properties = Record<string, unknown>;

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

function domainOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return '';
	}
}

/** Default properties attached to every event, read at capture time. */
export function defaultProperties(): Properties {
	const loc = window.location;
	const ref = document.referrer;
	const p: Properties = {
		$current_url: loc.href,
		$pathname: loc.pathname,
		$host: loc.host,
		$referrer: ref || '$direct',
		$referring_domain: (ref && domainOf(ref)) || '$direct',
		$title: document.title,
		$screen_width: window.screen?.width,
		$screen_height: window.screen?.height,
		$viewport_width: window.innerWidth,
		$viewport_height: window.innerHeight,
		$lib: 'footprint-browser',
		$lib_version: VERSION,
		$browser_language: navigator.language
	};
	try {
		p.$timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	} catch {}
	const params = new URLSearchParams(loc.search);
	for (const k of UTM) {
		const v = params.get(k);
		if (v) p[k] = v;
	}
	return p;
}
