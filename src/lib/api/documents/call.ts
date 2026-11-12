/**
 * Internal request helpers for the documents module. Not re-exported by
 * `index.ts`.
 *
 * @module
 */
import type { z } from "$lib/zod";
import { type APIRequestConfig, httpRequest } from "@sjvair/sdk/http";
import { DocumentResponseError, toDocumentRefusal } from "./refusal";

/** Builds a `documents/...` endpoint path, encoding each segment. */
export function documentsPath(...segments: Array<string | number>): string {
	return ["documents", ...segments.map((s) => encodeURIComponent(String(s)))].join("/");
}

/** The request headers for a call that sends a JSON body. */
export const JSON_HEADERS: HeadersInit = {
	Accept: "application/json",
	"Content-Type": "application/json"
};

/** The request headers for a call without a body. */
export const ACCEPT_HEADERS: HeadersInit = { Accept: "application/json" };

async function request(config: APIRequestConfig) {
	try {
		return await httpRequest<unknown>(config);
	} catch (fault) {
		throw toDocumentRefusal(fault);
	}
}

/**
 * Makes a documents request and returns its `data`, checked against
 * `schema`. A refusal throws `DocumentRefusal`; a response that doesn't match
 * the schema throws a `DocumentResponseError` whose `cause` is the `ZodError`.
 */
export async function documentsCall<S extends z.ZodType>(
	config: APIRequestConfig,
	schema: S
): Promise<z.infer<S>> {
	const response = await request(config);
	const body = response.body as { data?: unknown } | null;
	const parsed = schema.safeParse(
		typeof body === "object" && body !== null ? body.data : undefined
	);
	if (!parsed.success) {
		throw new DocumentResponseError(`Unexpected response from "${config.url}"`, {
			cause: parsed.error
		});
	}
	return parsed.data;
}

/** Makes a documents request that answers 204 with no body. */
export async function documentsVoidCall(config: APIRequestConfig): Promise<void> {
	await request(config);
}
