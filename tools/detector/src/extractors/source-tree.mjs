import { combinedCatalog } from "../catalog.mjs";
import { scanDirectory } from "../file-scan.mjs";

export async function extractSourceTree(targetPath) {
  return scanDirectory({
    rootDir: targetPath,
    mode: "source-tree",
    catalog: combinedCatalog,
  });
}
