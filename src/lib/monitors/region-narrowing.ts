export function pruneSelection(selection: Set<string>, availableIds: Set<string>): Set<string> {
	const pruned = new Set<string>();
	for (const id of selection) {
		if (availableIds.has(id)) pruned.add(id);
	}
	return pruned;
}
