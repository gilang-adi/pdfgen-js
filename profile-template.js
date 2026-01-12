import { performance } from "perf_hooks";
import { buildInvoice } from "./src/template-invoice.js";

console.log(
  "╔═══════════════════════════════════════════════════════════════════╗",
);
console.log(
  "║             TEMPLATE BUILD PROFILING                             ║",
);
console.log(
  "╚═══════════════════════════════════════════════════════════════════╝\n",
);

// Test 1: Single build
console.log("Test 1: Single Build");
console.log("─".repeat(60));
const start1 = performance.now();
const template1 = buildInvoice();
const end1 = performance.now();
console.log(`Time: ${(end1 - start1).toFixed(3)}ms`);
console.log(
  `Size: ${JSON.stringify(template1).length.toLocaleString()} bytes\n`,
);

// Test 2: 100 sequential builds
console.log("Test 2: 100 Sequential Builds");
console.log("─".repeat(60));
const timings = [];
for (let i = 0; i < 100; i++) {
  const s = performance.now();
  buildInvoice();
  const e = performance.now();
  timings.push(e - s);
}
const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
const minTime = Math.min(...timings);
const maxTime = Math.max(...timings);
console.log(`Average: ${avgTime.toFixed(3)}ms`);
console.log(`Min:     ${minTime.toFixed(3)}ms`);
console.log(`Max:     ${maxTime.toFixed(3)}ms\n`);

// Test 3: Simulated request load (20 concurrent)
console.log("Test 3: Simulated Request Load (20 concurrent)");
console.log("─".repeat(60));
const concurrency = 20;
const totalRequests = 1000;

const startLoad = performance.now();
let completed = 0;
const loadTimings = [];

async function simulateRequest() {
  const s = performance.now();
  buildInvoice(); // This is what happens per request now
  const e = performance.now();
  loadTimings.push(e - s);
  completed++;
}

// Run concurrent batches
async function runLoad() {
  const promises = [];
  for (let i = 0; i < totalRequests; i++) {
    promises.push(simulateRequest());

    // Limit concurrency
    if (promises.length >= concurrency) {
      await Promise.all(promises);
      promises.length = 0;
    }
  }
  if (promises.length > 0) {
    await Promise.all(promises);
  }
}

await runLoad();
const endLoad = performance.now();
const totalTime = endLoad - startLoad;
const throughput = (totalRequests / (totalTime / 1000)).toFixed(2);

console.log(`Total Requests:  ${totalRequests}`);
console.log(`Total Time:      ${(totalTime / 1000).toFixed(3)}s`);
console.log(`Throughput:      ${throughput} req/s`);
console.log(
  `Avg Build Time:  ${(loadTimings.reduce((a, b) => a + b, 0) / loadTimings.length).toFixed(3)}ms\n`,
);

// Test 4: Compare cached vs fresh
console.log("Test 4: Cached vs Fresh Build (1000 iterations)");
console.log("─".repeat(60));

// Cached approach
const cachedTemplate = buildInvoice();
const startCached = performance.now();
for (let i = 0; i < 1000; i++) {
  // Simulate using cached template (just reference it)
  const _ = cachedTemplate;
}
const endCached = performance.now();
const cachedTime = endCached - startCached;

// Fresh build approach
const startFresh = performance.now();
for (let i = 0; i < 1000; i++) {
  buildInvoice();
}
const endFresh = performance.now();
const freshTime = endFresh - startFresh;

console.log(
  `Cached (reference):  ${cachedTime.toFixed(3)}ms total (${(cachedTime / 1000).toFixed(6)}ms per req)`,
);
console.log(
  `Fresh (build):       ${freshTime.toFixed(3)}ms total (${(freshTime / 1000).toFixed(3)}ms per req)`,
);
console.log(
  `Overhead:            ${(freshTime - cachedTime).toFixed(3)}ms (${((freshTime / cachedTime - 1) * 100).toFixed(0)}x slower)\n`,
);

// Test 5: Memory impact
console.log("Test 5: Memory Impact");
console.log("─".repeat(60));

const before = process.memoryUsage();
const templates = [];
for (let i = 0; i < 1000; i++) {
  templates.push(buildInvoice());
}
const after = process.memoryUsage();

console.log(
  `Heap Used Before:  ${(before.heapUsed / 1024 / 1024).toFixed(2)} MB`,
);
console.log(
  `Heap Used After:   ${(after.heapUsed / 1024 / 1024).toFixed(2)} MB`,
);
console.log(
  `Difference:        ${((after.heapUsed - before.heapUsed) / 1024 / 1024).toFixed(2)} MB`,
);
console.log(
  `Per Template:      ${((after.heapUsed - before.heapUsed) / 1000 / 1024).toFixed(2)} KB\n`,
);

// Test 6: Impact on request throughput estimation
console.log("Test 6: Throughput Impact Estimation");
console.log("─".repeat(60));

const pdfRenderTime = 50; // Assume 50ms to render PDF
const templateBuildTime = avgTime;

const cachedThroughput = 1000 / pdfRenderTime; // req/s with cached template
const freshThroughput = 1000 / (pdfRenderTime + templateBuildTime); // req/s with fresh build

console.log(`Assumed PDF render time:  ${pdfRenderTime}ms`);
console.log(`Template build time:      ${templateBuildTime.toFixed(3)}ms`);
console.log(``);
console.log(
  `Estimated throughput (cached):  ${cachedThroughput.toFixed(2)} req/s`,
);
console.log(
  `Estimated throughput (fresh):   ${freshThroughput.toFixed(2)} req/s`,
);
console.log(
  `Impact:                         ${(((cachedThroughput - freshThroughput) / cachedThroughput) * 100).toFixed(1)}% reduction\n`,
);

// Summary
console.log(
  "╔═══════════════════════════════════════════════════════════════════╗",
);
console.log(
  "║                           SUMMARY                                 ║",
);
console.log(
  "╚═══════════════════════════════════════════════════════════════════╝\n",
);

console.log(`Template build time:      ${avgTime.toFixed(3)}ms per request`);
console.log(
  `Template size:            ${(JSON.stringify(template1).length / 1024).toFixed(2)} KB`,
);
console.log(
  `Memory per template:      ${((after.heapUsed - before.heapUsed) / 1000 / 1024).toFixed(2)} KB`,
);
console.log(``);
console.log(
  `✓ buildInvoice() is ${avgTime < 1 ? "FAST" : avgTime < 5 ? "ACCEPTABLE" : "SLOW"} (${avgTime.toFixed(3)}ms)`,
);
console.log(
  `✓ Caching saves ~${((freshTime / cachedTime - 1) * 100).toFixed(0)}x overhead`,
);
console.log(
  `✓ Estimated throughput impact: -${(((cachedThroughput - freshThroughput) / cachedThroughput) * 100).toFixed(1)}%`,
);
console.log("");

// Recommendation
console.log("RECOMMENDATION:");
console.log("─".repeat(60));
if (avgTime < 1) {
  console.log("Template building is FAST (< 1ms)");
  console.log("   → Fresh build per request is acceptable");
  console.log("   → Dynamic data support has minimal overhead");
} else if (avgTime < 5) {
  console.log("Template building is MODERATE (1-5ms)");
  console.log("   → Use hybrid approach:");
  console.log("     • Cache for static data (GET endpoints)");
  console.log("     • Fresh build for dynamic data (POST endpoints)");
} else {
  console.log("X Template building is SLOW (> 5ms)");
  console.log("   → Optimize builders or cache aggressively");
  console.log("   → Consider template pre-compilation");
}
console.log("");
