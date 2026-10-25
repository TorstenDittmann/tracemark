// Whether a site can be shown in a frame on the dashboard, from its X-Frame-Options and
// Content-Security-Policy headers, so the heatmap view can say why a page stays blank.

import type { FramingCheck } from '../heatmaps';

/** Does a CSP source expression from `frame-ancestors` allow `ancestor` to frame `page`? */
function sourceMatches(source: string, ancestor: URL, page: URL): boolean {
	const s = source.toLowerCase();
	if (s === '*') return ancestor.protocol === 'http:' || ancestor.protocol === 'https:';
	if (s === "'self'") return ancestor.origin === page.origin;
	if (s.startsWith("'")) return false;
	if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return ancestor.protocol === s;
	const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?/.exec(s);
	if (!m) return false;
	const [, scheme, wildcard, host, port] = m;
	if (scheme && `${scheme}:` !== ancestor.protocol) return false;
	if (!scheme && ancestor.protocol !== 'https:' && ancestor.protocol !== page.protocol)
		return false;
	const name = ancestor.hostname;
	if (wildcard ? !name.endsWith(`.${host}`) : name !== host) return false;
	if (port === '*') return true;
	const defaultPort = ancestor.protocol === 'https:' ? '443' : '80';
	return (port ?? defaultPort) === (ancestor.port || defaultPort);
}

/** Why `headers` stop `dashboardOrigin` from framing `pageUrl`, or null when they don't. */
export function framingBlocked(
	headers: Headers,
	pageUrl: string,
	dashboardOrigin: string
): Extract<FramingCheck, { status: 'blocked' }>['reason'] | null {
	const page = new URL(pageUrl);
	const ancestor = new URL(dashboardOrigin);
	if (ancestor.protocol === 'https:' && page.protocol === 'http:') return 'mixed-content';
	// Several policies (headers) all apply; frame-ancestors overrides X-Frame-Options.
	const policies = (headers.get('content-security-policy') ?? '').split(',');
	let ancestors = false;
	for (const policy of policies) {
		for (const directive of policy.split(';')) {
			const [name, ...sources] = directive.trim().split(/\s+/);
			if (name?.toLowerCase() !== 'frame-ancestors') continue;
			ancestors = true;
			if (!sources.some((source) => sourceMatches(source, ancestor, page))) {
				return 'frame-ancestors';
			}
		}
	}
	if (ancestors) return null;
	const xfo = (headers.get('x-frame-options') ?? '').split(',')[0]?.trim().toLowerCase();
	if (xfo === 'deny' || (xfo === 'sameorigin' && page.origin !== ancestor.origin)) {
		return 'x-frame-options';
	}
	return null;
}

/** Fetches `pageUrl`'s headers (following redirects) and checks them; unknown when that fails. */
export async function checkFraming(
	pageUrl: string,
	dashboardOrigin: string,
	fetchImpl: typeof fetch = fetch
): Promise<FramingCheck> {
	try {
		const res = await fetchImpl(pageUrl, {
			headers: { accept: 'text/html' },
			signal: AbortSignal.timeout(4000)
		});
		await res.body?.cancel();
		const reason = framingBlocked(res.headers, res.url || pageUrl, dashboardOrigin);
		return reason ? { status: 'blocked', reason } : { status: 'allowed' };
	} catch {
		return { status: 'unknown' };
	}
}
