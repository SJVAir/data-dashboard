/**
 * The E2E fakes as a real HTTP server, for the Lighthouse check (`lighthouse.perf.ts`).
 *
 * Lighthouse drives its own Chrome, and its throttling (simulated or DevTools) should see real
 * requests, so the fakes can't be Playwright routes here. Instead this server registers the same
 * route handlers the E2E suite uses (`e2e/fixtures.ts`, `*-server.ts`, `maptiler.ts`) on a small
 * stand-in for a `BrowserContext`, and answers real HTTP requests with them. Everything else is
 * the production build, served from `dist/` the way `vite preview` lays it out (`/workspace/…` from
 * `dist/workspace/`, any other path the shell `dist/index.html`), with the contract CSP, and gzip
 * switched on or off explicitly.
 *
 * MapTiler is `https://api.maptiler.com`, so it gets its own HTTPS server with a throwaway
 * self-signed certificate; the browser is pointed at it with `--host-resolver-rules` and told to
 * accept the certificate.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import type { BrowserContext } from "@playwright/test";
import { createFakeRemote } from "../../src/lib/sync/remote-fake";
import { CSRF_TOKEN, routeDocuments } from "../documents-server";
import { routeAccount, routeApiFixtures, routePesticideValley } from "../fixtures";
import { routeForecasts } from "../forecasts-server";
import { routeHeat } from "../heat-server";
import { routeMapData } from "../map-data-server";
import { routeMapTiler, type MapTilerRequests } from "../maptiler";
import { routePlaces } from "../places-server";
import { routeSummaries } from "../summaries-server";

const ROOT = resolve(import.meta.dirname, "../..");
const DIST = join(ROOT, "dist");

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".webmanifest": "application/manifest+json",
	".txt": "text/plain; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".webp": "image/webp",
	".avif": "image/avif",
	".jpg": "image/jpeg",
	".woff2": "font/woff2",
	".woff": "font/woff"
};
/** What gets gzipped when compression is on (fonts and images are compressed already). */
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".txt", ".svg"]);

/** The contract CSP (`csp-hosts.json`), as `vite.config.ts`'s `contractCsp` builds it for preview. */
function contractCsp(): string {
	const directives: Record<string, string[]> = JSON.parse(
		readFileSync(join(ROOT, "csp-hosts.json"), "utf8")
	);
	return Object.entries(directives)
		.map(([name, sources]) => [name, ...sources.filter((s) => s !== "{static}")].join(" "))
		.join("; ");
}

type Matcher = string | RegExp | ((url: URL) => boolean);
type FulfillOptions = {
	status?: number;
	json?: unknown;
	body?: string | Buffer;
	contentType?: string;
	headers?: Record<string, string>;
};
type Outcome = "fulfilled" | "fallback" | "aborted";

/** A Playwright URL glob (`**` any characters, `*` any but `/`) as a regular expression. */
function globToRegExp(glob: string): RegExp {
	let source = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === "*" && glob[i + 1] === "*") {
			source += ".*";
			i++;
		} else if (c === "*") source += "[^/]*";
		else if (c === "?") source += ".";
		else source += c.replace(/[.+^${}()|[\]\\/]/g, "\\$&");
	}
	return new RegExp(`^${source}$`);
}

function matches(matcher: Matcher, url: URL): boolean {
	if (typeof matcher === "function") return matcher(url);
	if (matcher instanceof RegExp) return matcher.test(url.href);
	return globToRegExp(matcher).test(url.href);
}

/** One request as the route handlers see it (the parts of Playwright's `Request` they use). */
class FakeRequest {
	constructor(
		private readonly href: string,
		private readonly verb: string,
		private readonly headerMap: Record<string, string>,
		private readonly body: Buffer
	) {}
	url(): string {
		return this.href;
	}
	method(): string {
		return this.verb;
	}
	headers(): Record<string, string> {
		return this.headerMap;
	}
	postData(): string | null {
		return this.body.length ? this.body.toString("utf8") : null;
	}
	postDataJSON(): unknown {
		const data = this.postData();
		return data === null ? null : JSON.parse(data);
	}
}

