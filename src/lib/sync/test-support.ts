/** Shared setup for the sync unit tests: a memory platform signed in, and a fake server. */
import { applyChange } from "$lib/changes/apply";
import type { Change } from "$lib/changes/types";
import type { AccountUser } from "$lib/account/identity";
import type { Dashboard, Rect, WidgetInstance } from "$lib/documents/schema";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import type { LogEntry, Platform } from "$lib/platform/types";
import { createMemoryTabHub, type TabMessage } from "$lib/store/tab-channel";
import type { SyncContext } from "./context";
import { saveFields } from "./merge";
import type { RemoteChange, RemoteDocument } from "./remote";
import { createFakeRemote, type FakeRemote } from "./remote-fake";

export const ACCOUNT = "u1";
export const SPACE = `account:${ACCOUNT}` as const;
export const NOW = new Date("2026-11-02T12:00:00.000Z");

export function user(id: string): AccountUser {
	return { id, full_name: "Test", email: null, phone: null, phone_verified: false, language: "en" };
}

export function widget(id: string, rect: Rect = { x: 0, y: 0, w: 6, h: 4 }): WidgetInstance {
	return { id, type: "placeholder", title: null, rect, data: { layers: [] } };
}

export function makeDoc(id = "d1"): Dashboard {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id,
		name: null,
		version: 0,
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		body: { widgets: [widget("a"), widget("b", { x: 6, y: 0, w: 6, h: 4 })] }
	};
}

export const title = (widgetId: string, to: string, from: string | null = null): Change => ({
	op: "setField",
	target: { widgetId, path: "title" },
	from,
	to
});

export const move = (widgetId: string, from: Rect, to: Rect): Change => ({
	op: "setLayout",
	target: { widgetIds: [widgetId] },
	from: { [widgetId]: { rect: from, minimized: null } },
	to: { [widgetId]: { rect: to, minimized: null } }
});

export function applyAll(doc: Dashboard, changes: Change[]): Dashboard {
	return changes.reduce((d, c) => applyChange(d, c).doc, doc);
}

export async function setupSync() {
	const identity = createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) });
	identity.start();
	const platform = createMemoryPlatform({ identity });
	const fake = createFakeRemote({ accountId: ACCOUNT, now: () => NOW });
	const hub = createMemoryTabHub();
	const channel = hub.channel();
	const posted: TabMessage[] = [];
	const post = channel.post.bind(channel);
	channel.post = (msg) => {
		posted.push(msg);
		post(msg);
	};
	const ctx: SyncContext = {
		platform,
		space: SPACE,
		accountId: ACCOUNT,
		remote: fake,
		channel,
		tabId: "sync-worker",
		buildId: "test-build",
		now: () => NOW
	};
	return { identity, platform, fake, hub, ctx, posted };
}

export async function stored(platform: Platform, id = "d1"): Promise<Dashboard> {
	return (await platform.documents.get(SPACE, id)) as Dashboard;
}

export async function storeDoc(platform: Platform, doc: Dashboard = makeDoc()): Promise<void> {
	await platform.documents.commit(SPACE, { docId: doc.id, baseVersion: null, doc, entries: [] });
}

/** Commits `changes` as a tab would. */
export async function edit(
	platform: Platform,
	changes: Change[],
	id = "d1",
	tabId = "tab-1"
): Promise<Dashboard> {
	const doc = await stored(platform, id);
	const next = { ...applyAll(doc, changes), version: doc.version + changes.length };
	const entries: LogEntry[] = changes.map((change, i) => ({
		docId: id,
		version: doc.version + i + 1,
		change,
		tabId,
		schemaVersion: 1
	}));
	const result = await platform.documents.commit(SPACE, {
		docId: id,
		baseVersion: doc.version,
		doc: next,
		entries
	});
	if (!result.ok) throw new Error("commit refused");
	return next;
}

/** Another device saves `changes` on top of the server's current version. */
export async function otherDevice(
	fake: FakeRemote,
	changes: Change[],
	id = "d1",
	overrides: { schemaVersion?: number } = {}
): Promise<void> {
	const signedIn = fake.signedInAs;
	const current = await fake.get(id);
	fake.requests.length = 0;
	const doc = applyAll(
		{ ...makeDoc(id), name: current.name, body: current.body as Dashboard["body"] },
		changes
	);
	await fake.save(id, {
		...saveFields(doc),
		...overrides,
		baseVersion: current.version,
		changes: changes.map((change) => ({ schemaVersion: 1, change })),
		accountId: signedIn!,
		buildId: "other-build",
		snapshot: null
	});
	fake.requests.length = 0;
}

/** The server's state after `since`, as a stale base or a poll brings it. */
export async function serverSince(
	fake: FakeRemote,
	since: number,
	id = "d1"
): Promise<{ version: number; changes: RemoteChange[] | null; document: RemoteDocument }> {
	const answer = await fake.changes(id, since);
	fake.requests.length = 0;
	if (!("document" in answer)) throw new Error("nothing newer");
	return answer;
}

export const titles = (doc: Dashboard) => doc.body.widgets.map((w) => w.title);
