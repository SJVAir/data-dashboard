import { createMemoryPlatform } from "./memory";
import { runStorageContract } from "./storage-contract";

runStorageContract("memory", async () => createMemoryPlatform());
