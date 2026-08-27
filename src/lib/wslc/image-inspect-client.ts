import { invokeWslcHost } from "@/lib/tauri";
import { inspectImage as inspectCachedImage } from "./image-inspect-defaults";

export function inspectImage(reference: string) {
  return inspectCachedImage(reference, async (image) => {
    const result = await invokeWslcHost({ cmd: "run_cli", args: ["image", "inspect", image] });
    if (!result.ok) return null;
    return result.output ?? result.stdout ?? null;
  });
}
