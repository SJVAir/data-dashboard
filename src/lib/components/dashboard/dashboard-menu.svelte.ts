import type { MenuProvider } from "$lib/actions/types";

/** The dashboard on screen's ⋯ menu: its provider, and whether it's inert (a widget fullscreen). */
class DashboardMenuState {
	provider = $state.raw<MenuProvider | null>(null);
	#inert = $state<() => boolean>(() => false);
	get inert(): boolean {
		return this.#inert();
	}
	set(provider: MenuProvider | null, inert: () => boolean = () => false): void {
		this.provider = provider;
		this.#inert = inert;
	}
}

const state = new DashboardMenuState();

export const dashboardMenu: { readonly provider: MenuProvider | null; readonly inert: boolean } =
	state;

/** Publishes the grid's menu; returns the unpublish (a no-op if another grid has published since). */
export function publishDashboardMenu(provider: MenuProvider, inert: () => boolean): () => void {
	state.set(provider, inert);
	return () => {
		if (state.provider === provider) state.set(null);
	};
}
