// Summarises a Playwright JSON report for the browser-stability investigation
// (Phase 7A): counts per project (passed, failed, flaky, skipped), each failure
// with its location and first error line, the slowest tests and API requests
// (from the "timings" annotation in browser/support.ts), browser launch times
// (test-results/metrics) and, when given, machine load from a vmstat log.
//
// Usage: node scripts/browser-report-summary.mjs <report.json> [vmstat.log]
// Prints markdown; also appends it to $GITHUB_STEP_SUMMARY when that is set.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const [reportPath, vmstatPath] = process.argv.slice(2);
if (!reportPath || !existsSync(reportPath)) {
  console.log("No Playwright JSON report found (the run may have failed before tests started).");
  process.exit(0);
}
const report = JSON.parse(readFileSync(reportPath, "utf8"));

const tests = [];
const walk = (suite) => {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) tests.push({ title: spec.title, file: spec.file, line: spec.line, ...test });
  }
  for (const child of suite.suites ?? []) walk(child);
};
for (const suite of report.suites ?? []) walk(suite);

const byProject = new Map();
const failures = [];
const timed = [];
for (const test of tests) {
  const counts = byProject.get(test.projectName) ?? { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  // Playwright's own outcome: expected (passed), unexpected (failed), flaky (passed on retry), skipped.
  const outcome = { expected: "passed", unexpected: "failed", flaky: "flaky", skipped: "skipped" }[test.status] ?? test.status;
  counts[outcome] = (counts[outcome] ?? 0) + 1;
  byProject.set(test.projectName, counts);

  for (const [attempt, result] of (test.results ?? []).entries()) {
    const timing = (result.annotations ?? []).concat(test.annotations ?? []).find((annotation) => annotation.type === "timings");
    timed.push({ name: `[${test.projectName}] ${test.title}`, attempt, ms: result.duration, status: result.status, timings: timing ? JSON.parse(timing.description) : null });
    if (result.status !== "passed" && result.status !== "skipped") {
      const error = result.errors?.[0] ?? result.error ?? {};
      const location = error.location ? `${path.basename(error.location.file)}:${error.location.line}` : `${test.file}:${test.line}`;
      failures.push(`- **[${test.projectName}] ${test.title}** — attempt ${attempt + 1} ${result.status} after ${(result.duration / 1000).toFixed(1)} s at \`${location}\`: ${(error.message ?? "").split("\n")[0].replace(/\x1b\[[0-9;]*m/g, "").slice(0, 200)}`);
    }
  }
}

const lines = ["## Browser run summary", ""];
lines.push("| Project | Passed | Failed | Flaky | Skipped |", "| --- | --- | --- | --- | --- |");
for (const [project, counts] of [...byProject].sort()) lines.push(`| ${project} | ${counts.passed ?? 0} | ${counts.failed ?? 0} | ${counts.flaky ?? 0} | ${counts.skipped ?? 0} |`);
lines.push("", `Wall time: ${((report.stats?.duration ?? 0) / 1000).toFixed(0)} s; workers: ${report.config?.metadata?.actualWorkers ?? report.config?.workers ?? "?"}.`, "");

lines.push("### Failed attempts (including attempts that passed on retry)", "", failures.length ? failures.join("\n") : "None.", "");

const ran = timed.filter((item) => item.status !== "skipped");
lines.push("### Slowest test attempts", "", "| Test | Attempt | Duration | Status | Slowest API request | Slowest document |", "| --- | --- | --- | --- | --- | --- |");
for (const item of [...ran].sort((a, b) => b.ms - a.ms).slice(0, 10)) {
  const api = item.timings?.slowestApi ? `${item.timings.slowestApi.request} ${item.timings.slowestApi.ms} ms` : "—";
  lines.push(`| ${item.name} | ${item.attempt + 1} | ${(item.ms / 1000).toFixed(1)} s | ${item.status} | ${api} | ${item.timings ? `${item.timings.slowestDocumentMs} ms` : "—"} |`);
}
const apis = ran.flatMap((item) => (item.timings?.slowestApi ? [{ ...item.timings.slowestApi, test: item.name }] : []));
const unfinished = ran.flatMap((item) => (item.timings?.unfinishedApi ?? []).map((request) => `${item.name}: ${request}`));
lines.push("", `API requests measured: ${ran.reduce((total, item) => total + (item.timings?.apiRequests ?? 0), 0)}; slowest: ${apis.sort((a, b) => b.ms - a.ms)[0] ? `${apis[0].request} ${apis[0].ms} ms (${apis[0].test})` : "—"}.`);
lines.push(`Unfinished /api requests at the end of a test (aborted by navigation or never answered): ${unfinished.length}${unfinished.length ? `\n${unfinished.slice(0, 10).map((entry) => `- ${entry}`).join("\n")}` : ""}`, "");

const metricsDir = path.join("test-results", "metrics");
if (existsSync(metricsDir)) {
  const launches = readdirSync(metricsDir).filter((file) => file.startsWith("launch-")).map((file) => JSON.parse(readFileSync(path.join(metricsDir, file), "utf8")));
  if (launches.length) lines.push(`### Browser launch (probe per worker)`, "", launches.map((entry) => `- ${entry.project} worker ${entry.worker}: ${entry.launchMs} ms`).join("\n"), "");
}

if (vmstatPath && existsSync(vmstatPath)) {
  // vmstat -n -t columns: r b swpd free buff cache si so bi bo in cs us sy id wa st [gu] date time
  const rows = readFileSync(vmstatPath, "utf8").split("\n").map((line) => line.trim().split(/\s+/)).filter((cols) => /^\d+$/.test(cols[0] ?? ""));
  if (rows.length > 1) {
    const samples = rows.slice(1); // the first line averages since boot
    const busy = samples.map((cols) => 100 - Number(cols[14]));
    const freeMb = samples.map((cols) => Math.round((Number(cols[3]) + Number(cols[5])) / 1024));
    const runnable = samples.map((cols) => Number(cols[0]));
    lines.push("### Runner load (vmstat, every 5 s)", "",
      `${samples.length} samples; CPU busy mean ${Math.round(busy.reduce((a, b) => a + b, 0) / busy.length)} %, max ${Math.max(...busy)} %, samples at 95 % or more: ${busy.filter((value) => value >= 95).length}; `
      + `free + cache memory min ${Math.min(...freeMb)} MB; run queue max ${Math.max(...runnable)}.`, "");
  }
}

const markdown = `${lines.join("\n")}\n`;
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);

