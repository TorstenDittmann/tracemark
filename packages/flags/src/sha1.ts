// SHA-1 in plain TypeScript, so the evaluator runs synchronously in every runtime (Node, Bun,
// edge workers) without `node:crypto`. Only used to bucket ids, never for security.

function utf8(text: string): number[] {
	const bytes: number[] = [];
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		if (code < 0x80) bytes.push(code);
		else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
		else if (code < 0x10000)
			bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
		else
			bytes.push(
				0xf0 | (code >> 18),
				0x80 | ((code >> 12) & 63),
				0x80 | ((code >> 6) & 63),
				0x80 | (code & 63)
			);
	}
	return bytes;
}

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

/** The SHA-1 digest of `text` (UTF-8), as 40 lowercase hex characters. */
export function sha1(text: string): string {
	const bytes = utf8(text);
	const bits = bytes.length * 8;
	bytes.push(0x80);
	while (bytes.length % 64 !== 56) bytes.push(0);
	// Message length in bits as a 64-bit big-endian integer.
	const high = Math.floor(bits / 2 ** 32);
	for (const word of [high, bits >>> 0]) {
		bytes.push((word >>> 24) & 255, (word >>> 16) & 255, (word >>> 8) & 255, word & 255);
	}

	let h0 = 0x67452301;
	let h1 = 0xefcdab89;
	let h2 = 0x98badcfe;
	let h3 = 0x10325476;
	let h4 = 0xc3d2e1f0;
	const w = new Array<number>(80);
	for (let offset = 0; offset < bytes.length; offset += 64) {
		for (let i = 0; i < 16; i++) {
			const at = offset + i * 4;
			w[i] =
				((bytes[at] ?? 0) << 24) |
				((bytes[at + 1] ?? 0) << 16) |
				((bytes[at + 2] ?? 0) << 8) |
				(bytes[at + 3] ?? 0);
		}
		for (let i = 16; i < 80; i++) {
			w[i] = rotl((w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0), 1);
		}
		let a = h0;
		let b = h1;
		let c = h2;
		let d = h3;
		let e = h4;
		for (let i = 0; i < 80; i++) {
			let f: number;
			let k: number;
			if (i < 20) {
				f = (b & c) | (~b & d);
				k = 0x5a827999;
			} else if (i < 40) {
				f = b ^ c ^ d;
				k = 0x6ed9eba1;
			} else if (i < 60) {
				f = (b & c) | (b & d) | (c & d);
				k = 0x8f1bbcdc;
			} else {
				f = b ^ c ^ d;
				k = 0xca62c1d6;
			}
			const t = (rotl(a, 5) + f + e + k + (w[i] ?? 0)) | 0;
			e = d;
			d = c;
			c = rotl(b, 30);
			b = a;
			a = t;
		}
		h0 = (h0 + a) | 0;
		h1 = (h1 + b) | 0;
		h2 = (h2 + c) | 0;
		h3 = (h3 + d) | 0;
		h4 = (h4 + e) | 0;
	}
	return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}
