export function unionOfOtherTypeSelections(
	selections: Map<string, Set<string>>,
	activeType: string
): Set<string> {
	const union = new Set<string>();
	for (const [type, ids] of selections) {
		if (type === activeType) continue;
		for (const id of ids) union.add(id);
	}
	return union;
}

export function shouldNarrow(
	selections: Map<string, Set<string>>,
	activeType: string,
	narrowingEnabled: Map<string, boolean>
): boolean {
	if (unionOfOtherTypeSelections(selections, activeType).size === 0) return false;
	return narrowingEnabled.get(activeType) !== false;
}

export function pruneSelection(selection: Set<string>, availableIds: Set<string>): Set<string> {
	const pruned = new Set<string>();
	for (const id of selection) {
		if (availableIds.has(id)) pruned.add(id);
	}
	return pruned;
}
