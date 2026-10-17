<script lang="ts">
import type { Snippet } from 'svelte';
import { cn } from '#lib/utils.js';

let {
	tone = 'muted',
	pulse = false,
	children,
	class: className
}: {
	tone?: 'success' | 'primary' | 'warning' | 'destructive' | 'muted';
	/** A soft ping on the dot, for things that are live right now. */
	pulse?: boolean;
	children: Snippet;
	class?: string;
} = $props();

const tones = {
	success: 'border-success/25 bg-success/10 text-success [--dot:var(--success)]',
	primary: 'border-primary/25 bg-primary/10 text-primary [--dot:var(--primary)]',
	warning:
		'border-warning/30 bg-warning/10 text-amber-700 dark:text-amber-300 [--dot:var(--warning)]',
	destructive:
		'border-destructive/25 bg-destructive/10 text-destructive [--dot:var(--destructive)]',
	muted: 'border-border bg-muted/60 text-muted-foreground [--dot:var(--muted-foreground)]'
};
</script>

<span
	class={cn(
		'inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap',
		tones[tone],
		className
	)}
>
	<span class="relative inline-flex size-1.5" aria-hidden="true">
		{#if pulse}
			<span class="absolute inset-0 rounded-full bg-(--dot) animate-ping-soft"></span>
		{/if}
		<span class="relative size-1.5 rounded-full bg-(--dot)"></span>
	</span>
	{@render children()}
</span>
