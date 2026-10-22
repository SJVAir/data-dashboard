/**
 * Test setup for every Vitest project: tests never reach the network. `fetch` throws with the
 * URL it was given unless a test stubs it (e.g. `vi.stubGlobal("fetch", …)`), so an unmocked
 * SDK call fails loudly instead of quietly requesting the real API.
 */
globalThis.fetch = async (input: RequestInfo | URL) => {
	const url = input instanceof Request ? input.url : String(input);
	throw new Error(`Network access in tests: ${url}`);
};
