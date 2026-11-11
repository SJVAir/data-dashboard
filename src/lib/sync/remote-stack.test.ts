/**
 * The remote contract against a running sjvair.com (local-only; skipped unless `SYNC_STACK=1`).
 *
 *   WORKSPACE_E2E_IDENTIFIER=... WORKSPACE_E2E_PASSWORD=... npm run test:sync-stack
 *
 * `WORKSPACE_E2E_ORIGIN` sets the server (default http://localhost:8000). It signs in through the
 * site's login form, as sdk-js's documents integration test did, and passes the session cookie
 * and CSRF token through `init` (outside a browser the client sends neither itself); the signed-out
 * caller the sharing cases use is a remote without them. The documents
 * it creates are trashed and permanently deleted at the end.
 *
 * "documents client" below holds the steps of sdk-js's `lib/documents/mod_test.ts` (819d152) that
 * the contract doesn't cover on the stack, run against `$lib/api/documents` directly.
 */
import { afterAll, describe, expect, test } from "vitest";
import { getUserDetails } from "@sjvair/sdk/account/details";
import {
	createSnapshot,
	deleteDocument,
	getDocument,
	getSnapshot,
	isDocumentRefusal,
	listDocuments,
	listSnapshots,
	saveDocument,
	type RefusalCode,
	type SaveDocumentForm
} from "$lib/api/documents";
import { setOrigin, type RequestOptions } from "@sjvair/sdk/http";
import { runRemoteContract } from "./remote-contract";
import { createSdkRemote } from "./remote-sdk";

const ENABLED = process.env.SYNC_STACK === "1";
const ORIGIN = process.env.WORKSPACE_E2E_ORIGIN ?? "http://localhost:8000";

function keepCookies(jar: Map<string, string>, response: Response) {
	for (const cookie of response.headers.getSetCookie()) {
		const [pair] = cookie.split(";");
		const index = pair.indexOf("=");
		jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
	}
}

function cookieHeader(jar: Map<string, string>): string {
	return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** Signs in through the login form; returns request options with the cookie and CSRF header. */
async function signIn(): Promise<RequestOptions> {
	const identifier = process.env.WORKSPACE_E2E_IDENTIFIER;
	const password = process.env.WORKSPACE_E2E_PASSWORD;
	if (!identifier || !password) {
		throw new Error("Set WORKSPACE_E2E_IDENTIFIER and WORKSPACE_E2E_PASSWORD");
	}
	const jar = new Map<string, string>();
	const loginUrl = `${ORIGIN}/account/login/`;
	const page = await fetch(loginUrl);
	keepCookies(jar, page);
	const html = await page.text();
	const token =
		html.match(/name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']/)?.[1] ??
		html.match(/value=["']([^"']+)["'][^>]*name=["']csrfmiddlewaretoken["']/)?.[1];
	if (!token) throw new Error("No csrfmiddlewaretoken on the login page");

	const response = await fetch(loginUrl, {
		method: "POST",
		redirect: "manual",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Cookie: cookieHeader(jar),
			Referer: loginUrl
		},
		body: new URLSearchParams({ identifier, password, csrfmiddlewaretoken: token })
	});
	await response.body?.cancel();
	keepCookies(jar, response);
	if (response.status !== 302 || !jar.has("sessionid")) {
		throw new Error(`Sign-in failed (status ${response.status}); check the account`);
	}
	return {
		init: {
			headers: {
				Cookie: cookieHeader(jar),
				"X-CSRFToken": jar.get("csrftoken") ?? "",
				Referer: `${ORIGIN}/`
			}
		}
	};
}

let session: Promise<{ options: RequestOptions; accountId: string }> | undefined;

/** One sign-in for the whole run. */
function signedIn() {
	session ??= (async () => {
		setOrigin(ORIGIN);
		const options = await signIn();
		const account = await getUserDetails(undefined, options);
		return { options, accountId: String(account.id) };
	})();
	return session;
}

/** Trashes, then permanently deletes, each document the contract created. */
async function cleanup(ids: string[]) {
	const { options, accountId } = await signedIn();
	for (const id of ids) {
		const doc = await getDocument(id, options).catch(() => null);
		if (!doc) continue;
		if (doc.deleted_at === null) {
			await saveDocument(
				id,
				{
					kind: "dashboard",
					schema_version: doc.schema_version,
					name: doc.name,
					body: doc.body,
					deleted_at: new Date().toISOString(),
					copied_from: doc.copied_from,
					base_version: doc.version,
					changes: [],
					account_id: accountId,
					build_id: "sync-stack-test",
					snapshot: null
				},
				options
			);
		}
		await deleteDocument(id, options);
	}
}

if (ENABLED) {
	runRemoteContract(
		"sjvair.com stack",
		async () => {
			const { options, accountId } = await signedIn();
			return { remote: createSdkRemote({ init: options.init }), accountId };
		},
		// No cookie: outside a browser, nothing else carries a session.
		async () => createSdkRemote(),
		{ fakeOnly: false, cleanup }
	);

	describe("documents client (sdk-js mod_test.ts steps)", () => {
		const created: string[] = [];
		afterAll(() => cleanup(created));

		async function form(overrides: Partial<SaveDocumentForm> = {}): Promise<SaveDocumentForm> {
			const { accountId } = await signedIn();
			return {
				kind: "dashboard",
				schema_version: 1,
				name: "Client test",
				body: { widgets: [] },
				deleted_at: null,
				copied_from: null,
				base_version: null,
				changes: [],
				account_id: accountId,
				build_id: "sync-stack-test",
				snapshot: null,
				...overrides
			};
		}

		async function refused(promise: Promise<unknown>, code: RefusalCode) {
			const error = await promise.then(
				() => undefined,
				(e: unknown) => e
			);
			expect(isDocumentRefusal(error, code)).toBe(true);
			return error as { status: number };
		}

		test("signed out: listing is refused as unauthorized", async () => {
			await signedIn();
			const error = await refused(listDocuments(), "unauthorized");
			expect(error.status).toBe(401);
		});

		test("a reserved id is refused as invalid", async () => {
			const { options } = await signedIn();
			const error = await refused(saveDocument("shared", await form(), options), "invalid");
			expect(error.status).toBe(400);
		});

		test("keep given content as a snapshot, leaving the document as it was", async () => {
			const { options, accountId } = await signedIn();
			const id = `client-${crypto.randomUUID().slice(0, 12)}`;
			const { version } = await saveDocument(id, await form(), options);
			created.push(id);
			const before = await getDocument(id, options);

			const kept = await createSnapshot(
				id,
				{
					base_version: version,
					schema_version: 1,
					name: "Set aside",
					body: { widgets: ["mine"] },
					account_id: accountId,
					build_id: "sync-stack-test"
				},
				options
			);
			expect(kept.reason).toBe("conflict");
			expect(kept.version).toBe(version);

			expect((await listSnapshots(id, options)).some((s) => s.id === kept.id)).toBe(true);
			const snapshot = await getSnapshot(id, kept.id, options);
			expect(snapshot.name).toBe("Set aside");
			expect(snapshot.body).toEqual({ widgets: ["mine"] });

			const after = await getDocument(id, options);
			expect(after.version).toBe(before.version);
			expect(after.updated_at).toBe(before.updated_at);
			expect(after.body).toEqual(before.body);
		});
	});
} else {
	describe.skip("remote contract: sjvair.com stack", () => {
		test("runs with SYNC_STACK=1 (npm run test:sync-stack)", () => {});
	});
}
