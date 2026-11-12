/**
 * Ported from sdk-js 819d152, `lib/documents/documents_test.ts` (Deno), with the same case
 * names. The Deno helpers `stubFetch`/`jsonResponse` and `setEnvironmentForTests` are SDK
 * internals, so `fetch`, `document.cookie` and `location.origin` are stubbed here instead.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { setOrigin } from "@sjvair/sdk/http";
import {
	createShareLink,
	createSnapshot,
	deleteDocument,
	DocumentRefusal,
	DocumentResponseError,
	getDocument,
	getDocumentChanges,
	getDocumentCredit,
	getDocumentProfile,
	getSharedDocument,
	getSharedDocumentChanges,
	getSnapshot,
	isDocumentRefusal,
	listDocuments,
	listSnapshots,
	REFUSAL_CODES,
	revokeShareLink,
	saveDocument,
	staleBaseDataSchema,
	updateDocumentProfile,
	type CreateSnapshotForm,
	type SaveDocumentForm
} from "./index";

const ORIGIN = "https://www.sjvair.com";
const COOKIE = "sessionid=s; csrftoken=tok";

type Call = { url: URL; init: RequestInit };
type Respond = (url: URL, init: RequestInit, call: number) => Response | Promise<Response>;

/** Builds a JSON `Response` (the SDK's `jsonResponse`). */
function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		headers: { "Content-Type": "application/json" }
	});
}

/**
 * Runs `fn` with fetch stubbed (recording every call; an aborted signal rejects with its reason,
 * as the SDK's `stubFetch` does) and a same-origin browser page with a CSRF cookie.
 */
async function withStub(respond: Respond, fn: (calls: Call[]) => Promise<void>) {
	const calls: Call[] = [];
	vi.stubGlobal("fetch", async (input: URL | RequestInfo, init: RequestInit = {}) => {
		const url =
			input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
		const call = calls.length;
		calls.push({ url, init });
		if (init.signal?.aborted) throw init.signal.reason;
		const response = await respond(url, init, call);
		if (init.signal?.aborted) throw init.signal.reason;
		return response;
	});
	vi.stubGlobal("document", { cookie: COOKIE });
	vi.stubGlobal("location", { origin: ORIGIN });
	setOrigin(ORIGIN);
	try {
		await fn(calls);
	} finally {
		vi.unstubAllGlobals();
	}
}

afterEach(() => {
	vi.unstubAllGlobals();
});

