/** Context key for who is looking at a place: its owner or someone opening a share link. */
export const PLACE_VIEWER_KEY = Symbol("place-viewer");

export type PlaceViewer = "owner" | "shared";
