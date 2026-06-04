import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const outputDir = path.resolve("./.site-inspection");

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1365, height: 768 },
  locale: "zh-CN",
});
const page = await context.newPage();

const requests = [];
const responses = [];
const consoleMessages = [];

page.on("request", (request) => {
  requests.push({
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
  });
});

page.on("response", async (response) => {
  const request = response.request();
  const headers = await response.allHeaders();
  responses.push({
    url: response.url(),
    status: response.status(),
    resourceType: request.resourceType(),
    headers,
  });
});

page.on("console", (message) => {
  consoleMessages.push({
    type: message.type(),
    text: message.text(),
  });
});

await page.goto("https://shitopenai.com", { waitUntil: "networkidle", timeout: 120000 });

const snapshot = await page.evaluate(() => {
  const cleanText = (value) => value?.replace(/\s+/g, " ").trim() ?? "";
  const nav = Array.from(document.querySelectorAll("a, button"))
    .map((node) => ({
      tag: node.tagName.toLowerCase(),
      text: cleanText(node.textContent),
      href: node instanceof HTMLAnchorElement ? node.href : null,
      className: node.className,
    }))
    .filter((item) => item.text);

  const forms = Array.from(document.forms).map((form) => ({
    action: form.action,
    method: form.method,
    className: form.className,
    inputs: Array.from(form.querySelectorAll("input, button")).map((node) => ({
      tag: node.tagName.toLowerCase(),
      type: node.getAttribute("type"),
      name: node.getAttribute("name"),
      placeholder: node.getAttribute("placeholder"),
      value: node instanceof HTMLInputElement ? node.value : cleanText(node.textContent),
      className: node.className,
      disabled: node.hasAttribute("disabled"),
    })),
  }));

  const rootHtml = document.documentElement.outerHTML;

  return {
    title: document.title,
    url: location.href,
    bodyClassName: document.body.className,
    bodyStyle: getComputedStyle(document.body).cssText,
    localStorage: { ...localStorage },
    sessionStorage: { ...sessionStorage },
    nav,
    headings: Array.from(document.querySelectorAll("h1, h2, h3")).map((node) => cleanText(node.textContent)),
    textNodes: cleanText(document.body.innerText),
    forms,
    rootHtml,
  };
});

await page.screenshot({
  path: path.join(outputDir, "live-page.png"),
  fullPage: true,
});

await writeFile(path.join(outputDir, "snapshot.json"), JSON.stringify(snapshot, null, 2));
await writeFile(path.join(outputDir, "requests.json"), JSON.stringify(requests, null, 2));
await writeFile(path.join(outputDir, "responses.json"), JSON.stringify(responses, null, 2));
await writeFile(path.join(outputDir, "console.json"), JSON.stringify(consoleMessages, null, 2));

await browser.close();

console.log(`Saved inspection files to ${outputDir}`);
