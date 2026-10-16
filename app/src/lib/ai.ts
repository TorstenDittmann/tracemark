// AI observability helpers shared by the server and the pages: trace trees and formatting.

export interface AiEvent {
	uuid: string;
	event: string;
	timestamp: string;
	person: string;
	properties: Record<string, unknown>;
}

export type NodeKind = 'trace' | 'span' | 'generation' | 'embedding';

export interface TraceNode {
	id: string;
	kind: NodeKind;
	name: string;
	/** Milliseconds after the trace started. */
	offset: number;
	/** Milliseconds; 0 when unknown. */
	duration: number;
	/** Cost of this node and everything under it. */
	cost: number;
	error: string | null;
	event: AiEvent;
	children: TraceNode[];
}

const KINDS: Record<string, NodeKind> = {
	$ai_trace: 'trace',
	$ai_span: 'span',
	$ai_generation: 'generation',
	$ai_embedding: 'embedding'
};

export const num = (value: unknown): number | undefined => {
	const n = typeof value === 'string' ? Number(value) : value;
	return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/** The step's name: its span name, else its model, else what kind of event it is. */
export function nodeName(event: AiEvent): string {
	const props = event.properties;
	return (
		str(props.$ai_span_name) ??
		str(props.$ai_model) ??
		(event.event === '$ai_trace' ? 'Trace' : event.event.replace('$ai_', ''))
	);
}

/**
 * The trace's events as a tree, by `$ai_span_id` and `$ai_parent_id`. Events whose parent isn't
 * in the trace (it was dropped, or never sent) hang under the root. With a `$ai_trace` event,
 * that is the root; otherwise the top-level events are the roots.
 */
export function buildTree(events: AiEvent[]): TraceNode[] {
	if (!events.length) return [];
	const start = Math.min(...events.map((e) => Date.parse(e.timestamp)));
	const nodes = events.map((event): TraceNode => {
		const props = event.properties;
		const failed = props.$ai_is_error === true || props.$ai_is_error === 'true';
		return {
			id: str(props.$ai_span_id) ?? event.uuid,
			kind: KINDS[event.event] ?? 'span',
			name: nodeName(event),
			offset: Date.parse(event.timestamp) - start,
			duration: Math.max(0, (num(props.$ai_latency) ?? 0) * 1000),
			cost: num(props.$ai_cost_usd) ?? 0,
			error: failed ? (str(props.$ai_error) ?? 'Failed') : null,
			event,
			children: []
		};
	});
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const root = nodes.find((node) => node.kind === 'trace');
	const roots: TraceNode[] = root ? [root] : [];
	for (const node of nodes) {
		if (node === root) continue;
		const parentId = str(node.event.properties.$ai_parent_id);
		const parent = parentId && parentId !== node.id ? byId.get(parentId) : undefined;
		if (parent && !isAncestor(node, parent)) parent.children.push(node);
		else if (root) root.children.push(node);
		else roots.push(node);
	}
	const total = (node: TraceNode): number => {
		node.children.sort((a, b) => a.offset - b.offset);
		for (const child of node.children) node.cost += total(child);
		return node.cost;
	};
	for (const node of roots) total(node);
	return roots;
}

/** Whether `node` is above `other`, so linking them would make a cycle. */
function isAncestor(node: TraceNode, other: TraceNode): boolean {
	const stack = [...node.children];
	while (stack.length) {
		const next = stack.pop() as TraceNode;
		if (next === other) return true;
		stack.push(...next.children);
	}
	return false;
}

/** Every node, depth first, with its depth. */
export function flatten(nodes: TraceNode[], depth = 0): { node: TraceNode; depth: number }[] {
	return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

/** Dollars with enough digits for fractions of a cent. */
export function formatCost(usd: number): string {
	if (usd === 0) return '$0';
	if (usd < 0.01) return `$${usd.toPrecision(2).replace(/0+$/, '')}`;
	return usd.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export function formatTokens(tokens: number): string {
	return tokens.toLocaleString(undefined, { notation: tokens >= 100_000 ? 'compact' : 'standard' });
}

/** Seconds as `850 ms`, `2.4 s` or `3m 05s`. */
export function formatDuration(seconds: number): string {
	if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
	if (seconds < 60) return `${seconds.toFixed(1)} s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
}

export interface Message {
	role: string;
	/** Text parts as they are; other parts (tool calls, images) as JSON. */
	parts: { kind: 'text' | 'json'; value: string }[];
}

function parts(content: unknown): Message['parts'] {
	if (typeof content === 'string') return [{ kind: 'text', value: content }];
	if (Array.isArray(content)) {
		return content.flatMap((part): Message['parts'] => {
			if (typeof part === 'string') return [{ kind: 'text', value: part }];
			const text = (part as { text?: unknown } | null)?.text;
			if (typeof text === 'string') return [{ kind: 'text', value: text }];
			return [{ kind: 'json', value: JSON.stringify(part, null, 2) }];
		});
	}
	if (content === undefined || content === null) return [];
	return [{ kind: 'json', value: JSON.stringify(content, null, 2) }];
}

/**
 * Inputs and outputs as chat messages when they look like them (`{role, content}` lists, as
 * every provider sends), else null so the page shows the raw JSON.
 */
export function asMessages(value: unknown): Message[] | null {
	const list = typeof value === 'string' ? [{ role: 'user', content: value }] : value;
	if (!Array.isArray(list) || !list.length) return null;
	const messages: Message[] = [];
	for (const item of list) {
		if (
			!item ||
			typeof item !== 'object' ||
			typeof (item as { role?: unknown }).role !== 'string'
		) {
			return null;
		}
		const { role, content, ...rest } = item as Record<string, unknown>;
		const extra = Object.keys(rest).length
			? [{ kind: 'json' as const, value: JSON.stringify(rest, null, 2) }]
			: [];
		messages.push({ role: role as string, parts: [...parts(content), ...extra] });
	}
	return messages;
}
