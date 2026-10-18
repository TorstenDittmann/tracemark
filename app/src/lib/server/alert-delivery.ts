// Sends alert messages to webhook destinations (see docs/alerts.md).
import { createHmac } from 'node:crypto';
import type { AlertFormat, AlertKind } from '../alerts';

/** How long a destination gets to answer. */
export const DELIVERY_TIMEOUT_MS = 10_000;
/** Most issues listed in one message. */
const LISTED_ISSUES = 10;

export interface AlertMessage {
	status: 'firing' | 'resolved' | 'test';
	title: string;
	/** One line each; the first says what happened. */
	lines: string[];
	/** The page to look at, when the instance's public URL is known. */
	url?: string;
	project: { id: string; name: string };
	rule?: { id: string; name: string; kind: AlertKind };
	/** The measured count or cost, and the threshold, of a threshold rule. */
	value?: number;
	threshold?: number;
	issues?: {
		fingerprint: string;
		type: string;
		value: string;
		occurrences: number;
		url?: string;
	}[];
	timestamp: Date;
}

export interface DeliveryResult {
	ok: boolean;
	statusCode?: number;
	error?: string;
}

/** Lines naming the first few issues, and how many more there are. */
export function issueLines(issues: NonNullable<AlertMessage['issues']>): string[] {
	const lines = issues
		.slice(0, LISTED_ISSUES)
		.map((issue) => `${issue.type}: ${issue.value || '(no message)'}`.slice(0, 200));
	if (issues.length > LISTED_ISSUES) lines.push(`and ${issues.length - LISTED_ISSUES} more`);
	return lines;
}

const COLORS = { firing: 0xdc2626, resolved: 0x16a34a, test: 0x2563eb };

const slackEscape = (text: string) =>
	text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** The request body for a destination's format. */
export function webhookBody(format: AlertFormat, message: AlertMessage): string {
	switch (format) {
		case 'slack': {
			const title = `*${slackEscape(message.title)}*`;
			const text = [title, ...message.lines.map(slackEscape)];
			if (message.url) text.push(`<${message.url}|Open in Tracemark>`);
			return JSON.stringify({ text: text.join('\n') });
		}
		case 'discord':
			return JSON.stringify({
				embeds: [
					{
						title: message.title.slice(0, 256),
						description: message.lines.join('\n').slice(0, 4000),
						url: message.url,
						color: COLORS[message.status],
						footer: { text: message.project.name.slice(0, 200) },
						timestamp: message.timestamp.toISOString()
					}
				]
			});
		case 'json':
			return JSON.stringify({
				type: `alert.${message.status}`,
				title: message.title,
				text: message.lines.join('\n'),
				url: message.url ?? null,
				project: message.project,
				rule: message.rule ?? null,
				value: message.value ?? null,
				threshold: message.threshold ?? null,
				issues: message.issues ?? [],
				timestamp: message.timestamp.toISOString()
			});
	}
}

/** `sha256=` and the hex HMAC-SHA256 of the body. */
export function signature(secret: string, body: string): string {
	return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** An error's message, with its cause's: fetch only says "fetch failed" itself. */
function errorMessage(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	const cause = err.cause instanceof Error ? err.cause.message : '';
	return (cause && !err.message.includes(cause) ? `${err.message}: ${cause}` : err.message).slice(
		0,
		300
	);
}

/** Posts a message to one destination. Never throws; failures come back as the result. */
export async function deliver(
	destination: { url: string; format: AlertFormat; secret: string | null },
	message: AlertMessage,
	options: { fetch?: typeof fetch; timeoutMs?: number } = {}
): Promise<DeliveryResult> {
	const body = webhookBody(destination.format, message);
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'user-agent': 'Tracemark-Alerts'
	};
	if (destination.secret) headers['x-tracemark-signature'] = signature(destination.secret, body);
	try {
		const response = await (options.fetch ?? fetch)(destination.url, {
			method: 'POST',
			headers,
			body,
			redirect: 'manual',
			signal: AbortSignal.timeout(options.timeoutMs ?? DELIVERY_TIMEOUT_MS)
		});
		if (response.ok) {
			await response.body?.cancel();
			return { ok: true, statusCode: response.status };
		}
		const text = (await response.text().catch(() => '')).trim().slice(0, 200);
		return {
			ok: false,
			statusCode: response.status,
			error: `HTTP ${response.status}${text ? `: ${text}` : ''}`
		};
	} catch (err) {
		const name = err instanceof Error ? err.name : '';
		if (name === 'TimeoutError' || name === 'AbortError') {
			return {
				ok: false,
				error: `No answer within ${(options.timeoutMs ?? DELIVERY_TIMEOUT_MS) / 1000}s`
			};
		}
		return { ok: false, error: errorMessage(err) };
	}
}