/** Awaits `fn`, expects it to reject, and returns what it rejected with. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rejection(fn: () => Promise<unknown>): Promise<any> {
	let error: unknown;
	let rejected = false;
	try {
		await fn();
	} catch (e) {
		rejected = true;
		error = e;
	}
	expect(rejected).toBe(true);
	return error;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" }
	});
}

const noContent = () => new Response(null, { status: 204 });

function header(call: Call, name: string) {
	return new Headers(call.init.headers).get(name);
}

function method(call: Call) {
	return (call.init.method ?? "GET").toUpperCase();
}

const DOCUMENT = {
	id: "abc",
	kind: "dashboard",
	name: "Fresno",
	schema_version: 1,
	version: 4,
	body: { widgets: [] },
	copied_from: null,
	deleted_at: null,
	created_at: "2026-10-28T12:00:00Z",
	updated_at: "2026-10-28T13:00:00Z",
	visibility: "private" as const,
	share_token: null
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { body: _body, ...META_FIELDS } = DOCUMENT;
const META = { ...META_FIELDS, size: 14 };

const ENTRY = { version: 4, schema_version: 1, change: { op: "add" } };

const SHARED = {
	id: "abc",
	kind: "dashboard",
	name: "Fresno",
	schema_version: 1,
	version: 4,
	body: { widgets: [] },
	updated_at: "2026-10-28T13:00:00Z",
	display_name: null
};

const FORM: SaveDocumentForm = {
	kind: "dashboard",
	schema_version: 1,
	name: null,
	body: { widgets: [] },
	deleted_at: null,
	copied_from: null,
	base_version: 3,
	changes: [{ schema_version: 1, change: { op: "add" } }],
	account_id: "u1",
	build_id: "deadbeef",
	snapshot: null
};

const SNAPSHOT_FORM: CreateSnapshotForm = {
	base_version: 4,
	schema_version: 1,
	name: "Mine",
	body: { widgets: [1] },
	account_id: "u1",
	build_id: "deadbeef"
};

const SNAPSHOT_META = {
	id: 8,
	version: 4,
	schema_version: 1,
	reason: "conflict" as const,
	created_at: "2026-11-02T12:00:00Z"
};

function refusal(code: string, status: number, data?: unknown) {
	const body: Record<string, unknown> = {
		errors: { detail: [{ message: `refused: ${code}`, code }] }
	};
	if (data !== undefined) body.data = data;
	return () => json(body, status);
}

describe("requests", () => {
	test("listDocuments: GET documents/, without since", async () => {
		const data = {
			documents: [META],
			purged: ["old"],
			cursor: "2026-10-28T12:59:50Z"
		};
		await withStub(
			() => jsonResponse({ data }),
			async (calls) => {
				expect(await listDocuments()).toEqual(data);
				expect(method(calls[0])).toBe("GET");
				expect(calls[0].url.href).toBe(`${ORIGIN}/api/2.0/documents/`);
			}
		);
	});

	test("listDocuments: since is URL-encoded, + included", async () => {
		const data = { documents: [], purged: [], cursor: "c" };
		await withStub(
			() => jsonResponse({ data }),
			async (calls) => {
				await listDocuments({ since: "2026-10-28T12:00:00.5+00:00" });
				expect(calls[0].url.search).toBe("?since=2026-10-28T12%3A00%3A00.5%2B00%3A00");
				expect(calls[0].url.searchParams.get("since")).toBe("2026-10-28T12:00:00.5+00:00");
			}
		);
	});

	test("getDocument: GET documents/<id>/", async () => {
		await withStub(
			() => jsonResponse({ data: DOCUMENT }),
			async (calls) => {
				expect(await getDocument("abc")).toEqual(DOCUMENT);
				expect(method(calls[0])).toBe("GET");
				expect(calls[0].url.pathname).toBe("/api/2.0/documents/abc/");
				expect(header(calls[0], "x-csrftoken")).toBe(null);
			}
		);
	});

	test("getDocumentChanges: unchanged answers only the version", async () => {
		await withStub(
			() => jsonResponse({ data: { version: 4 } }),
			async (calls) => {
				expect(await getDocumentChanges("abc", 4)).toEqual({ version: 4 });
				expect(calls[0].url.pathname).toBe("/api/2.0/documents/abc/changes/");
				expect(calls[0].url.searchParams.get("since")).toBe("4");
			}
		);
	});

	test("getDocumentChanges: changed answers the changes and the document", async () => {
		const data = { version: 4, changes: [ENTRY], document: DOCUMENT };
		await withStub(
			() => jsonResponse({ data }),
			async () => {
				const result = await getDocumentChanges("abc", 3);
				expect("document" in result).toBe(true);
				expect(result).toEqual(data);
			}
		);
	});

	test("getDocumentChanges: changes may be null", async () => {
		const data = { version: 4, changes: null, document: DOCUMENT };
		await withStub(
			() => jsonResponse({ data }),
			async () => {
				expect(await getDocumentChanges("abc", 9)).toEqual(data);
			}
		);
	});

	test("getDocumentChanges: a broken document is not read as unchanged", async () => {
		const data = { version: 4, changes: null, document: { id: "abc" } };
		await withStub(
			() => jsonResponse({ data }),
			async () => {
				const error = await rejection(() => getDocumentChanges("abc", 3));
				expect(isDocumentRefusal(error)).toBe(false);
			}
		);
	});

	test("saveDocument: PUT documents/<id>/ with the form as JSON and CSRF", async () => {
		const data = { version: 4, updated_at: "2026-10-28T13:00:00Z" };
		await withStub(
			() => jsonResponse({ data }),
			async (calls) => {
				expect(await saveDocument("abc", FORM)).toEqual(data);
				expect(method(calls[0])).toBe("PUT");
				expect(calls[0].url.href).toBe(`${ORIGIN}/api/2.0/documents/abc/`);
				expect(JSON.parse(calls[0].init.body as string)).toEqual(FORM);
				expect(header(calls[0], "content-type")).toBe("application/json");
				expect(header(calls[0], "x-csrftoken")).toBe("tok");
			}
		);
	});

	test("deleteDocument: DELETE documents/<id>/ with no body, 204", async () => {
		await withStub(noContent, async (calls) => {
			expect(await deleteDocument("abc")).toBe(undefined);
			expect(method(calls[0])).toBe("DELETE");
			expect(calls[0].url.pathname).toBe("/api/2.0/documents/abc/");
			expect(calls[0].init.body).toBe(undefined);
			expect(header(calls[0], "content-type")).toBe(null);
			expect(header(calls[0], "x-csrftoken")).toBe("tok");
		});
	});

	test("createShareLink: POST documents/<id>/share/ with no body", async () => {
		await withStub(
			() => jsonResponse({ data: { share_token: "t0k" } }),
			async (calls) => {
				expect(await createShareLink("abc")).toEqual({ share_token: "t0k" });
				expect(method(calls[0])).toBe("POST");
				expect(calls[0].url.pathname).toBe("/api/2.0/documents/abc/share/");
				expect(calls[0].init.body).toBe(undefined);
				expect(header(calls[0], "content-type")).toBe(null);
				expect(header(calls[0], "x-csrftoken")).toBe("tok");
			}
		);
	});

	test("revokeShareLink: DELETE documents/<id>/share/ with no body, 204", async () => {
		await withStub(noContent, async (calls) => {
			expect(await revokeShareLink("abc")).toBe(undefined);
			expect(method(calls[0])).toBe("DELETE");
			expect(calls[0].url.pathname).toBe("/api/2.0/documents/abc/share/");
			expect(calls[0].init.body).toBe(undefined);
			expect(header(calls[0], "x-csrftoken")).toBe("tok");
		});
	});

	test("listSnapshots and getSnapshot: GET documents/<id>/snapshots/", async () => {
		const meta = {
			id: 7,
			version: 3,
			schema_version: 1,
			reason: "conflict",
			created_at: "2026-10-28T12:00:00Z"
		};
		const snapshot = {
			id: 7,
			version: 3,
			schema_version: 1,
			name: null,
			body: { widgets: [] },
			created_at: "2026-10-28T12:00:00Z"
		};
		await withStub(
			(_url, _init, call) => jsonResponse({ data: call === 0 ? [meta] : snapshot }),
			async (calls) => {
				expect(await listSnapshots("abc")).toEqual([meta]);
				expect(await getSnapshot("abc", 7)).toEqual(snapshot);
				expect(calls[0].url.pathname).toBe("/api/2.0/documents/abc/snapshots/");
				expect(calls[1].url.pathname).toBe("/api/2.0/documents/abc/snapshots/7/");
				expect(calls.map(method)).toEqual(["GET", "GET"]);
			}
		);
	});

	test("createSnapshot: POST documents/<id>/snapshots/ with the form as JSON and CSRF", async () => {
		await withStub(
			() => json({ data: SNAPSHOT_META }, 201),
			async (calls) => {
				expect(await createSnapshot("abc", SNAPSHOT_FORM)).toEqual(SNAPSHOT_META);
				expect(method(calls[0])).toBe("POST");
				expect(calls[0].url.href).toBe(`${ORIGIN}/api/2.0/documents/abc/snapshots/`);
				expect(JSON.parse(calls[0].init.body as string)).toEqual(SNAPSHOT_FORM);
				expect(header(calls[0], "content-type")).toBe("application/json");
				expect(header(calls[0], "x-csrftoken")).toBe("tok");
			}
		);
	});

	test("getDocumentCredit: GET documents/<id>/credit/", async () => {
		const data = { name: "Fresno", display_name: "Ana" };
		await withStub(
			() => jsonResponse({ data }),
			async (calls) => {
				expect(await getDocumentCredit("abc")).toEqual(data);
				expect(calls[0].url.pathname).toBe("/api/2.0/documents/abc/credit/");
			}
		);
	});

	test("getSharedDocument: GET documents/shared/<token>/", async () => {
		await withStub(
			() => jsonResponse({ data: SHARED }),
			async (calls) => {
				expect(await getSharedDocument("t0k")).toEqual(SHARED);
				expect(calls[0].url.pathname).toBe("/api/2.0/documents/shared/t0k/");
			}
		);
	});

	test("getSharedDocumentChanges: version only, or the whole shared document", async () => {
		await withStub(
			(_url, _init, call) => jsonResponse({ data: call === 0 ? { version: 4 } : SHARED }),
			async (calls) => {
				expect(await getSharedDocumentChanges("t0k", 4)).toEqual({ version: 4 });
				expect(await getSharedDocumentChanges("t0k", 3)).toEqual(SHARED);
				expect(calls[0].url.pathname).toBe("/api/2.0/documents/shared/t0k/changes/");
				expect(calls[1].url.searchParams.get("since")).toBe("3");
			}
		);
	});

	test("profile: GET and PUT documents/profile/", async () => {
		await withStub(
			(_url, _init, call) => jsonResponse({ data: { display_name: call === 0 ? null : "Ana" } }),
			async (calls) => {
				expect(await getDocumentProfile()).toEqual({ display_name: null });
				expect(await updateDocumentProfile({ display_name: "Ana" })).toEqual({
					display_name: "Ana"
				});
				expect(calls[0].url.pathname).toBe("/api/2.0/documents/profile/");
				expect(method(calls[0])).toBe("GET");
				expect(method(calls[1])).toBe("PUT");
				expect(calls[1].url.pathname).toBe("/api/2.0/documents/profile/");
				expect(JSON.parse(calls[1].init.body as string)).toEqual({ display_name: "Ana" });
				expect(header(calls[1], "x-csrftoken")).toBe("tok");
			}
		);
	});

	test("ids and tokens are encoded into the path", async () => {
		await withStub(
			() => jsonResponse({ data: SHARED }),
			async (calls) => {
				await getSharedDocument("a/b?c");
				expect(calls[0].url.pathname).toBe("/api/2.0/documents/shared/a%2Fb%3Fc/");
				expect(calls[0].url.search).toBe("");
			}
		);
	});

	test("options: init headers and signal are forwarded", async () => {
		await withStub(
			() => jsonResponse({ data: DOCUMENT }),
			async (calls) => {
				const controller = new AbortController();
				await getDocument("abc", {
					signal: controller.signal,
					init: { headers: { Cookie: "sessionid=x" } }
				});
				expect(header(calls[0], "cookie")).toBe("sessionid=x");
				expect(calls[0].init.signal).toBe(controller.signal);
			}
		);
	});

	test("options: an aborted call rejects with the signal's reason", async () => {
		await withStub(
			() => jsonResponse({ data: DOCUMENT }),
			async () => {
				const controller = new AbortController();
				controller.abort("why");
				const error = await rejection(() => getDocument("abc", { signal: controller.signal }));
				expect(error).toBe("why");
			}
		);
	});
});

describe("refusals", () => {
	test("a 409 stale_base becomes a DocumentRefusal with its data", async () => {
		const data = {
			version: 5,
			schema_version: 1,
			changes: [{ ...ENTRY, version: 5 }],
			document: { ...DOCUMENT, version: 5 }
		};
		await withStub(refusal("stale_base", 409, data), async () => {
			const error = await rejection(() => saveDocument("abc", FORM));
			expect(error).toBeInstanceOf(DocumentRefusal);
			expect(error).toBeInstanceOf(Error);
			expect(error.code).toBe("stale_base");
			expect(error.status).toBe(409);
			expect(error.message).toBe("refused: stale_base");
			expect(error.name).toBe("DocumentRefusal");
			expect(isDocumentRefusal(error, "stale_base")).toBe(true);
			const stale = staleBaseDataSchema.parse(error.data);
			expect(stale.changes).toEqual(data.changes);
			expect(stale.document.version).toBe(5);
		});
	});

	test("createSnapshot: a stale base is refused with the save's data", async () => {
		const data = {
			version: 5,
			schema_version: 1,
			changes: [{ ...ENTRY, version: 5 }],
			document: { ...DOCUMENT, version: 5 }
		};
		await withStub(refusal("stale_base", 409, data), async () => {
			const error = await rejection(() => createSnapshot("abc", SNAPSHOT_FORM));
			expect(isDocumentRefusal(error, "stale_base")).toBe(true);
			expect(error.status).toBe(409);
			expect(staleBaseDataSchema.parse(error.data).version).toBe(5);
		});
	});

	test("a 404 shared read becomes not_found", async () => {
		await withStub(refusal("not_found", 404), async () => {
			const error = await rejection(() => getSharedDocument("nope"));
			expect(isDocumentRefusal(error, "not_found")).toBe(true);
			expect(error.status).toBe(404);
			expect(error.data).toBe(undefined);
		});
	});

	test("a 400 invalid carries data.fields", async () => {
		const data = { fields: { name: ["Too long."] } };
		await withStub(refusal("invalid", 400, data), async () => {
			const error = await rejection(() => updateDocumentProfile({ display_name: "x" }));
			expect(isDocumentRefusal(error, "invalid")).toBe(true);
			expect(error.data).toEqual(data);
		});
	});

	test("a 204 endpoint's refusal is a DocumentRefusal too", async () => {
		await withStub(refusal("not_deleted", 409), async () => {
			const error = await rejection(() => deleteDocument("abc"));
			expect(isDocumentRefusal(error, "not_deleted")).toBe(true);
		});
	});

	test("signed out: resticus's 401 without a code becomes unauthorized", async () => {
		const body = {
			errors: {
				detail: [{ message: "You must be logged in to access this endpoint." }]
			}
		};
		await withStub(
			() => json(body, 401),
			async () => {
				const error = await rejection(() => listDocuments());
				expect(isDocumentRefusal(error, "unauthorized")).toBe(true);
				expect(error.status).toBe(401);
				expect(error.message).toBe("You must be logged in to access this endpoint.");
			}
		);
	});

	test("a 403 without a code (a CSRF failure) becomes forbidden", async () => {
		const body = { errors: { detail: [{ message: "CSRF Failed: x" }] } };
		await withStub(
			() => json(body, 403),
			async () => {
				const error = await rejection(() => saveDocument("abc", FORM));
				expect(isDocumentRefusal(error, "forbidden")).toBe(true);
				expect(error.status).toBe(403);
			}
		);
	});

	test("an error without a code or errors body becomes unknown", async () => {
		await withStub(
			() => json({ oops: true }, 500),
			async () => {
				const error = await rejection(() => getDocument("abc"));
				expect(isDocumentRefusal(error, "unknown")).toBe(true);
				expect(error.status).toBe(500);
			}
		);
	});

	test("a refusal keeps the failed request as its cause", async () => {
		await withStub(refusal("gone", 410), async () => {
			const error = await rejection(() => getDocument("abc"));
			expect(isDocumentRefusal(error, "gone")).toBe(true);
			const cause = error.cause;
			expect(cause.result.status).toBe(410);
			expect(cause.url.pathname).toBe("/api/2.0/documents/abc/");
		});
	});

	test("a malformed success response is rejected by the schema", async () => {
		await withStub(
			() => jsonResponse({ data: { ...DOCUMENT, version: "4" } }),
			async () => {
				const error = await rejection(() => getDocument("abc"));
				expect(isDocumentRefusal(error)).toBe(false);
				expect(error).toBeInstanceOf(DocumentResponseError);
				expect(error.name).toBe("DocumentResponseError");
			}
		);
		await withStub(
			() => jsonResponse({ data: { ...DOCUMENT, body: undefined } }),
			async () => {
				await rejection(() => getDocument("abc"));
			}
		);
		await withStub(
			() => jsonResponse({ nope: 1 }),
			async () => {
				await rejection(() => listDocuments());
			}
		);
	});

	test("createSnapshot: a malformed answer is a DocumentResponseError", async () => {
		await withStub(
			() => json({ data: { ...SNAPSHOT_META, reason: "manual" } }, 201),
			async () => {
				const error = await rejection(() => createSnapshot("abc", SNAPSHOT_FORM));
				expect(error).toBeInstanceOf(DocumentResponseError);
			}
		);
	});

	test("a shared document without its id is rejected", async () => {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { id: _id, ...noId } = SHARED;
		await withStub(
			() => jsonResponse({ data: noId }),
			async () => {
				const error = await rejection(() => getSharedDocument("t0k"));
				expect(isDocumentRefusal(error)).toBe(false);
			}
		);
	});

	test("an HTML 503 (a proxy error) becomes unknown with its status", async () => {
		const respond = () =>
			new Response("<h1>Service Unavailable</h1>", {
				status: 503,
				headers: { "Content-Type": "text/html; charset=utf-8" }
			});
		await withStub(respond, async () => {
			const error = await rejection(() => saveDocument("abc", FORM));
			expect(isDocumentRefusal(error, "unknown")).toBe(true);
			expect(error.status).toBe(503);
			expect(error.data).toBe(undefined);
		});
	});

	test("an HTML 404 (an unmatched route) becomes not_found", async () => {
		const respond = () =>
			new Response("<h1>Not Found</h1>", {
				status: 404,
				headers: { "Content-Type": "text/html" }
			});
		await withStub(respond, async () => {
			const error = await rejection(() => getDocument("abc"));
			expect(isDocumentRefusal(error, "not_found")).toBe(true);
			expect(error.status).toBe(404);
		});
	});

	test("a JSON 404 without a code becomes not_found", async () => {
		const body = { errors: { detail: [{ message: "Not found." }] } };
		await withStub(
			() => json(body, 404),
			async () => {
				const error = await rejection(() => getDocument("abc"));
				expect(isDocumentRefusal(error, "not_found")).toBe(true);
			}
		);
	});

	test("an empty-body error, with or without a Content-Type, keeps its status", async () => {
		await withStub(
			() => new Response(null, { status: 502 }),
			async () => {
				const error = await rejection(() => listDocuments());
				expect(isDocumentRefusal(error, "unknown")).toBe(true);
				expect(error.status).toBe(502);
			}
		);
		await withStub(
			() =>
				new Response("", {
					status: 500,
					headers: { "Content-Type": "application/json" }
				}),
			async () => {
				const error = await rejection(() => deleteDocument("abc"));
				expect(isDocumentRefusal(error, "unknown")).toBe(true);
				expect(error.status).toBe(500);
			}
		);
		await withStub(
			() => new Response(null, { status: 401 }),
			async () => {
				const error = await rejection(() => getDocumentProfile());
				expect(isDocumentRefusal(error, "unauthorized")).toBe(true);
			}
		);
	});

	test("a non-JSON success is a DocumentResponseError, not a refusal", async () => {
		const respond = () =>
			new Response("<html></html>", {
				status: 200,
				headers: { "Content-Type": "text/html" }
			});
		await withStub(respond, async () => {
			const error = await rejection(() => getDocument("abc"));
			expect(error).toBeInstanceOf(DocumentResponseError);
			expect(error.name).toBe("DocumentResponseError");
			expect(isDocumentRefusal(error)).toBe(false);
		});
	});

	test("isDocumentRefusal: matches the class, and the code when given", () => {
		const error = new DocumentRefusal("x", "gone", 410, undefined);
		expect(isDocumentRefusal(error)).toBe(true);
		expect(isDocumentRefusal(error, "gone")).toBe(true);
		expect(isDocumentRefusal(error, "not_found")).toBe(false);
		expect(isDocumentRefusal(new Error("x"))).toBe(false);
		expect(isDocumentRefusal("gone")).toBe(false);
	});

	test("REFUSAL_CODES lists every wire code and the fallbacks", () => {
		expect([...REFUSAL_CODES].sort()).toEqual([
			"account_mismatch",
			"build_blocked",
			"forbidden",
			"gone",
			"id_taken",
			"invalid",
			"limit_documents",
			"limit_storage",
			"not_deleted",
			"not_found",
			"rate_limited",
			"schema_downgrade",
			"sharing_blocked",
			"stale_base",
			"too_large",
			"unauthorized",
			"unknown"
		]);
	});
});

describe("module", () => {
	test("index exports what the SDK module exported", async () => {
		expect(Object.keys(await import("./index")).sort()).toEqual(
			[
				"deleteDocument",
				"getDocument",
				"getDocumentChanges",
				"listDocuments",
				"saveDocument",
				"createShareLink",
				"getDocumentCredit",
				"getSharedDocument",
				"getSharedDocumentChanges",
				"revokeShareLink",
				"createSnapshot",
				"getSnapshot",
				"listSnapshots",
				"getDocumentProfile",
				"updateDocumentProfile",
				"DocumentRefusal",
				"DocumentResponseError",
				"isDocumentRefusal",
				"REFUSAL_CODES",
				"staleBaseDataSchema"
			].sort()
		);
	});
});
