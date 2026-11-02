/**
 * The mocked documents server for E2E tests: an in-memory fake (`createFakeRemote`) served over
 * Playwright routes, in the server's wire shapes (snake_case fields, `{ data }` envelopes, and
 * refusals as `{ errors: { detail: [{ code, message }] }, data }` with the server's status).
 *
 * One fake serves every context ("device") in a test. Each context has its own session, so a
 * request runs as whoever that context's account route says is signed in.
 */
import type { BrowserContext, Request, Route } from "@playwright/test";
import {
	RemoteRefusal,
	RemoteUnavailable,
	type RemoteChange,
	type RemoteDocument,
	type RemoteMeta
} from "../src/lib/sync/remote";
import type { FakeRemote } from "../src/lib/sync/remote-fake";

/** The `csrftoken` cookie each context gets; writes must echo it, as Django's check requires. */
export const CSRF_TOKEN = "e2e-csrf-token";

type WireChange = { version: number; schema_version: number; change: unknown };

function wireMeta(doc: RemoteMeta) {
	return {
		id: doc.id,
		kind: doc.kind,
		name: doc.name,
		schema_version: doc.schemaVersion,
		version: doc.version,
		copied_from: doc.copiedFrom,
		deleted_at: doc.deletedAt,
		created_at: doc.createdAt,
		updated_at: doc.updatedAt,
		// Sharing is spec 3; the fake doesn't model it.
		visibility: "private",
		share_token: null
	};
}

function wireDocument(doc: RemoteDocument) {
	return { ...wireMeta(doc), body: doc.body };
}

function wireChanges(changes: RemoteChange[] | null): WireChange[] | null {
	return (
		changes?.map((c) => ({
			version: c.version,
			schema_version: c.schemaVersion,
			change: c.change
		})) ?? null
	);
}

function fromWireChanges(changes: unknown): Array<{ schemaVersion: number; change: unknown }> {
	if (!Array.isArray(changes)) return changes as never;
	return changes.map((c: { schema_version: number; change: unknown }) => ({
		schemaVersion: c.schema_version,
		change: c.change
	}));
}

/** A refusal in the server's error shape. */
function refusalBody(refusal: RemoteRefusal) {
	const stale = refusal.staleBase;
	const data = stale
		? {
				version: stale.version,
				schema_version: stale.document.schemaVersion,
				changes: wireChanges(stale.changes),
				document: wireDocument(stale.document)
			}
		: undefined;
	return { errors: { detail: [{ code: refusal.code, message: refusal.code }] }, data };
}

/** The documents endpoint a request is for, or `null` when it isn't one the SDK calls. */
function endpoint(request: Request) {
	const url = new URL(request.url());
	const match = url.pathname.match(
		/\/api\/2\.0\/documents\/(?:([^/]+)\/(?:(changes|snapshots)\/)?)?$/
	);
	if (!match) return null;
	const [, rawId, sub] = match;
	return { id: rawId === undefined ? undefined : decodeURIComponent(rawId), sub, url };
}

/** Answers one documents request from the fake, or throws what the fake threw. */
async function answer(
	fake: FakeRemote,
	request: Request
): Promise<{ status: number; data: unknown }> {
	const target = endpoint(request);
	const method = request.method();
	if (!target) throw new Error("unmatched");
	const { id, sub, url } = target;
	const since = url.searchParams.get("since");
	if (id === undefined && method === "GET") {
		const list = await fake.list(since ?? undefined);
		return {
			status: 200,
			data: {
				// The list adds each body's size, which the dashboard doesn't read.
				documents: list.documents.map((doc) => ({ ...wireMeta(doc), size: 0 })),
				purged: list.purged,
				cursor: list.cursor
			}
		};
	}
	if (id === undefined) throw new Error("unmatched");
	if (sub === undefined && method === "GET") {
		return { status: 200, data: wireDocument(await fake.get(id)) };
	}
	if (sub === "changes" && method === "GET") {
		const answer = await fake.changes(id, since === null ? NaN : Number(since));
		if (!("document" in answer)) return { status: 200, data: { version: answer.version } };
		return {
			status: 200,
			data: {
				version: answer.version,
				changes: wireChanges(answer.changes),
				document: wireDocument(answer.document)
			}
		};
	}
	if (sub === undefined && method === "PUT") {
		const form = request.postDataJSON();
		const result = await fake.save(id, {
			schemaVersion: form.schema_version,
			name: form.name,
			body: form.body,
			deletedAt: form.deleted_at,
			copiedFrom: form.copied_from,
			baseVersion: form.base_version,
			changes: fromWireChanges(form.changes),
			accountId: form.account_id,
			buildId: form.build_id,
			snapshot: form.snapshot ?? null
		});
		return { status: 200, data: { version: result.version, updated_at: result.updatedAt } };
	}
	if (sub === "snapshots" && method === "POST") {
		const form = request.postDataJSON();
		await fake.keepSnapshot(id, {
			baseVersion: form.base_version,
			schemaVersion: form.schema_version,
			name: form.name,
			body: form.body,
			accountId: form.account_id,
			buildId: form.build_id
		});
		const kept = fake.snapshots(id).length;
		return {
			status: 201,
			data: {
				id: kept,
				version: form.base_version,
				schema_version: form.schema_version,
				reason: "conflict",
				created_at: new Date().toISOString()
			}
		};
	}
	throw new Error("unmatched");
}

/**
 * Serves `fake` to `context` (register it after the API fixture route, so it takes precedence).
 * `signedInAs` is the id of whoever the context's session belongs to (`null`: signed out).
 * Requests the SDK never makes are recorded in `unmatched` and fail.
 */
export async function routeDocuments(
	context: BrowserContext,
	fake: FakeRemote,
	signedInAs: () => string | null,
	unmatched: string[]
): Promise<void> {
	await context.route(
		(url) => url.pathname.includes("/api/2.0/documents/"),
		async (route: Route) => {
			const request = route.request();
			const method = request.method();
			if (method !== "GET" && request.headers()["x-csrftoken"] !== CSRF_TOKEN) {
				// Django's CSRF failure: an HTML 403 page.
				await route.fulfill({ status: 403, contentType: "text/html", body: "<h1>Forbidden</h1>" });
				return;
			}
			// The fake reads the session as each call starts (before its first await).
			fake.signedInAs = signedInAs();
			try {
				const { status, data } = await answer(fake, request);
				await route.fulfill({ status, json: { data } });
			} catch (error) {
				if (error instanceof RemoteRefusal) {
					await route.fulfill({ status: error.status, json: refusalBody(error) });
				} else if (error instanceof RemoteUnavailable) {
					await route.abort("internetdisconnected");
				} else {
					unmatched.push(`${method} ${new URL(request.url()).pathname}`);
					await route.abort();
				}
			}
		}
	);
}
