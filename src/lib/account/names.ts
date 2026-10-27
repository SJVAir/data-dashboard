function words(fullName: string): string[] {
	return fullName.split(/\s+/).filter(Boolean);
}

function firstCodePoint(word: string): string {
	return String.fromCodePoint(word.codePointAt(0) as number);
}

/** The trimmed name, or null if empty. */
export function displayName(fullName: string): string | null {
	return fullName.trim() || null;
}

/** The first word of the name, or null if empty. */
export function greetingName(fullName: string): string | null {
	return words(fullName)[0] ?? null;
}

/** First letter of the first and last words (one word gives one letter), or null if empty. */
export function initials(fullName: string): string | null {
	const parts = words(fullName);
	if (parts.length === 0) return null;
	const picked =
		parts.length === 1
			? firstCodePoint(parts[0])
			: firstCodePoint(parts[0]) + firstCodePoint(parts[parts.length - 1]);
	return picked.toLocaleUpperCase();
}
