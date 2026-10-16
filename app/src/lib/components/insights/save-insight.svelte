<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { enhance } from '$app/forms';
import { selectClass } from './editor.svelte.js';

let {
	query,
	saved,
	dashboards,
	dashboardsHref,
	form
}: {
	query: unknown;
	saved: { id: string; name: string } | null;
	dashboards: { id: string; name: string }[];
	dashboardsHref: string;
	form: { action?: string; message?: string } | null | undefined;
} = $props();

const queryJson = $derived(JSON.stringify(query));
</script>

<div class="flex flex-wrap items-end gap-x-6 gap-y-3">
	<form method="POST" action="?/save" use:enhance class="flex flex-wrap items-center gap-2">
		<input type="hidden" name="query" value={queryJson}>
		{#if saved}
			<input type="hidden" name="insight" value={saved.id}>
		{/if}
		<Input
			name="name"
			aria-label="Insight name"
			placeholder="Name this insight"
			value={saved?.name ?? ''}
			maxlength={100}
			required
			class="h-8 w-56"
		/>
		<Button type="submit" size="sm">{saved ? 'Save changes' : 'Save'}</Button>
		{#if saved}
			<Button type="submit" size="sm" variant="outline" name="as_new" value="1">Save as new</Button>
		{/if}
	</form>

	{#if saved}
		{#if dashboards.length}
			<form
				method="POST"
				action="?/addToDashboard"
				use:enhance
				class="flex flex-wrap items-center gap-2"
			>
				<input type="hidden" name="insight" value={saved.id}>
				<select name="dashboard" class={selectClass} aria-label="Dashboard">
					{#each dashboards as dashboard (dashboard.id)}
						<option value={dashboard.id}>{dashboard.name}</option>
					{/each}
				</select>
				<Button type="submit" size="sm" variant="outline">Add to dashboard</Button>
			</form>
		{:else}
			<a href={dashboardsHref} class="text-sm text-muted-foreground underline underline-offset-4">
				Create a dashboard to pin this insight
			</a>
		{/if}
	{/if}
</div>
{#if form?.message}
	<p class="text-sm text-muted-foreground" role="status">{form.message}</p>
{/if}