/** One handler's go at a request (the parts of Playwright's `Route` the handlers use). */
class FakeRoute {
	outcome: Outcome | null = null;
	constructor(
		private readonly req: FakeRequest,
		private readonly res: ServerResponse
	) {}
	request(): FakeRequest {
		return this.req;
	}
	async fulfill(options: FulfillOptions): Promise<void> {
		this.outcome = "fulfilled";
		const headers: Record<string, string> = { ...options.headers };
		let body: string | Buffer = options.body ?? "";
		if (options.json !== undefined) {
			body = JSON.stringify(options.json);
			headers["content-type"] = "application/json";
		}
		if (options.contentType) headers["content-type"] = options.contentType;
		this.res.writeHead(options.status ?? 200, headers);
		this.res.end(body);
	}
	async fallback(): Promise<void> {
		this.outcome = "fallback";
	}
	async abort(): Promise<void> {
		this.outcome = "aborted";
		this.res.destroy();
	}
}

/** A stand-in for a `BrowserContext` that keeps the routes registered on it. */
class RouteTable {
	private readonly routes: { matcher: Matcher; handler: (route: FakeRoute) => unknown }[] = [];
	async route(matcher: Matcher, handler: (route: FakeRoute) => unknown): Promise<void> {
		this.routes.push({ matcher, handler });
	}
	/** `routeMapTiler` watches requests on the context; the server doesn't need that. */
	on(): void {}
	/**
	 * Answers with the routes, newest first, like Playwright (a `fallback()` passes the request on
	 * to the next one). False when no route answered.
	 */
	async answer(req: FakeRequest, res: ServerResponse): Promise<boolean> {
		const url = new URL(req.url());
		for (let i = this.routes.length - 1; i >= 0; i--) {
			const { matcher, handler } = this.routes[i];
			if (!matches(matcher, url)) continue;
			const route = new FakeRoute(req, res);
			await handler(route);
			if (route.outcome !== "fallback") return true;
		}
		return false;
	}
	asContext(): BrowserContext {
		return this as unknown as BrowserContext;
	}
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

function headerMap(req: IncomingMessage): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(req.headers)) {
		if (value !== undefined) out[name] = Array.isArray(value) ? value.join(", ") : value;
	}
	return out;
}

/** The build file for `pathname`, as `vite preview` maps it (deep routes get the shell). */
function buildFile(pathname: string): string {
	const shell = join(DIST, "index.html");
	if (!pathname.startsWith("/workspace/")) return shell;
	const file = normalize(join(DIST, decodeURIComponent(pathname)));
	if (!file.startsWith(DIST + "/")) return shell;
	return existsSync(file) && statSync(file).isFile() ? file : shell;
}

export type FakeServer = {
	/** The app's address, `http://127.0.0.1:<port>/workspace/`. */
	url: string;
	/** The Chrome flags that send `api.maptiler.com` to the MapTiler stub. */
	chromeFlags: string[];
	/** Whether the build's text files are gzipped (switch it between cases). */
	gzip: boolean;
	/** API requests no fake answered (the E2E suite fails on these). */
	unmatched: string[];
	mapTiler: MapTilerRequests;
	close(): Promise<void>;
};

function listen(server: Server): Promise<number> {
	return new Promise((done) => {
		server.listen(0, "127.0.0.1", () => done((server.address() as AddressInfo).port));
	});
}

function close(server: Server): Promise<void> {
	return new Promise((done) => {
		server.closeAllConnections();
		server.close(() => done());
	});
}

