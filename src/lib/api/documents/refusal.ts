/**
 * The error every documents call throws when the server refuses it.
 *
 * @example Usage
 * ```ts
 * import { isDocumentRefusal, saveDocument } from "$lib/api/documents";
 *
 * try {
 *   await saveDocument("abc", form);
 * } catch (error) {
 *   if (isDocumentRefusal(error, "stale_base")) {
 *     // error.data holds the newer version's changes and document.
 *   }
 * }
 * ```
 *
 * @module
 */

/**
 * Every refusal code a documents call can throw.
 *
 * The server's own codes come first. The last three are fallbacks for error
 * responses that carry no code (including non-JSON and empty bodies, such as a
 * proxy's HTML 503): `unauthorized` for a 401 (signed out, or a bad token),
 * `forbidden` for a 403 (such as a failed CSRF check), and `unknown` for
 * anything else (a 5xx, or a body that isn't the documents error shape). A
 * codeless 404 (such as Django's HTML page for an unmatched route) maps to
 * `not_found`.
 */
export const REFUSAL_CODES = [
	"invalid",
	"too_large",
	"build_blocked",
	"account_mismatch",
	"rate_limited",
	"id_taken",
	"gone",
	"not_found",
	"stale_base",
	"schema_downgrade",
	"limit_documents",
	"limit_storage",
	"sharing_blocked",
	"not_deleted",
	"unauthorized",
	"forbidden",
	"unknown"
] as const;

/** A refusal code */
export type RefusalCode = (typeof REFUSAL_CODES)[number];

/**
 * A documents error response from the server. `code` is the refusal code (see
 * {@link REFUSAL_CODES}), `status` the HTTP status, and `data` the refusal's
 * payload (`undefined` when it has none). `cause` is the failed request, as
 * other SDK calls throw it (`{ url, init, result }`), or, for a body that
 * couldn't be parsed, the parse error (whose own `cause` is the `Response`).
 */
export class DocumentRefusal extends Error {
	/** The refusal code */
	code: string;

	/** The HTTP status */
	status: number;

	/** The refusal's payload, or `undefined` */
	data: unknown;

	/**
	 * Creates a DocumentRefusal.
	 *
	 * @param message The server's message.
	 * @param code The refusal code.
	 * @param status The HTTP status.
	 * @param data The refusal's payload.
	 * @param options The error's `cause`.
	 */
	constructor(
		message: string,
		code: string,
		status: number,
		data: unknown,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = "DocumentRefusal";
		this.code = code;
		this.status = status;
		this.data = data;
	}
}

/**
 * Whether `e` is a {@link DocumentRefusal}, with the given code when one is
 * given.
 *
 * @param e The thrown value.
 * @param code Optional. The refusal code to match.
 * @returns Whether it matched
 */
export function isDocumentRefusal(e: unknown, code?: RefusalCode): e is DocumentRefusal {
	return e instanceof DocumentRefusal && (code === undefined || e.code === code);
}

/**
 * A successful documents response the SDK couldn't use: a body that isn't
 * JSON, or that doesn't match the expected schema. `cause` is the `ZodError`
 * or the parse error. Never a refusal: the server accepted the request.
 */
export class DocumentResponseError extends Error {
	/**
	 * Creates a DocumentResponseError.
	 *
	 * @param message What was wrong.
	 * @param options The error's `cause`.
	 */
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "DocumentResponseError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function fallbackCode(status: number): RefusalCode {
	if (status === 401) return "unauthorized";
	if (status === 403) return "forbidden";
	if (status === 404) return "not_found";
	return "unknown";
}

/**
 * Converts an error thrown by `httpRequest` for a failed response into a
 * {@link DocumentRefusal}, including one whose body couldn't be parsed. A
 * successful response with an unparseable body becomes a
 * {@link DocumentResponseError}. Anything else (an abort reason, a network
 * error) is returned unchanged.
 *
 * @param fault The thrown value.
 * @returns The refusal, or `fault` itself
 */
export function toDocumentRefusal(fault: unknown): unknown {
	if (!(fault instanceof Error)) return fault;

	// A body the HTTP layer couldn't parse (HTML, or empty): the error carries
	// the `Response` itself.
	if (fault.cause instanceof Response) {
		const response = fault.cause;
		if (response.ok) {
			return new DocumentResponseError(fault.message, { cause: fault });
		}
		return new DocumentRefusal(
			`Request failed with status ${response.status}`,
			fallbackCode(response.status),
			response.status,
			undefined,
			{ cause: fault }
		);
	}

	if (!isRecord(fault.cause)) return fault;
	const result = fault.cause.result;
	if (!isRecord(result) || typeof result.status !== "number") return fault;

	const body = isRecord(result.body) ? result.body : {};
	const errors = isRecord(body.errors) ? body.errors : {};
	const detail = Array.isArray(errors.detail) && isRecord(errors.detail[0]) ? errors.detail[0] : {};

	const code = typeof detail.code === "string" ? detail.code : fallbackCode(result.status);
	const message = typeof detail.message === "string" ? detail.message : fault.message;

	return new DocumentRefusal(message, code, result.status, body.data, {
		cause: fault.cause
	});
}
