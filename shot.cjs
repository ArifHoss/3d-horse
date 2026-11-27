const { chromium } = require("playwright");

(async () => {
  const url = process.argv[2] ?? "http://localhost:5178";
  const out = process.argv[3] ?? "shot.png";
  const width = Number(process.argv[4] ?? 1440);
  const height = Number(process.argv[5] ?? 1000);
  const waitMs = Number(process.argv.includes("--wait") ? process.argv[process.argv.indexOf("--wait") + 1] : 2500);
  const fullPage = process.argv.includes("--full");

  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
    if (m.type() === "log" && process.env.VERBOSE_LOGS) console.log("LOG:", m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e) + "\n" + (e.stack || "")));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: out, fullPage });
  console.log(JSON.stringify({ out, consoleErrors: [...new Set(consoleErrors)] }, null, 2));
  await browser.close();
})();
