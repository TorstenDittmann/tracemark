import { lookup } from 'node:dns';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heatmapFrameUrl } from '../heatmaps';
import { checkFraming, framingBlocked, isPrivateAddress, requestHeaders } from './framing';

const dashboard = 'https://analytics.example.com';
const page = 'https://www.example.com/pricing';
const blocked = (headers: Record<string, string>, url = page, origin = dashboard) =>
	framingBlocked(new Headers(headers), url, origin);

describe('framingBlocked', () => {
	it('allows pages without framing headers', () => {
		expect(blocked({})).toBeNull();
		expect(blocked({ 'content-security-policy': "default-src 'self'" })).toBeNull();
	});

	it('follows X-Frame-Options', () => {
		expect(blocked({ 'x-frame-options': 'DENY' })).toBe('x-frame-options');
		expect(blocked({ 'x-frame-options': 'SAMEORIGIN' })).toBe('x-frame-options');
		expect(
			blocked({ 'x-frame-options': 'sameorigin' }, 'https://analytics.example.com/x')
		).toBeNull();
	});

	it('matches frame-ancestors sources against the dashboard origin', () => {
		const csp = (sources: string) =>
			blocked({ 'content-security-policy': `frame-ancestors ${sources}` });
		expect(csp("'none'")).toBe('frame-ancestors');
		expect(csp("'self'")).toBe('frame-ancestors');
		expect(csp("'self' https://analytics.example.com")).toBeNull();
		expect(csp('analytics.example.com')).toBeNull();
		expect(csp('*.example.com')).toBeNull();
		expect(csp('*.other.com https:')).toBeNull();
		expect(csp('*')).toBeNull();
		expect(csp('https://analytics.example.com:8443')).toBe('frame-ancestors');
		expect(csp('http://analytics.example.com')).toBe('frame-ancestors');
	});

	it('lets frame-ancestors override X-Frame-Options, and applies every policy', () => {
		expect(
			blocked({
				'x-frame-options': 'DENY',
				'content-security-policy': `default-src 'self'; frame-ancestors ${dashboard}`
			})
		).toBeNull();
		expect(
			blocked({
				'content-security-policy': `frame-ancestors *, frame-ancestors 'self'`
			})
		).toBe('frame-ancestors');
	});

	it('blocks http pages on an https dashboard', () => {
		expect(blocked({}, 'http://localhost:3000/')).toBe('mixed-content');
		expect(blocked({}, 'http://localhost:3000/', 'http://localhost:5173')).toBeNull();
	});
});

describe('isPrivateAddress', () => {
	it('flags loopback, private, link-local and mapped addresses', () => {
		for (const ip of [
			'127.0.0.1',
			'10.1.2.3',
			'172.20.0.1',
			'192.168.1.1',
			'169.254.169.254',
			'100.64.0.1',
			'0.0.0.0',
			'::1',
			'fd00::1',
			'fe80::1',
			'::ffff:10.0.0.1'
		]) {
			expect(isPrivateAddress(ip), ip).toBe(true);
		}
		for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) {
			expect(isPrivateAddress(ip), ip).toBe(false);
		}
	});
});

describe('checkFraming', () => {
	const respond =
		(status: number, headers: Record<string, string> = {}) =>
		async () => ({ status, headers: new Headers(headers) });

	it('checks the headers of the page', async () => {
		expect(
			await checkFraming(page, dashboard, respond(200, { 'x-frame-options': 'DENY' }))
		).toEqual({
			status: 'blocked',
			reason: 'x-frame-options'
		});
		expect(await checkFraming(page, dashboard, respond(200))).toEqual({ status: 'allowed' });
	});

	it('is unknown when the page cannot be fetched or redirects', async () => {
		const offline = async () => {
			throw new Error('offline');
		};
		expect(await checkFraming(page, dashboard, offline)).toEqual({ status: 'unknown' });
		expect(await checkFraming(page, dashboard, respond(302))).toEqual({ status: 'unknown' });
		expect(await checkFraming('ftp://example.com/', dashboard, respond(200))).toEqual({
			status: 'unknown'
		});
	});
});

describe('requestHeaders', () => {
	let server: Server;
	let port: number;
	beforeAll(async () => {
		server = createServer((_req, res) => {
			res.setHeader('x-frame-options', 'DENY');
			res.end('<html></html>');
		});
		await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
		port = (server.address() as AddressInfo).port;
	});
	afterAll(() => server.close());

	it('reads the headers of a page', async () => {
		const res = await requestHeaders(new URL(`http://localhost:${port}/`), lookup);
		expect(res.status).toBe(200);
		expect(res.headers.get('x-frame-options')).toBe('DENY');
	});

	it('never connects to a private address, however it is spelled or resolved', async () => {
		for (const host of ['127.0.0.1', '[::ffff:7f00:1]', '[::ffff:127.0.0.1]', 'localhost']) {
			await expect(requestHeaders(new URL(`http://${host}:${port}/`))).rejects.toThrow(
				/not a public host/
			);
		}
	});
});

describe('heatmapFrameUrl', () => {
	it('joins the origin and path, or takes an http(s) override', () => {
		expect(heatmapFrameUrl('https://example.com', '/pricing')).toBe('https://example.com/pricing');
		expect(heatmapFrameUrl(null, '/pricing')).toBeNull();
		expect(heatmapFrameUrl('https://example.com', '/', ' http://localhost:3000/a ')).toBe(
			'http://localhost:3000/a'
		);
		expect(heatmapFrameUrl('https://example.com', '/', 'javascript:alert(1)')).toBeNull();
	});
});
