import { beforeEach } from "vitest";
import { deleteDatabase } from "./db";
import { createWebPlatform } from "./storage";
import { runStorageContract } from "../storage-contract";

beforeEach(async () => {
	await deleteDatabase();
	localStorage.clear();
});

runStorageContract("indexeddb", () => createWebPlatform());
