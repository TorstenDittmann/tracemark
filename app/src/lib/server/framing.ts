// Whether a site can be shown in a frame on the dashboard, from its X-Frame-Options and
// Content-Security-Policy headers, so the heatmap view can say why a page stays blank.

import { lookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { FramingCheck } from '../heatmaps';

// IPv4 rules also match IPv4-mapped IPv6 addresses in any spelling (::ffff:7f00:1).
const nonPublic = new BlockList();
for (const [net, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['224.0.0.0', 3]
] as const) {
	nonPublic.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
	['::', 96], // unspecified, loopback and IPv4-compatible
	['64:ff9b::', 96], // NAT64, which reaches IPv4 addresses
	['2002::', 16], // 6to4, which embeds an IPv4 address
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8]
] as const) {
	nonPublic.addSubnet(net, prefix, 'ipv6');
}

/** Loopback, private, link-local and other non-public addresses, which are never fetched. */
export function isPrivateAddress(address: string): boolean {
	const ip = address.replace(/^\[|\]$/g, '');
	const family = isIP(ip);
	if (family === 0) return true;
	return nonPublic.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * A `lookup` for sockets that fails unless every address the host resolves to is public. The
 * socket connects to the address checked here, so a host can't resolve to a public address for
 * a check and a private one for the request.
 */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
	lookup(hostname, { ...options, all: true }, (error, addresses) => {
		if (error) return callback(error, '', 0);
		if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
			return callback(new Error(`${hostname} is not a public host`), '', 0);
		}
		if (options.all) return (callback as (e: null, a: typeof addresses) => void)(null, addresses);
		callback(null, addresses[0].address, addresses[0].family);
	});
};

/** The status and headers of a GET to `url`, without its body or following redirects. */
export function requestHeaders(
	url: URL,
	lookupImpl: LookupFunction = publicLookup
): Promise<{ status: number; headers: Headers }> {
	// Socket connections skip `lookup` for IP literals, so those are checked here.
	if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(url.hostname)) {
		return Promise.reject(new Error(`${url.hostname} is not a public host`));
	}
	const client = url.protocol === 'https:' ? https : http;
	return new Promise((resolve, reject) => {
		const req = client.request(
			url,
			{
				agent: false,
				lookup: lookupImpl,
				headers: { accept: 'text/html' },
				signal: AbortSignal.timeout(4000)
			},
			(res) => {
				const headers = new Headers();
				for (const [name, value] of Object.entries(res.headers)) {
					for (const v of Array.isArray(value) ? value : value ? [value] : []) {
						headers.append(name, v);
					}
				}
				res.destroy();
				resolve({ status: res.statusCode ?? 0, headers });
			}
		);
		req.on('error', reject);
		req.end();
	});
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
 * anyone with the public key can send, so only public addresses are connected to and redirects
 * aren't followed: the check can't be pointed at the instance's own network.
 */
export async function checkFraming(
	pageUrl: string,
	dashboardOrigin: string,
	fetchHeaders: (url: URL) => Promise<{ status: number; headers: Headers }> = requestHeaders
): Promise<FramingCheck> {
	try {
		const url = new URL(pageUrl);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return { status: 'unknown' };
		const res = await fetchHeaders(url);
		if (res.status >= 300 && res.status < 400) return { status: 'unknown' };
		const reason = framingBlocked(res.headers, pageUrl, dashboardOrigin);
		return reason ? { status: 'blocked', reason } : { status: 'allowed' };
	} catch {
		return { status: 'unknown' };
	}
}
