import { parseControlApiEnv } from "@teamops/config";
import { createDatabase } from "@teamops/database";

export const exportWorkerEnv = parseControlApiEnv();
export const exportWorkerDb = createDatabase(exportWorkerEnv.DATABASE_URL);
