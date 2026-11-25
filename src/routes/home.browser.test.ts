import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { saveFields } from "$lib/sync/merge";
import { accountApp } from "$lib/sync/test-app";
import { ACCOUNT, makeDoc } from "$lib/sync/test-support";
import { STARTER_ID } from "$lib/starter/starter";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { loadMonitorTypes } from "$lib/widgets/map/start";
import { MAP_TYPE } from "$lib/widgets/map/options";
import Home from "./Home.svelte";

// The catalog's monitor types, answered when a test says (none by default). The app asks
// `loadMonitorTypesResult`, which answers with `loadMonitorTypes`' types.
vi.mock("$lib/widgets/map/start", async (importOriginal) => {
	const loadMonitorTypes = vi.fn();
	return {
		...(await importOriginal<typeof import("$lib/widgets/map/start")>()),
		loadMonitorTypes,
		loadMonitorTypesResult: vi.fn(async () => ({ types: await loadMonitorTypes(), failed: false }))
	};
});

beforeEach(() => {
	vi.mocked(loadMonitorTypes).mockReset();
	vi.mocked(loadMonitorTypes).mockImplementation(async () => []);
});

const originalUrl = location.href;
afterEach(() => {
	history.replaceState(null, "", originalUrl);
});

test("Home shows the starter when nothing is stored", async () => {
	const app = await initApp(createMemoryPlatform(), { channel: createMemoryTabHub().channel() });
	const screen = await render(Home, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect
		.element(screen.getByRole("heading", { name: "Starter dashboard" }))
		.toBeInTheDocument();
	expect(app.current.isStarter).toBe(true);
	expect(document.title).toBe("Starter dashboard · SJVAir Dashboard");
});

test("Home clears the previous dashboard before its target resolves", async () => {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel() });
	const id = await app.index.createBlank();
	app.current = { session: await app.sessions.get(id), isStarter: false };
	// Hold the home resolution (it reads the last-opened preference) open.
	platform.preferences.get = () => new Promise(() => {});
	await render(Home, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	expect(app.current.session).toBeNull();
});

test("Home moves on from an unedited starter when the first dashboards arrive", async () => {
	const { app, fake, worker } = await accountApp([]);
	try {
		await render(Home, { context: new Map([[APP_CONTEXT_KEY, app]]) });
		await expect.poll(() => app.current.isStarter).toBe(true);
		// Saved from another device; this new device's first poll stores it.
		await fake.save("d9", {
			...saveFields({ ...makeDoc("d9"), name: "From the laptop" }),
			baseVersion: null,
			changes: [],
			accountId: ACCOUNT,
			buildId: "other-build",
			snapshot: null
		});
		worker.start();
		await expect.poll(() => location.pathname).toBe("/workspace/dashboards/d9");
	} finally {
		worker.stop();
	}
});

test("Home shows the starter with the monitor types that arrived as it opened", async () => {
	const TYPES = ["purpleair", "airnow"];
	let answer!: (types: string[]) => void;
	vi.mocked(loadMonitorTypes).mockImplementationOnce(
		() => new Promise<string[]>((resolve) => (answer = resolve))
	);
	const app = await initApp(createMemoryPlatform(), { channel: createMemoryTabHub().channel() });
	// The types arrive after the starter opened, before Home makes it current.
	const get = app.sessions.get;
	let opened: DocumentSession | null = null;
	let discard: ReturnType<typeof vi.spyOn> | null = null;
	app.sessions.get = async (id, opts) => {
		const session = await get(id, opts);
		if (id === STARTER_ID && !opened && session) {
			opened = session;
			discard = vi.spyOn(session, "discard");
			answer(TYPES);
			await app.starterTypesReady();
		}
		return session;
	};
	await render(Home, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.poll(() => app.current.isStarter && app.current.session !== opened).toBe(true);
	const map = app.current.session!.doc.body.widgets.find((w) => w.type === MAP_TYPE)!;
	expect(map.data.layers.find((l) => l.monitorTypes)?.monitorTypes).toEqual(TYPES);
	expect(opened).not.toBeNull();
	expect(discard).toHaveBeenCalled();
});
