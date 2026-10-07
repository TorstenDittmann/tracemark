import { describe, expect, it } from 'vitest';
import { splitStatements } from './migrate';

describe('splitStatements', () => {
	it('splits on trailing semicolons and drops comments and blanks', () => {
		const sql = `-- first\nCREATE TABLE a (x UInt8) ENGINE = Memory;\n\nCREATE TABLE b\n(\n  y String\n) ENGINE = Memory;\n`;
		expect(splitStatements(sql)).toEqual([
			'CREATE TABLE a (x UInt8) ENGINE = Memory',
			'CREATE TABLE b\n(\n  y String\n) ENGINE = Memory'
		]);
	});
});
