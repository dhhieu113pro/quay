import { invokeWslcHost } from "@/lib/tauri";
import {
  loadExistingContainerConfig as loadConfig,
  recreateContainerWithEnv as recreate,
  type ExistingContainerConfig,
} from "./existing-container-env";

export function loadExistingContainerConfig(name: string) {
  return loadConfig(name, async (containerName) => {
    const result = await invokeWslcHost({ cmd: "run_cli", args: ["container", "inspect", containerName] });
    if (!result.ok) return null;
    return result.output ?? result.stdout ?? null;
  });
}

export function recreateContainerWithEnv(config: ExistingContainerConfig, env: string, wasRunning: boolean) {
  return recreate(config, env, wasRunning, async (args) => invokeWslcHost({ cmd: "run_cli", args }));
}
