<script lang="ts">
import type { Component, Snippet } from 'svelte';
import { cn } from '#lib/utils.js';

let {
	icon: Icon,
	title,
	description,
	children,
	class: className
}: {
	icon: Component;
	title: string;
	description?: string;
	children?: Snippet;
	class?: string;
} = $props();
</script>

<div
	class={cn(
		'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center animate-enter',
		className
	)}
>
	<div class="relative">
		<span class="absolute -inset-3 rounded-2xl bg-primary/5 blur-md" aria-hidden="true"></span>
		<span
			class="relative flex size-12 items-center justify-center rounded-xl border bg-card text-primary shadow-sm"
		>
			<Icon class="size-5" />
		</span>
	</div>
	<div class="grid max-w-sm gap-1">
		<p class="font-medium">{title}</p>
		{#if description}
			<p class="text-sm text-muted-foreground">{description}</p>
		{/if}
	</div>
	{#if children}
		<div class="mt-1 flex flex-wrap justify-center gap-2">{@render children()}</div>
	{/if}
</div>
