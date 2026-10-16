import { describe, expect, it } from 'vitest';
import { exceptionList, MAX_FRAMES, parseStack } from '../src/index';

describe('parseStack', () => {
	it('reads V8 stacks', () => {
		const stack = [
			'TypeError: x is not a function',
			'    at render (https://example.com/assets/index-B3xk9aZ1.js:10:20)',
			'    at async load (https://example.com/assets/index-B3xk9aZ1.js:30:5)',
			'    at https://example.com/assets/vendor.js:1:2',
			'    at Object.<anonymous> (/app/node_modules/lib/index.js:4:9)',
			'    at node:internal/process/task_queues:95:5',
			'    at new Promise (<anonymous>)'
		].join('\n');
		expect(parseStack(stack)).toEqual([
			{
				function: 'render',
				filename: 'https://example.com/assets/index-B3xk9aZ1.js',
				lineno: 10,
				colno: 20,
				in_app: true
			},
			{
				function: 'load',
				filename: 'https://example.com/assets/index-B3xk9aZ1.js',
				lineno: 30,
				colno: 5,
				in_app: true
			},
			{ filename: 'https://example.com/assets/vendor.js', lineno: 1, colno: 2, in_app: true },
			{
				function: 'Object.<anonymous>',
				filename: '/app/node_modules/lib/index.js',
				lineno: 4,
				colno: 9,
				in_app: false
			},
			{ filename: 'node:internal/process/task_queues', lineno: 95, colno: 5, in_app: false }
		]);
	});

	it('reads Firefox and Safari stacks', () => {
		const stack = [
			'render@https://example.com/app.js:10:20',
			'@https://example.com/app.js:1:2',
			'promise callback*load@https://example.com/app.js:3:4'
		].join('\n');
		expect(parseStack(stack, () => true)).toEqual([
			{
				function: 'render',
				filename: 'https://example.com/app.js',
				lineno: 10,
				colno: 20,
				in_app: true
			},
			{ filename: 'https://example.com/app.js', lineno: 1, colno: 2, in_app: true },
			{
				function: 'promise callback*load',
				filename: 'https://example.com/app.js',
				lineno: 3,
				colno: 4,
				in_app: true
			}
		]);
	});

	it('keeps at most MAX_FRAMES frames', () => {
		const stack = Array.from({ length: 80 }, (_, i) => `    at f${i} (/app/a.js:${i + 1}:1)`).join(
			'\n'
		);
		expect(parseStack(stack)).toHaveLength(MAX_FRAMES);
	});
});

describe('exceptionList', () => {
	it('describes an error and its causes', () => {
		const root = new RangeError('too far');
		const error = new Error('could not save', { cause: root });
		const list = exceptionList(error, { mechanism: 'onerror', handled: false });
		expect(list.map(({ type, value, mechanism }) => ({ type, value, mechanism }))).toEqual([
			{ type: 'Error', value: 'could not save', mechanism: { type: 'onerror', handled: false } },
			{ type: 'RangeError', value: 'too far', mechanism: { type: 'onerror', handled: false } }
		]);
		expect(list[0]?.stacktrace?.frames[0]?.filename).toContain('errors.test.ts');
	});

	it('describes things that are not errors', () => {
		expect(exceptionList('boom')).toEqual([
			{ type: 'Error', value: 'boom', mechanism: { type: 'manual', handled: true } }
		]);
		expect(exceptionList({ code: 42 })[0]?.value).toBe('Non-Error thrown: {"code":42}');
		expect(exceptionList(undefined)[0]?.value).toBe('Non-Error thrown: undefined');
		expect(exceptionList({ name: 'HttpError', message: 'Not found' })[0]).toMatchObject({
			type: 'HttpError',
			value: 'Not found'
		});
	});

	it('stops at cycles and long cause chains', () => {
		const a = new Error('a');
		const b = new Error('b', { cause: a });
		(a as { cause?: unknown }).cause = b;
		expect(exceptionList(a).map((e) => e.value)).toEqual(['a', 'b']);
		let deep: Error = new Error('0');
		for (let i = 1; i < 10; i++) deep = new Error(String(i), { cause: deep });
		expect(exceptionList(deep)).toHaveLength(5);
	});

	it('cuts long messages', () => {
		expect(exceptionList(new Error('x'.repeat(5000)))[0]?.value).toHaveLength(2000);
	});
});
