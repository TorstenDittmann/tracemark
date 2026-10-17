<script lang="ts">
import type { Component, Snippet } from 'svelte';
import { cn } from '#lib/utils.js';

let {
	title,
	description,
	icon: Icon,
	actions,
	class: className
}: {
	title: string;
	description?: string;
	icon?: Component;
	actions?: Snippet;
	class?: string;
} = $props();
</script>

<div class={cn('flex flex-wrap items-start justify-between gap-4', className)}>
	<div class="flex min-w-0 items-start gap-3">
		{#if Icon}
			<span
				class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card text-primary shadow-xs"
			>
				<Icon class="size-5" />
			</span>
		{/if}
		<div class="min-w-0">
			<h1 class="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
			{#if description}
				<p class="text-sm text-muted-foreground">{description}</p>
			{/if}
		</div>
	</div>
	{#if actions}
		<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>
	{/if}
</div>
