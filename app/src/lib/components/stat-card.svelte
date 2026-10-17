<script lang="ts">
import type { Component, Snippet } from 'svelte';
import Sparkline from '#lib/components/sparkline.svelte';
import { cn } from '#lib/utils.js';

let {
	label,
	value,
	icon: Icon,
	trend,
	hint,
	footer,
	class: className
}: {
	label: string;
	value: string;
	icon?: Component;
	/** Values over time for a sparkline under the number. */
	trend?: number[];
	hint?: string;
	footer?: Snippet;
	class?: string;
} = $props();
</script>

<div
	class={cn(
		'group relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md',
		className
	)}
>
	<div class="flex items-center justify-between gap-2">
		<span class="truncate text-sm text-muted-foreground">{label}</span>
		{#if Icon}
			<Icon class="size-4 text-muted-foreground/70 transition-colors group-hover:text-primary" />
		{/if}
	</div>
	<span class="truncate text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
	{#if hint}
		<span class="text-xs text-muted-foreground">{hint}</span>
	{/if}
	{#if footer}
		{@render footer()}
	{/if}
	{#if trend}
		<Sparkline values={trend} class="-mx-4 -mb-4 mt-auto h-10 w-[calc(100%+2rem)]" />
	{/if}
</div>
