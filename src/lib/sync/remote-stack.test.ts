/**
 * The remote contract against a running sjvair.com (local-only; skipped unless `SYNC_STACK=1`).
 *
 *   WORKSPACE_E2E_IDENTIFIER=... WORKSPACE_E2E_PASSWORD=... npm run test:sync-stack
 *
 * `WORKSPACE_E2E_ORIGIN` sets the server (default http://localhost:8000). It signs in through the
 * site's login form, as sdk-js's documents integration test does, and passes the session cookie
 * and CSRF token through `init` (outside a browser the SDK sends neither itself). The documents
 * it creates are trashed and permanently deleted at the end.
 */
import { describe, test } from "vitest";
import { getUserDetails } from "@sjvair/sdk/account/details";
import { deleteDocument, getDocument, saveDocument } from "@sjvair/sdk/documents";
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
		{ fakeOnly: false, cleanup }
	);
} else {
	describe.skip("remote contract: sjvair.com stack", () => {
		test("runs with SYNC_STACK=1 (npm run test:sync-stack)", () => {});
	});
}
