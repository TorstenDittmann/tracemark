<script lang="ts">
import type { HTMLInputAttributes } from 'svelte/elements';
import { cn, type WithElementRef } from '#lib/utils.js';

type Props = WithElementRef<HTMLInputAttributes>;

let {
	ref = $bindable(null),
	value = $bindable(),
	class: className,
	...restProps
}: Props = $props();
</script>

<input
	bind:this={ref}
	data-slot="input"
	class={cn(
		'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
		'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
		'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
		className
	)}
	bind:value
	{...restProps}
>
