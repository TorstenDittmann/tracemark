const PUBLIC_KEY_PREFIX = 'fp_pub_';

/** Generates a project public key: `fp_pub_` followed by 32 hex characters (128 random bits). */
export function generatePublicKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return PUBLIC_KEY_PREFIX + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
	const encoder = new TextEncoder();
	const left = encoder.encode(a);
	const right = encoder.encode(b);
	let diff = left.length ^ right.length;
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
	}
	return diff === 0;
}
