import { parseControlApiEnv } from "@teamops/config";
import { createDatabase } from "@teamops/database";

import { createValkeyClient, type ValkeyClient } from "./valkey.js";

export const controlApiEnv = parseControlApiEnv();
export const controlApiDb = createDatabase(controlApiEnv.DATABASE_URL);
export const controlApiValkey = await createValkeyClient(controlApiEnv.VALKEY_URL);

export type ControlApiContext = {
  env: typeof controlApiEnv;
  db: typeof controlApiDb;
  valkey?: ValkeyClient;
};

export const controlApiContext: ControlApiContext = {
  env: controlApiEnv,
  db: controlApiDb,
  valkey: controlApiValkey,
};
