import { afterEach, vi } from 'vitest';
import { type Config, createClient, type TracemarkClient, type WireEvent } from '../src/client';

export const API_KEY = 'fp_pub_test';
export const HOST = 'https://ingest.example.com';

type FetchImpl = (url: string, init: RequestInit) => Promise<{ status: number }>;

export function mockFetch(impl?: FetchImpl) {
	const f = vi.fn<FetchImpl>(impl ?? (async () => ({ status: 202 })));
	vi.stubGlobal('fetch', f);
	return f;
}

export interface Body {
	api_key: string;
	sent_at: string;
	batch: WireEvent[];
}

export function bodies(f: ReturnType<typeof mockFetch>): Body[] {
	return f.mock.calls.map((c) => JSON.parse(String(c[1].body)) as Body);
}

export function sentEvents(f: ReturnType<typeof mockFetch>): WireEvent[] {
	return bodies(f).flatMap((b) => b.batch);
}

const clients: TracemarkClient[] = [];

export function make(config: Partial<Config> = {}): TracemarkClient {
	const c = createClient({ apiKey: API_KEY, host: HOST, autocapturePageviews: false, ...config });
	clients.push(c);
	return c;
}

export function setURL(url: string) {
	(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
}

export function clearCookies() {
	for (const part of document.cookie.split(';')) {
		const name = part.split('=')[0]?.trim();
		// Max-Age=-1, not 0: happy-dom expires a Max-Age=0 cookie at Date.now() and only drops it a
		// millisecond later, so a fast next test could still see `name=`.
		// biome-ignore lint/suspicious/noDocumentCookie: test cleanup
		if (name) document.cookie = `${name}=; Max-Age=-1; Path=/`;
	}
}

afterEach(() => {
	for (const c of clients.splice(0)) c.destroy();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	localStorage.clear();
	clearCookies();
	setURL('https://app.example.com/');
});
