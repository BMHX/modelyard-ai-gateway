import { combinedCatalog } from "../catalog.mjs";
import { scanDirectory } from "../file-scan.mjs";

export async function extractDeployDir(targetPath) {
  return scanDirectory({
    rootDir: targetPath,
    mode: "deploy-dir",
    catalog: combinedCatalog,
  });
}
