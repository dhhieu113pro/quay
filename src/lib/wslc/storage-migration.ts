import { importLegacyOperationLogs, isTauri } from "@/lib/tauri";
import { clearOperationLogs, loadOperationLogs } from "@/lib/wslc/operation-log";

export async function migrateLegacyOperationLogs(): Promise<{ imported: number; alreadyImported: boolean }> {
  if (!isTauri()) return { imported: 0, alreadyImported: false };

  const entries = loadOperationLogs();
  const result = await importLegacyOperationLogs(entries);
  // The native import writes both rows and its migration marker in one transaction.
  // Only clear localStorage after that transaction has been confirmed.
  clearOperationLogs();
  return result;
}
