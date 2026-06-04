import { combinedCatalog } from "../catalog.mjs";
import { scanDirectory } from "../file-scan.mjs";

export async function extractBundleDir(targetPath) {
  return scanDirectory({
    rootDir: targetPath,
    mode: "bundle-dir",
    catalog: combinedCatalog,
  });
}
