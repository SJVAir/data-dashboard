import { mount } from "svelte";
import { setOrigin } from "@sjvair/sdk/http";
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
