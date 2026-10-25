// Whether a site can be shown in a frame on the dashboard, from its X-Frame-Options and
// Content-Security-Policy headers, so the heatmap view can say why a page stays blank.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { FramingCheck } from '../heatmaps';

/** Loopback, private, link-local and other non-public addresses, which are never fetched. */
export function isPrivateAddress(address: string): boolean {
	const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
	if (isIP(ip) === 4) {
		const [a, b] = ip.split('.').map(Number);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a >= 224
		);
	}
	if (isIP(ip) === 6) {
		const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
		if (mapped) return isPrivateAddress(mapped[1]);
		return (
			ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip)
		);
	}
	return true;
}

/** Resolves `hostname` and says whether every address it has is public. */
async function isPublicHost(hostname: string): Promise<boolean> {
	if (isIP(hostname.replace(/^\[|\]$/g, ''))) return !isPrivateAddress(hostname);
	const addresses = await lookup(hostname, { all: true });
	return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
}

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

/**
 * Fetches `pageUrl`'s headers and checks them; unknown when that fails. Origins come from events
 * anyone with the public key can send, so only public hosts are fetched and redirects aren't
 * followed: the check can't be pointed at the instance's own network.
 */
export async function checkFraming(
	pageUrl: string,
	dashboardOrigin: string,
	fetchImpl: typeof fetch = fetch,
	publicHost: (hostname: string) => Promise<boolean> = isPublicHost
): Promise<FramingCheck> {
	try {
		const url = new URL(pageUrl);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return { status: 'unknown' };
		if (!(await publicHost(url.hostname))) return { status: 'unknown' };
		const res = await fetchImpl(url, {
			headers: { accept: 'text/html' },
			redirect: 'manual',
			signal: AbortSignal.timeout(4000)
		});
		await res.body?.cancel();
		if (res.status >= 300 && res.status < 400) return { status: 'unknown' };
		const reason = framingBlocked(res.headers, pageUrl, dashboardOrigin);
		return reason ? { status: 'blocked', reason } : { status: 'allowed' };
	} catch {
		return { status: 'unknown' };
	}
}
