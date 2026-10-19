import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type AlertMessage, deliver, issueLines, signature, webhookBody } from './alert-delivery';

const message: AlertMessage = {
	status: 'firing',
	title: 'Signups dropped in <Website>',
	lines: ['Now 3 signed_up events in the last hour', 'Rule: Fewer than 10 signed_up events'],
	url: 'https://analytics.example.com/projects/p1/alerts',
	project: { id: 'p1', name: 'Website' },
	rule: { id: 'r1', name: 'Signups dropped', kind: 'metric' },
	value: 3,
	threshold: 10,
	timestamp: new Date('2026-10-16T12:00:00Z')
};

function fakeFetch(respond: (request: Request) => Response | Promise<Response>) {
	const requests: Request[] = [];
	const fn = (async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		requests.push(request);
		return respond(request);
	}) as typeof fetch;
	return { fn, requests };
}

describe('webhook bodies', () => {
	it('sends a generic JSON payload', () => {
		expect(JSON.parse(webhookBody('json', message))).toEqual({
			type: 'alert.firing',
			title: 'Signups dropped in <Website>',
			text: 'Now 3 signed_up events in the last hour\nRule: Fewer than 10 signed_up events',
			url: 'https://analytics.example.com/projects/p1/alerts',
			project: { id: 'p1', name: 'Website' },
			rule: { id: 'r1', name: 'Signups dropped', kind: 'metric' },
			value: 3,
			threshold: 10,
			issues: [],
			timestamp: '2026-10-16T12:00:00.000Z'
		});
	});

	it('sends Slack mrkdwn text, escaped, with a link', () => {
		expect(JSON.parse(webhookBody('slack', message))).toEqual({
			text: [
				'*Signups dropped in &lt;Website&gt;*',
				'Now 3 signed_up events in the last hour',
				'Rule: Fewer than 10 signed_up events',
				'<https://analytics.example.com/projects/p1/alerts|Open in Tracemark>'
			].join('\n')
		});
	});

	it('sends a Discord embed colored by status', () => {
		const body = JSON.parse(webhookBody('discord', { ...message, status: 'resolved' }));
		expect(body.embeds).toEqual([
			{
				title: 'Signups dropped in <Website>',
				description:
					'Now 3 signed_up events in the last hour\nRule: Fewer than 10 signed_up events',
				url: 'https://analytics.example.com/projects/p1/alerts',
				color: 0x16a34a,
				footer: { text: 'Website' },
				timestamp: '2026-10-16T12:00:00.000Z'
			}
		]);
	});

	it('lists the first ten issues', () => {
		const issues = Array.from({ length: 12 }, (_, i) => ({
			fingerprint: String(i),
			type: 'TypeError',
			value: i ? `bad ${i}` : '',
			occurrences: 1
		}));
		const lines = issueLines(issues);
		expect(lines).toHaveLength(11);
		expect(lines[0]).toBe('TypeError: (no message)');
		expect(lines.at(-1)).toBe('and 2 more');
	});
});

describe('deliver', () => {
	it('posts the body and signs it when there is a secret', async () => {
		const { fn, requests } = fakeFetch(() => new Response('ok'));
		const result = await deliver(
			{ url: 'https://hooks.example.com/a', format: 'json', secret: 's3cret' },
			message,
			{ fetch: fn }
		);
		expect(result).toEqual({ ok: true, statusCode: 200 });
		const [request] = requests;
		const body = await request?.text();
		expect(request?.method).toBe('POST');
		expect(request?.headers.get('content-type')).toBe('application/json');
		expect(request?.headers.get('x-tracemark-signature')).toBe(
			`sha256=${createHmac('sha256', 's3cret')
				.update(body ?? '')
				.digest('hex')}`
		);
		expect(signature('s3cret', body ?? '')).toBe(request?.headers.get('x-tracemark-signature'));
	});

	it('does not sign without a secret', async () => {
		const { fn, requests } = fakeFetch(() => new Response(null, { status: 204 }));
		await deliver({ url: 'https://hooks.example.com/a', format: 'slack', secret: null }, message, {
			fetch: fn
		});
		expect(requests[0]?.headers.has('x-tracemark-signature')).toBe(false);
	});

	it('reports error responses with their status', async () => {
		const { fn } = fakeFetch(() => new Response('invalid_token', { status: 403 }));
		expect(
			await deliver({ url: 'https://hooks.example.com/a', format: 'json', secret: null }, message, {
				fetch: fn
			})
		).toEqual({ ok: false, statusCode: 403, error: 'HTTP 403: invalid_token' });
	});

	it('gives up after the timeout', async () => {
		const fn = ((_: unknown, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
			})) as typeof fetch;
		expect(
			await deliver({ url: 'https://hooks.example.com/a', format: 'json', secret: null }, message, {
				fetch: fn,
				timeoutMs: 20
			})
		).toEqual({ ok: false, error: 'No answer within 0.02s' });
	});

	it('reports network errors', async () => {
		const fn = (async () => {
			throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
		}) as unknown as typeof fetch;
		expect(
			await deliver({ url: 'https://hooks.example.com/a', format: 'json', secret: null }, message, {
				fetch: fn
			})
		).toEqual({ ok: false, error: 'fetch failed: connect ECONNREFUSED' });
	});
});
