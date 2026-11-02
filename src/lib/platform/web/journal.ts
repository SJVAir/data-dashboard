import { JOURNAL_RECORD_MAX, type JournalStorage, type SpaceId } from "../types";

const PREFIX = "sjvair-workspace:journal:";

const docPrefix = (space: SpaceId, docId: string) => `${PREFIX}${space}:${docId}:`;

/** The space a journal key belongs to (account ids contain no colon). */
function spaceOf(key: string): SpaceId | undefined {
	const rest = key.slice(PREFIX.length);
	if (rest.startsWith("anonymous:")) return "anonymous";
	const match = /^account:([^:]+):/.exec(rest);
	return match ? `account:${match[1]}` : undefined;
}

function journalKeys(s: Storage): string[] {
	const keys: string[] = [];
	for (let i = 0; i < s.length; i++) {
		const key = s.key(i);
		if (key !== null && key.startsWith(PREFIX)) keys.push(key);
	}
	return keys;
}

/** Whole-space journal operations, for `SpaceStorage`. Blocked storage makes each a no-op. */
export function createWebJournalSpaces(storage: () => Storage = () => localStorage) {
	return {
		/** Every space with a journal record. */
		list(): SpaceId[] {
			try {
				const found = new Set<SpaceId>();
				for (const key of journalKeys(storage())) {
					const space = spaceOf(key);
					if (space) found.add(space);
				}
				return [...found];
			} catch {
				return [];
			}
		},
		remove(space: SpaceId): void {
			try {
				const s = storage();
				const prefix = `${PREFIX}${space}:`;
				for (const key of journalKeys(s)) if (key.startsWith(prefix)) s.removeItem(key);
			} catch {
				// Blocked storage: there is nothing to remove.
			}
		},
		/** Moves the dashboards' records, replacing any `to` already holds for them. */
		move(from: SpaceId, to: SpaceId, ids: string[]): void {
			if (from === to) return;
			try {
				const s = storage();
				const keys = journalKeys(s);
				for (const id of ids) {
					const source = docPrefix(from, id);
					const target = docPrefix(to, id);
					for (const key of keys) if (key.startsWith(target)) s.removeItem(key);
					for (const key of keys) {
						if (!key.startsWith(source)) continue;
						const json = s.getItem(key);
						if (json !== null) s.setItem(target + key.slice(source.length), json);
						s.removeItem(key);
					}
				}
			} catch {
				// Quota or blocked storage: records not moved stay where they were.
			}
		}
	};
}

/**
 * The journal in `localStorage`, which (unlike IndexedDB) is written synchronously, so a record
 * written in `pagehide` survives the page being torn down. Keys:
 * `sjvair-workspace:journal:<space>:<docId>:<tabId>`. Storage that is blocked or full makes
 * every call a no-op. Dashboard ids contain no colon (the tab id may). A record whose JSON is
 * over `JOURNAL_RECORD_MAX` characters isn't written.
 */
export function createWebJournal(storage: () => Storage = () => localStorage): JournalStorage {
	return {
		write(space, docId, tabId, record) {
			try {
				const json = JSON.stringify(record);
				if (json.length > JOURNAL_RECORD_MAX) return;
				storage().setItem(docPrefix(space, docId) + tabId, json);
			} catch {
				// Quota or blocked storage: nothing more can be done as the page goes away.
			}
		},
		readAll(space, docId) {
			const prefix = docPrefix(space, docId);
			const found: Array<{ tabId: string; record: unknown }> = [];
			try {
				const s = storage();
				for (let i = 0; i < s.length; i++) {
					const key = s.key(i);
					if (key === null || !key.startsWith(prefix)) continue;
					let record: unknown;
					try {
						record = JSON.parse(s.getItem(key) ?? "null");
					} catch {
						record = null;
					}
					found.push({ tabId: key.slice(prefix.length), record });
				}
			} catch {
				return [];
			}
			return found;
		},
		list(space) {
			const prefix = `${PREFIX}${space}:`;
			const found: Array<{ docId: string; tabId: string; record: unknown }> = [];
			try {
				const s = storage();
				for (let i = 0; i < s.length; i++) {
					const key = s.key(i);
					if (key === null || !key.startsWith(prefix)) continue;
					const rest = key.slice(prefix.length);
					const colon = rest.indexOf(":");
					if (colon < 0) continue;
					let record: unknown;
					try {
						record = JSON.parse(s.getItem(key) ?? "null");
					} catch {
						record = null;
					}
					found.push({ docId: rest.slice(0, colon), tabId: rest.slice(colon + 1), record });
				}
			} catch {
				return [];
			}
			return found;
		},
		clear(space, docId, tabId) {
			try {
				storage().removeItem(docPrefix(space, docId) + tabId);
			} catch {
				// Blocked storage: there is nothing to clear.
			}
		}
	};
}
