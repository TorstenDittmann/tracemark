import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt parameters (OWASP minimum is N=2^17, r=8, p=1). Stored with each hash so they can change later.
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

export const MIN_PASSWORD_LENGTH = 10;

function derive(
	password: string,
	salt: Buffer,
	{ N, r, p }: { N: number; r: number; p: number }
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(
			password.normalize('NFKC'),
			salt,
			KEY_LENGTH,
			{ N, r, p, maxmem: 256 * N * r },
			(err, key) => (err ? reject(err) : resolve(key))
		);
	});
}

/** Hashes a password as `scrypt$N$r$p$salt$hash` (salt and hash base64url). */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const key = await derive(password, salt, { N, r: R, p: P });
	return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, n, r, p, salt, hash] = stored.split('$');
	if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'base64url');
	const key = await derive(password, Buffer.from(salt, 'base64url'), {
		N: Number(n),
		r: Number(r),
		p: Number(p)
	});
	return key.length === expected.length && timingSafeEqual(key, expected);
}
