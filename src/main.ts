import { mount } from "svelte";
import { setOrigin } from "@sjvair/sdk/http";
import "./app.css";
import App from "./App.svelte";

if (import.meta.env.PROD) {
	setOrigin(import.meta.env.VITE_PROD_URL);
} else {
	setOrigin(import.meta.env.VITE_DEV_URL);
}

mount(App, { target: document.getElementById("app")! });
