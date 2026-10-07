import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './redirect';

describe('safeRedirectPath', () => {
	it('keeps local paths and rejects everything else', () => {
		expect(safeRedirectPath('/projects/1?x=1')).toBe('/projects/1?x=1');
		expect(safeRedirectPath('//evil.example')).toBe('/');
		expect(safeRedirectPath('/\\evil.example')).toBe('/');
		expect(safeRedirectPath('https://evil.example')).toBe('/');
		expect(safeRedirectPath(null, '/projects')).toBe('/projects');
	});
});
