import { describe, expect, it } from 'vitest';
import { heatmapFrameUrl } from '../heatmaps';
import { checkFraming, framingBlocked } from './framing';

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

describe('checkFraming', () => {
	it('checks the headers of the page it ends up on', async () => {
		const fetchImpl = (async () =>
			new Response('<html></html>', {
				headers: { 'x-frame-options': 'DENY' }
			})) as unknown as typeof fetch;
		expect(await checkFraming(page, dashboard, fetchImpl)).toEqual({
			status: 'blocked',
			reason: 'x-frame-options'
		});
	});

	it('is unknown when the page cannot be fetched', async () => {
		const fetchImpl = (async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		expect(await checkFraming(page, dashboard, fetchImpl)).toEqual({ status: 'unknown' });
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
