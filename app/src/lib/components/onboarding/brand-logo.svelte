<script lang="ts">
import { BRAND_ICONS } from '#lib/brand-icons.js';
import { cn } from '#lib/utils.js';

let { icon, label, class: className }: { icon: string; label: string; class?: string } = $props();

const brand = $derived(BRAND_ICONS[icon]);
</script>

{#if brand}
	<svg
		viewBox="0 0 24 24"
		class={cn('size-5', className)}
		style:fill={brand.color ?? 'currentColor'}
		aria-hidden="true"
	>
		<path d={brand.path} />
	</svg>
{:else}
	<span
		class={cn(
			'flex size-5 items-center justify-center text-sm leading-none font-semibold',
			className
		)}
		aria-hidden="true"
		>{label.charAt(0)}</span
	>
{/if}