// GitHub annotations: readable on the run page and through the public
// check-runs API, so failure locations are visible without downloading logs.
// Only test titles, locations and the first error line are included.
if (process.env.GITHUB_ACTIONS) {
  const escape = (text) => String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  for (const test of tests) {
    for (const [attempt, result] of (test.results ?? []).entries()) {
      if (result.status === "passed" || result.status === "skipped") continue;
      const error = result.errors?.[0] ?? result.error ?? {};
      const file = error.location?.file ? path.relative(path.resolve("..", ".."), error.location.file).replaceAll("\\", "/") : `apps/web/browser/${test.file}`;
      const line = error.location?.line ?? test.line;
      const level = test.status === "flaky" ? "warning" : "error";
      const plain = (error.message ?? "").replace(/\x1b\[[0-9;]*m/g, "");
      const first = plain.split("\n").find((text) => text.trim()) ?? result.status;
      // For list comparisons (console errors, failed requests) the received entries are what matters.
      const received = plain.split("\n").filter((text) => /^\s*\+\s+"/.test(text)).map((text) => text.trim().replace(/^\+\s+/, "")).slice(0, 4);
      const detail = received.length ? `${first} — received: ${received.join(" | ")}` : first;
      console.log(`::${level} file=${file},line=${line},title=${escape(`[${test.projectName}] attempt ${attempt + 1} ${result.status} (${(result.duration / 1000).toFixed(1)} s)`)}::${escape(`${test.title}: ${detail.slice(0, 600)}`)}`);
    }
  }
  const counts = [...byProject].map(([project, c]) => `${project} ${c.passed ?? 0} passed, ${c.failed ?? 0} failed, ${c.flaky ?? 0} flaky, ${c.skipped ?? 0} skipped`).join("; ");
  const load = lines.find((text) => text.includes("CPU busy mean")) ?? "no load sample";
  const launches = lines.join("\n").split("\n").filter((text) => text.startsWith("- ") && text.includes(" worker ") && text.endsWith(" ms")).map((text) => text.slice(2)).join("; ");
  console.log(`::notice title=Browser run summary::${escape(`${counts}. Wall ${((report.stats?.duration ?? 0) / 1000).toFixed(0)} s. ${load} Launch: ${launches || "n/a"}`)}`);
}