/** A self-signed certificate for `api.maptiler.com`, made with `openssl` in a temporary folder. */
function maptilerCertificate(): { key: Buffer; cert: Buffer } {
	const dir = mkdtempSync(join(tmpdir(), "lighthouse-maptiler-"));
	try {
		execFileSync(
			"openssl",
			[
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-days",
				"1",
				"-subj",
				"/CN=api.maptiler.com",
				"-addext",
				"subjectAltName=DNS:api.maptiler.com",
				"-keyout",
				join(dir, "key.pem"),
				"-out",
				join(dir, "cert.pem")
			],
			{ stdio: "ignore" }
		);
		return { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Starts the fake server: the build from `dist/` (gzipped while `gzip` is on and the browser
 * accepts it) and the E2E fakes, signed out (the starter's first visit; a saved dashboard lives in
 * the browser's own storage). One server serves every case, so the origin (and with it the
 * browser storage a saved dashboard lives in) stays the same.
 */
export async function startFakeServer(): Promise<FakeServer> {
	const csp = contractCsp();
	const unmatched: string[] = [];
	const mapTiler: MapTilerRequests = { seen: [], stubbed: [], notFound: [] };
	const api = new RouteTable();
	const context = api.asContext();
	await routeApiFixtures(context, unmatched);
	await routeSummaries(context);
	await routeForecasts(context);
	await routeHeat(context);
	await routePlaces(context);
	await routeMapData(context);
	await routePesticideValley(context);
	const account = await routeAccount(context, null);
	const fake = createFakeRemote({ accountId: "nobody" });
	await routeDocuments(context, fake, () => account.get()?.id ?? null, []);

	const gzipped = new Map<string, Buffer>();
	const app = createServer(async (req, res) => {
		try {
			const href = `http://${req.headers.host}${req.url}`;
			const url = new URL(href);
			const request = new FakeRequest(
				href,
				req.method ?? "GET",
				headerMap(req),
				await readBody(req)
			);
			if (url.pathname.includes("/api/") || url.pathname.includes("/account/")) {
				if (!(await api.answer(request, res))) {
					unmatched.push(`${request.method()} ${url.pathname}`);
					res.writeHead(404).end();
				}
				return;
			}
			const file = buildFile(url.pathname);
			const ext = extname(file);
			const headers: Record<string, string> = {
				"content-type": TYPES[ext] ?? "application/octet-stream",
				vary: "Accept-Encoding"
			};
			if (ext === ".html") {
				headers["content-security-policy"] = csp;
				// Django sets the CSRF cookie that the SDK echoes; the E2E suite adds it as a cookie.
				headers["set-cookie"] = `csrftoken=${CSRF_TOKEN}; Path=/; SameSite=Lax`;
			}
			let body: Buffer = readFileSync(file);
			const accepts = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
			if (server.gzip && accepts && COMPRESSIBLE.has(ext)) {
				let packed = gzipped.get(file);
				if (!packed) {
					packed = gzipSync(body, { level: 9 });
					gzipped.set(file, packed);
				}
				body = packed;
				headers["content-encoding"] = "gzip";
			}
			headers["content-length"] = String(body.length);
			res.writeHead(200, headers);
			res.end(req.method === "HEAD" ? undefined : body);
		} catch (error) {
			console.error(error);
			res.destroy();
		}
	});

	const tiles = new RouteTable();
	await routeMapTiler(tiles.asContext(), mapTiler);
	const maptiler = createHttpsServer(maptilerCertificate(), async (req, res) => {
		const href = `https://api.maptiler.com${req.url}`;
		const request = new FakeRequest(href, req.method ?? "GET", headerMap(req), await readBody(req));
		// CORS: the map fetches the style from the app's origin.
		res.setHeader("access-control-allow-origin", "*");
		if (!(await tiles.answer(request, res))) res.writeHead(404).end();
	});

	const appPort = await listen(app);
	const tilesPort = await listen(maptiler);
	const server: FakeServer = {
		gzip: true,
		url: `http://127.0.0.1:${appPort}/workspace/`,
		chromeFlags: [
			`--host-resolver-rules=MAP api.maptiler.com 127.0.0.1:${tilesPort}`,
			"--ignore-certificate-errors"
		],
		unmatched,
		mapTiler,
		async close() {
			await close(app);
			await close(maptiler);
		}
	};
	return server;
}
