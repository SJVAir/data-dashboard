import { createMemoryPlatform } from "./memory";
import { runCapabilityContract } from "./capability-contract";
import { runStorageContract } from "./storage-contract";

runStorageContract("memory", async () => createMemoryPlatform());
runCapabilityContract("memory", async () => createMemoryPlatform());
