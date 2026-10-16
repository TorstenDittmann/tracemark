// Turns thrown values into the `$exception` event's properties (see docs/errors.md). Shared by
// the browser and Node SDKs and bundled into each, so it stays small and dependency free.

/** One stack frame; frames are listed innermost first, so `frames[0]` is where it was thrown. */
export interface StackFrame {
	filename?: string;
	function?: string;
	lineno?: number;
	colno?: number;
	/** Whether the frame is the app's own code rather than a library or the runtime. */
	in_app?: boolean;
}

export interface ExceptionEntry {
	type: string;
	value: string;
	mechanism: { type: string; handled: boolean };
	stacktrace?: { frames: StackFrame[] };
}

export interface ExceptionOptions {
	/** How it was caught: `manual` for `captureException`, or the global handler's name. */
	mechanism?: string;
	/** `false` for errors nothing caught. Default `true`. */
	handled?: boolean;
	/** Decides `in_app` per frame. Defaults to everything outside `node_modules`. */
	inApp?: (filename: string) => boolean;
}

export const MAX_FRAMES = 50;
/** Errors linked through `cause` that are kept after the first. */
export const MAX_CAUSES = 4;
const MAX_VALUE = 2000;

// V8 (Chrome, Node, Bun, Edge): "    at fn (file:1:2)", "    at file:1:2", "    at async fn (file:1:2)"
const V8 = /^\s*at (?:(?:async )?(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
// Firefox and Safari: "fn@file:1:2", "@file:1:2"
const GECKO = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;

/** Parses `error.stack` from V8, Firefox or Safari. Lines it doesn't understand are skipped. */
export function parseStack(stack: string, inApp = defaultInApp): StackFrame[] {
	const frames: StackFrame[] = [];
	for (const line of stack.split('\n')) {
		const match = V8.exec(line) ?? GECKO.exec(line);
		if (!match) continue;
		const [, name, filename = '', lineno, colno] = match;
		const frame: StackFrame = {
			filename,
			lineno: Number(lineno),
			colno: Number(colno),
			in_app: inApp(filename)
		};
		if (name && name !== '<anonymous>') frame.function = name;
		frames.push(frame);
		if (frames.length === MAX_FRAMES) break;
	}
	return frames;
}

function defaultInApp(filename: string): boolean {
	return !/[\\/]node_modules[\\/]/.test(filename) && !filename.startsWith('node:');
}

function describe(value: unknown): { type: string; value: string; stack?: string } {
	if (value instanceof Error) {
		return { type: value.name || 'Error', value: value.message, stack: value.stack };
	}
	if (typeof value === 'object' && value !== null) {
		const { name, message, stack } = value as Record<string, unknown>;
		if (typeof message === 'string') {
			return {
				type: typeof name === 'string' && name ? name : 'Error',
				value: message,
				stack: typeof stack === 'string' ? stack : undefined
			};
		}
		let text: string;
		try {
			text = JSON.stringify(value);
		} catch {
			text = String(value);
		}
		return { type: 'Error', value: `Non-Error thrown: ${text}` };
	}
	return {
		type: 'Error',
		value: typeof value === 'string' ? value : `Non-Error thrown: ${String(value)}`
	};
}

/** The `$exception_list` for a thrown value: the value itself, then its `cause` chain. */
export function exceptionList(error: unknown, options: ExceptionOptions = {}): ExceptionEntry[] {
	const mechanism = { type: options.mechanism ?? 'manual', handled: options.handled ?? true };
	const list: ExceptionEntry[] = [];
	const seen = new Set<unknown>();
	let current: unknown = error;
	while (list.length <= MAX_CAUSES && !seen.has(current)) {
		seen.add(current);
		const { type, value, stack } = describe(current);
		const entry: ExceptionEntry = { type, value: value.slice(0, MAX_VALUE), mechanism };
		const frames = stack ? parseStack(stack, options.inApp) : [];
		if (frames.length) entry.stacktrace = { frames };
		list.push(entry);
		const cause =
			typeof current === 'object' && current !== null
				? (current as { cause?: unknown }).cause
				: undefined;
		if (cause === undefined || cause === null) break;
		current = cause;
	}
	return list;
}
