import { mount } from "svelte";
// Imported via the `$http` alias (not the bare `@sjvair/sdk/http` subpath) so this
// setOrigin() call lands on the same sibling-repo module instance that our own bare
// `@sjvair/sdk` imports (also aliased to the sibling in vite.config.ts) use internally
// — the node_modules-resolved `@sjvair/sdk/http` is a separate module instance with its
// own unset origin, which silently left every SDK call pointed at the hardcoded
// https://www.sjvair.com default instead of VITE_DEV_URL. Remove this along with the
// other TEMPORARY aliases in vite.config.ts once sdk-js v4.5.0 is published and
// package.json points at it directly.
import { setOrigin } from "$http";
import "./app.css";
import App from "./App.svelte";

const origin = import.meta.env.PROD ? import.meta.env.VITE_PROD_URL : import.meta.env.VITE_DEV_URL;

if (!origin) {
	throw new Error(
		`Missing ${import.meta.env.PROD ? "VITE_PROD_URL" : "VITE_DEV_URL"} — copy .env.example to .env and fill in real values.`
	);
}

setOrigin(origin);

mount(App, { target: document.getElementById("app")! });
