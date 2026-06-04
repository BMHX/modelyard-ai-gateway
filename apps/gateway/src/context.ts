import { parseGatewayEnv } from "@teamops/config";
import { createDatabase } from "@teamops/database";

export const gatewayEnv = parseGatewayEnv();
export const gatewayDb = createDatabase(gatewayEnv.DATABASE_URL);

export type GatewayContext = {
  env: typeof gatewayEnv;
  db: typeof gatewayDb;
};

export const gatewayContext: GatewayContext = {
  env: gatewayEnv,
  db: gatewayDb,
};
