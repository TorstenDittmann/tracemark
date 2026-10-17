<script lang="ts">
import { cn } from '#lib/utils.js';

let { id, name, class: className }: { id: string; name: string; class?: string } = $props();

/** A stable hue per project so the same project always looks the same. */
const hue = $derived([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
</script>

<span
	aria-hidden="true"
	class={cn(
		'flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white shadow-sm ring-1 ring-black/5 ring-inset',
		className
	)}
	style="background: linear-gradient(135deg, oklch(0.68 0.17 {hue}), oklch(0.5 0.2 {(hue + 40) %
		360}))"
>
	{name.trim().charAt(0).toUpperCase() || '?'}
</span>
