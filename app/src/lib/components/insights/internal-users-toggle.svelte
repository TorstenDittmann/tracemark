<script lang="ts">
import { Checkbox } from '#lib/components/ui/checkbox/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import { parseInternalRulesJson } from '#lib/internal-users.js';

let {
	value,
	project,
	onchange
}: {
	/** The insight's own choice; absent follows the project. */
	value: boolean | undefined;
	project: { id: string; filterInternal: boolean; internalUsers: string };
	onchange: (filter: boolean) => void;
} = $props();

const rules = $derived(parseInternalRulesJson(project.internalUsers).length);
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
	<Label class="flex items-center gap-2 font-normal">
		<Checkbox
			checked={rules > 0 && (value ?? project.filterInternal)}
			disabled={rules === 0}
			onCheckedChange={(checked) => onchange(checked)}
		/>
		Filter internal users
	</Label>
	{#if rules === 0}
		<a
			class="text-muted-foreground underline hover:text-foreground"
			href="/projects/{project.id}/settings"
			>Set up internal users</a
		>
	{/if}
</div>
