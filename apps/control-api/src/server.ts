import { buildControlApi } from "./app.js";
import { controlApiContext } from "./context.js";

const app = await buildControlApi(controlApiContext);

const shutdown = async () => {
  await app.close();
  await controlApiContext.valkey?.quit();
  await controlApiContext.db.end();
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
  host: controlApiContext.env.CONTROL_API_HOST,
  port: controlApiContext.env.CONTROL_API_PORT,
});
