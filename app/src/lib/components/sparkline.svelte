<script lang="ts">
/** A small area trend without axes, for stat cards. */
let {
	values,
	class: className = 'h-10 w-full',
	color = 'var(--primary)'
}: { values: number[]; class?: string; color?: string } = $props();

const id = $props.id();
const max = $derived(Math.max(1, ...values));
const line = $derived(
	values
		.map(
			(v, i) =>
				`${i ? 'L' : 'M'}${values.length > 1 ? (i / (values.length - 1)) * 100 : 50},${30 - (v / max) * 27}`
		)
		.join('')
);
</script>

{#if values.length > 1}
	<svg viewBox="0 0 100 30" preserveAspectRatio="none" class={className} aria-hidden="true">
		<defs>
			<linearGradient id="spark-{id}" x1="0" x2="0" y1="0" y2="1">
				<stop offset="0" stop-color={color} stop-opacity="0.25" />
				<stop offset="1" stop-color={color} stop-opacity="0" />
			</linearGradient>
		</defs>
		<path d="{line}L100,30L0,30Z" fill="url(#spark-{id})" />
		<path
			d={line}
			fill="none"
			stroke={color}
			stroke-width="1.5"
			vector-effect="non-scaling-stroke"
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
	</svg>
{/if}
