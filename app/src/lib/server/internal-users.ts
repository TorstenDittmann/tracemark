// Leaving internal users out of analytics queries (see docs/internal-users.md).

import { validName } from '../insights';
import type { InternalRule } from '../internal-users';

/** A person's latest email (`set`, else `set_once`) from one distinct id's person properties, lowercased. */
const EMAIL = `lower(JSONExtractString(if(argMaxMerge(set_value) != '', argMaxMerge(set_value), argMinMerge(set_once_value))))`;

/**
 * The condition that leaves internal users out of a query over `events AS e`, as ` AND …`, or
 * an empty string without rules. Adds its parameters to `params`, which must already hold
 * `project`.
 *
 * Email and distinct id rules match people: every distinct id of a matching person is left out,
 * so anonymous events from before they identified go too. Property rules match single events.
 */
export function internalUsersSql(
	rules: InternalRule[] | undefined,
	params: Record<string, string | string[]>
): string {
	if (!rules?.length) return '';
	const emails: string[] = [];
	const ids: string[] = [];
	const conditions: string[] = [];
	rules.forEach((rule, i) => {
		const param = `ix${i}`;
		params[param] = rule.value;
		switch (rule.kind) {
			case 'email':
				emails.push(`${EMAIL} = {${param}:String}`);
				break;
			case 'email_domain':
				emails.push(`endsWith(${EMAIL}, {${param}:String})`);
				break;
			case 'distinct_id':
				ids.push(`{${param}:String}`);
				break;
			case 'property':
				// Names are validated when rules are parsed; checked again since they go into the SQL.
				if (!validName(rule.property)) throw new Error('invalid internal user property');
				conditions.push(`toString(e.properties.\`${rule.property}\`) != {${param}:String}`);
				break;
		}
	});
	const matched: string[] = [];
	if (emails.length) {
		matched.push(`SELECT distinct_id AS id FROM person_properties
			WHERE project_id = {project:UUID} AND key = 'email'
			GROUP BY distinct_id
			HAVING ${emails.join(' OR ')}`);
	}
	if (ids.length) matched.push(`SELECT arrayJoin([${ids.join(', ')}]) AS id`);
	if (matched.length) {
		// The person keys of the matched ids, then every distinct id that belongs to them.
		const people = `SELECT if(a.person = '', m.id, a.person) AS person
			FROM (${matched.join(' UNION ALL ')}) AS m
			LEFT JOIN (SELECT alias, person FROM person_distinct_ids WHERE project_id = {project:UUID}) AS a
				ON a.alias = m.id`;
		conditions.unshift(`e.distinct_id NOT IN (
			SELECT person FROM (${people})
			UNION ALL
			SELECT alias FROM person_distinct_ids
			WHERE project_id = {project:UUID} AND person IN (${people})
		)`);
	}
	return conditions.map((condition) => ` AND ${condition}`).join('');
}
