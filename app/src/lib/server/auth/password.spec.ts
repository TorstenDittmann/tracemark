import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('passwords', () => {
	it('verifies the right password only', async () => {
		const hash = await hashPassword('correct horse battery');
		expect(hash).toMatch(/^scrypt\$131072\$8\$1\$[\w-]+\$[\w-]+$/);
		expect(await verifyPassword('correct horse battery', hash)).toBe(true);
		expect(await verifyPassword('correct horse batterY', hash)).toBe(false);
	});

	it('salts every hash', async () => {
		expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
	});

	it('rejects malformed hashes', async () => {
		expect(await verifyPassword('x', 'bcrypt$whatever')).toBe(false);
		expect(await verifyPassword('x', '')).toBe(false);
	});
});
