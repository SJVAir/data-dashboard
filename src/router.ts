import { createRouter } from "sv-router";
import Home from "./routes/Home.svelte";

export const { route, navigate, p, isActive } = createRouter({ "/": Home }, { base: "/workspace" });
