export type Persistence = 'localStorage' | 'cookie' | 'memory';

export interface Store {
	get(key: string): string | null;
	set(key: string, value: string): void;
	remove(key: string): void;
}

export function memoryStore(): Store {
	const m = new Map<string, string>();
	return {
		get: (k) => m.get(k) ?? null,
		set: (k, v) => void m.set(k, v),
		remove: (k) => void m.delete(k)
	};
}

function localStore(): Store | null {
	try {
		const ls = window.localStorage;
		const probe = '__fp_probe__';
		ls.setItem(probe, '1');
		ls.removeItem(probe);
		return {
			get: (k) => {
				try {
					return ls.getItem(k);
				} catch {
					return null;
				}
			},
			set: (k, v) => {
				try {
					ls.setItem(k, v);
				} catch {}
			},
			remove: (k) => {
				try {
					ls.removeItem(k);
				} catch {}
			}
		};
	} catch {
		return null;
	}
}

const YEAR = 365 * 24 * 3600;

function cookieStore(): Store {
	const write = (k: string, v: string, maxAge: number) => {
		const secure = location.protocol === 'https:' ? '; Secure' : '';
		// biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API is async and not available in all browsers
		document.cookie = `${k}=${encodeURIComponent(v)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
	};
	return {
		get: (k) => {
			for (const part of document.cookie.split(';')) {
				const i = part.indexOf('=');
				if (i > -1 && part.slice(0, i).trim() === k) {
					try {
						return decodeURIComponent(part.slice(i + 1).trim());
					} catch {
						return null;
					}
				}
			}
			return null;
		},
		set: (k, v) => write(k, v, YEAR),
		remove: (k) => write(k, '', 0)
	};
}

/** Resolve a store; falls back to memory if the requested one is unavailable. */
export function createStore(p: Persistence): Store {
	if (p === 'cookie') return cookieStore();
	if (p === 'localStorage') return localStore() ?? memoryStore();
	return memoryStore();
}
