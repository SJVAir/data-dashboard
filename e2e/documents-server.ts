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
	type Profile,
	type RemoteDocument,
	type RemoteMeta,
	type SharedRemoteDocument
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
		visibility: doc.shareToken ? "link" : "private",
		share_token: doc.shareToken
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

type Answer = { status: number; data: unknown };
type Call = { request: Request; params: string[]; url: URL };
type Handler = (fake: FakeRemote, call: Call) => Promise<Answer>;

function ok(data: unknown): Answer {
	return { status: 200, data };
}

function wireShared(doc: SharedRemoteDocument) {
	return {
		id: doc.id,
		kind: doc.kind,
		name: doc.name,
		schema_version: doc.schemaVersion,
		version: doc.version,
		body: doc.body,
		updated_at: doc.updatedAt,
		display_name: doc.displayName
	};
}

/** `?since=` as the fake takes it: a number, or `NaN` when missing (the fake refuses it). */
function since(url: URL): number {
	const value = url.searchParams.get("since");
	return value === null ? NaN : Number(value);
}

/**
 * The documents endpoints the SDK calls, as `[method, path after /api/2.0/documents/, handler]`.
 * Fixed paths come before `<id>/…`, as the server's `urls.py` orders them.
 */
const ROUTES: Array<[string, RegExp, Handler]> = [
	[
		"GET",
		/^$/,
		async (fake, { url }) => {
			const list = await fake.list(url.searchParams.get("since") ?? undefined);
			return ok({
				// The list adds each body's size, which the dashboard doesn't read.
				documents: list.documents.map((doc) => ({ ...wireMeta(doc), size: 0 })),
				purged: list.purged,
				cursor: list.cursor
			});
		}
	],
	["GET", /^profile\/$/, async (fake) => ok(wireProfile(await fake.getProfile()))],
	[
		"PUT",
		/^profile\/$/,
		async (fake, { request }) =>
			ok(wireProfile(await fake.setProfile(request.postDataJSON().display_name)))
	],
	[
		"GET",
		/^shared\/([^/]+)\/changes\/$/,
		async (fake, { params: [token], url }) => {
			const answer = await fake.sharedChanges(token, since(url));
			// The whole shared document, unwrapped, when it changed.
			return ok("document" in answer ? wireShared(answer.document) : { version: answer.version });
		}
	],
	[
		"GET",
		/^shared\/([^/]+)\/$/,
		async (fake, { params: [token] }) => ok(wireShared(await fake.shared(token)))
	],
	[
		"POST",
		/^([^/]+)\/share\/$/,
		async (fake, { params: [id] }) => ok({ share_token: await fake.share(id) })
	],
	[
		"DELETE",
		/^([^/]+)\/share\/$/,
		async (fake, { params: [id] }) => {
			await fake.unshare(id);
			return { status: 204, data: undefined };
		}
	],
	[
		"GET",
		/^([^/]+)\/credit\/$/,
		async (fake, { params: [id] }) => {
			const credit = await fake.credit(id);
			return ok({ name: credit.name, display_name: credit.displayName });
		}
	],
	[
		"POST",
		/^([^/]+)\/snapshots\/$/,
		async (fake, { params: [id], request }) => {
			const form = request.postDataJSON();
			await fake.keepSnapshot(id, {
				baseVersion: form.base_version,
				schemaVersion: form.schema_version,
				name: form.name,
				body: form.body,
				accountId: form.account_id,
				buildId: form.build_id
			});
			const row = fake.snapshots(id).at(-1)!;
			return {
				status: 201,
				data: {
					id: row.id,
					version: row.version,
					schema_version: row.schemaVersion,
					reason: row.reason,
					created_at: row.createdAt
				}
			};
		}
	],
	[
		"GET",
		/^([^/]+)\/snapshots\/$/,
		async (fake, { params: [id] }) =>
			ok(
				(await fake.listSnapshots(id)).map((s) => ({
					id: s.id,
					version: s.version,
					schema_version: s.schemaVersion,
					reason: s.reason,
					created_at: s.createdAt
				}))
			)
	],
	[
		"GET",
		/^([^/]+)\/snapshots\/(\d+)\/$/,
		async (fake, { params: [id, n] }) => {
			const s = await fake.getSnapshot(id, Number(n));
			return ok({
				id: s.id,
				version: s.version,
				schema_version: s.schemaVersion,
				name: s.name,
				body: s.body,
				created_at: s.createdAt
			});
		}
	],
	[
		"DELETE",
		/^([^/]+)\/$/,
		async (fake, { params: [id] }) => {
			await fake.deletePermanently(id);
			return { status: 204, data: undefined };
		}
	],
	[
		"GET",
		/^([^/]+)\/changes\/$/,
		async (fake, { params: [id], url }) => {
			const answer = await fake.changes(id, since(url));
			if (!("document" in answer)) return ok({ version: answer.version });
			return ok({
				version: answer.version,
				changes: wireChanges(answer.changes),
				document: wireDocument(answer.document)
			});
		}
	],
	["GET", /^([^/]+)\/$/, async (fake, { params: [id] }) => ok(wireDocument(await fake.get(id)))],
	[
		"PUT",
		/^([^/]+)\/$/,
		async (fake, { params: [id], request }) => {
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
			return ok({ version: result.version, updated_at: result.updatedAt });
		}
	]
];

function wireProfile(profile: Profile) {
	return { display_name: profile.displayName };
}

const PREFIX = "/api/2.0/documents/";

/** Answers one documents request from the fake, or throws what the fake threw. */
async function answer(fake: FakeRemote, request: Request): Promise<Answer> {
	const url = new URL(request.url());
	const at = url.pathname.indexOf(PREFIX);
	if (at === -1) throw new Error("unmatched");
	const path = url.pathname.slice(at + PREFIX.length);
	const method = request.method();
	for (const [routeMethod, pattern, handler] of ROUTES) {
		const match = routeMethod === method ? path.match(pattern) : null;
		if (match)
			return handler(fake, { request, url, params: match.slice(1).map(decodeURIComponent) });
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
				if (status === 204) await route.fulfill({ status });
				else await route.fulfill({ status, json: { data } });
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
