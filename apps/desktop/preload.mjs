import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("teamopsDesktop", {
  platform: process.platform,
});
