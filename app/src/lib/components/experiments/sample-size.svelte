<script lang="ts">
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import { sampleSize } from '#lib/stats.js';

let { variants }: { variants: number } = $props();

let baseline = $state(10);
let effect = $state(10);

const numberFormat = new Intl.NumberFormat();
const perVariant = $derived(sampleSize(baseline / 100, effect / 100));
</script>

<Card.Root class="min-w-0 gap-4">
	<Card.Header>
		<Card.Title>How many people you need</Card.Title>
		<Card.Description>
			For a conversion metric, the people each variant needs to reliably spot a change of at least
			this size.
		</Card.Description>
	</Card.Header>
	<Card.Content class="grid gap-3">
		<div class="flex flex-wrap gap-4">
			<div class="grid gap-1.5">
				<Label for="baseline">Current conversion rate (%)</Label>
				<Input
					id="baseline"
					type="number"
					min="0.1"
					max="99"
					step="0.1"
					bind:value={baseline}
					class="w-40"
				/>
			</div>
			<div class="grid gap-1.5">
				<Label for="effect">Smallest change to detect (%)</Label>
				<Input
					id="effect"
					type="number"
					min="1"
					max="500"
					step="1"
					bind:value={effect}
					class="w-40"
				/>
			</div>
		</div>
		<p class="text-sm" aria-live="polite">
			{#if perVariant}
				<span class="font-medium tabular-nums">{numberFormat.format(perVariant)}</span>
				people per variant,
				<span class="tabular-nums">{numberFormat.format(perVariant * variants)}</span>
				in total across {variants} variants.
			{:else}
				Pick a rate between 0 and 100% and a change that keeps it under 100%.
			{/if}
		</p>
		<p class="text-xs text-muted-foreground">
			{#if perVariant}
				That is a move from {baseline}% to {Math.round(baseline * (100 + effect)) / 100}%.
			{/if}
			Assumes a 5% false-positive rate and 80% power.
		</p>
	</Card.Content>
</Card.Root>
