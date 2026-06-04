import { createClient } from "redis";

export type ValkeyClient = {
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  quit(): Promise<unknown>;
};

export async function createValkeyClient(url: string): Promise<ValkeyClient> {
  const client = createClient({
    url,
  });

  client.on("error", (error) => {
    console.error("Valkey client error", error);
  });

  await client.connect();

  return client;
}
