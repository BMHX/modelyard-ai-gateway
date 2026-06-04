import { mkdir } from "node:fs/promises";
import path from "node:path";

import { matchRouteSignals, matchTextSignals } from "../matchers.js";
import type { DetectorTarget, ExtractionResult } from "../types.js";

export async function extractOnlineBrowser(args: {
  target: DetectorTarget;
  outputDir: string | null;
  captureScreenshots: boolean;
}): Promise<ExtractionResult> {
  const evidence: ExtractionResult["evidence"] = [];
  const errors: string[] = [];
  const artifacts: string[] = [];

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const requests = new Set<string>();

    page.on("request", (request) => {
      requests.add(request.url());
    });

    await page.goto(args.target.value, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    const html = await page.content();
    const bodyText = await page.evaluate(() => document.body?.innerText ?? "");

    evidence.push(
      ...matchTextSignals({
        text: html,
        locationKind: "browser-dom",
        target: args.target.value,
        pathName: "/",
        targetType: args.target.type,
      }),
    );
    evidence.push(
      ...matchTextSignals({
        text: bodyText,
        locationKind: "browser-dom",
        target: args.target.value,
        pathName: "/",
        targetType: args.target.type,
      }),
    );

    for (const requestUrl of requests) {
      const routePath = new URL(requestUrl).pathname;
      evidence.push(
        ...matchRouteSignals({
          routePath,
          target: args.target.value,
          statusCode: 200,
          locationKind: "browser-request",
          targetType: args.target.type,
        }),
      );
    }

    if (args.captureScreenshots && args.outputDir) {
      await mkdir(args.outputDir, { recursive: true });
      const screenshotPath = path.join(args.outputDir, "browser-root.png");
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      artifacts.push(screenshotPath);
    }

    await browser.close();
  } catch (error) {
    errors.push(`Browser probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    target: args.target,
    evidence,
    errors,
    artifacts,
  };
}
