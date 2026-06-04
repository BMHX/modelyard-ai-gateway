import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import type { PromptInspectionsE2EManifest } from "./prompt-inspections.seed";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, ".runtime", "prompt-inspections-manifest.json");

async function loadManifest() {
  return JSON.parse(await readFile(manifestPath, "utf-8")) as PromptInspectionsE2EManifest;
}

async function waitForInspectionTable(page: Page) {
  await expect(page.getByRole("heading", { name: "Prompt inspection records", exact: true })).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();
}

test("prompt inspections saved view open, pagination, and batch review flow", async ({ page }) => {
  const manifest = await loadManifest();

  await page.goto(manifest.savedViewTargetHref);

  await expect(page.getByRole("heading", { name: "Content review" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`savedViewId=${manifest.savedViewId}`));
  await expect(page).toHaveURL(/verdict=review/);
  await waitForInspectionTable(page);

  await page.getByRole("link", { name: "Score" }).click();
  await expect(page).toHaveURL(/sortBy=score_desc/);
  await waitForInspectionTable(page);

  await page.getByTestId("prompt-inspections-page-size-50").click();
  await expect(page).toHaveURL(/pageSize=50/);
  await waitForInspectionTable(page);

  await page.getByTestId("prompt-inspections-page-next").click();
  await expect(page).toHaveURL(/savedViewId=/);
  await expect(page).toHaveURL(/sortBy=score_desc/);
  await expect(page).toHaveURL(/pageSize=50/);
  await expect(page).toHaveURL(/offset=50/);
  await waitForInspectionTable(page);

  await page.getByTestId("prompt-inspections-page-previous").click();
  await expect(page).toHaveURL(/savedViewId=/);
  await expect(page).toHaveURL(/sortBy=score_desc/);
  await expect(page).toHaveURL(/pageSize=50/);
  await waitForInspectionTable(page);

  const pendingRows = page.locator("tbody tr").filter({
    hasText: "Pending",
  });
  const pendingCount = await pendingRows.count();
  assert.ok(pendingCount > 0, "expected at least one pending row on the second page");

  const selectedRequestIds: string[] = [];
  for (let index = 0; index < Math.min(pendingCount, 2); index += 1) {
    const row = pendingRows.nth(index);
    const requestCell = row.locator("td").nth(9);
    selectedRequestIds.push((await requestCell.textContent())?.trim() ?? "");
  }

  await page.getByRole("button", { name: "Select pending only" }).click();
  await expect(page.getByText(/selected$/)).toContainText(String(pendingCount));

  await page.getByPlaceholder("Batch disposition note (optional)").first().fill("Reviewed from prompt inspections e2e");
  await page.getByRole("button", { name: "Batch confirm violation" }).click();
  await page.waitForURL(/prompt-inspections/);
  await waitForInspectionTable(page);
  await page.reload();
  await waitForInspectionTable(page);

  for (const requestId of selectedRequestIds.filter(Boolean)) {
    const row = page.locator("tbody tr").filter({ hasText: requestId }).first();
    await expect(row).toContainText("Confirmed violation");
  }
});
