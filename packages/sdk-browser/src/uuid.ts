let lastMs = 0;
let counter = 0;

/**
 * RFC 9562 UUIDv7. 48-bit unix ms timestamp, version 7, 12-bit counter in
 * `rand_a` (monotonic within one millisecond, method 1), variant 10, 62 random bits.
 * If the counter overflows the timestamp is advanced by 1 ms so ordering holds.
 */
export function uuidv7(now: number = Date.now()): string {
	const b = new Uint8Array(16);
	crypto.getRandomValues(b);
	if (now > lastMs) {
		lastMs = now;
		// Random start, top bit clear, leaves headroom for increments.
		counter = (((b[6] ?? 0) << 8) | (b[7] ?? 0)) & 0x7ff;
	} else if (++counter > 0xfff) {
		lastMs++;
		counter = 0;
	}
	let ms = lastMs;
	for (let i = 5; i >= 0; i--) {
		b[i] = ms % 256;
		ms = Math.floor(ms / 256);
	}
	b[6] = 0x70 | (counter >> 8);
	b[7] = counter & 0xff;
	b[8] = 0x80 | ((b[8] ?? 0) & 0x3f);
	let h = '';
	for (let i = 0; i < 16; i++) {
		h += (b[i] ?? 0).toString(16).padStart(2, '0');
		if (i === 3 || i === 5 || i === 7 || i === 9) h += '-';
	}
	return h;
}
