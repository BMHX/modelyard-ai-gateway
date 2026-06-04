import { buildGateway } from "./app.js";
import { gatewayContext } from "./context.js";

const app = await buildGateway(gatewayContext);

const shutdown = async () => {
  await app.close();
  await gatewayContext.db.end();
};

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

await app.listen({
  host: gatewayContext.env.GATEWAY_HOST,
  port: gatewayContext.env.GATEWAY_PORT,
});
