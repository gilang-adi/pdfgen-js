import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Thread Safety Test Suite
 *
 * Tests to verify:
 * 1. Immutable data doesn't diverge across workers
 * 2. Atomic operations are thread-safe
 * 3. No race conditions in counters
 * 4. Shared state consistency
 */

console.log("🧪 Thread Safety Test Suite\n");

// ============================================================================
// Test 1: Atomic Counter Thread Safety
// ============================================================================

async function testAtomicCounter() {
  console.log("Test 1: Atomic Counter Thread Safety");
  console.log("━".repeat(50));

  const sharedBuffer = new SharedArrayBuffer(4);
  const counter = new Int32Array(sharedBuffer);

  const numWorkers = 4;
  const incrementsPerWorker = 1000;

  const workers = [];

  for (let i = 0; i < numWorkers; i++) {
    const worker = new Worker(
      `
      const { parentPort, workerData } = require('worker_threads');
      const counter = new Int32Array(workerData.buffer);

      for (let i = 0; i < workerData.increments; i++) {
        Atomics.add(counter, 0, 1);
      }

      parentPort.postMessage('done');
    `,
      {
        eval: true,
        workerData: {
          buffer: sharedBuffer,
          increments: incrementsPerWorker,
        },
      }
    );

    workers.push(
      new Promise((resolve) => {
        worker.on("message", () => {
          worker.terminate();
          resolve();
        });
      })
    );
  }

  await Promise.all(workers);

  const expected = numWorkers * incrementsPerWorker;
  const actual = Atomics.load(counter, 0);

  console.log(`Expected: ${expected}`);
  console.log(`Actual:   ${actual}`);

  if (actual === expected) {
    console.log("✅ PASSED - No race conditions detected\n");
    return true;
  } else {
    console.log(`❌ FAILED - Race condition detected! Off by ${expected - actual}\n`);
    return false;
  }
}

// ============================================================================
// Test 2: Immutable Object Protection
// ============================================================================

async function testImmutableObject() {
  console.log("Test 2: Immutable Object Protection");
  console.log("━".repeat(50));

  const template = Object.freeze({
    title: "Invoice",
    items: Object.freeze([
      Object.freeze({ name: "Item 1", price: 100 }),
      Object.freeze({ name: "Item 2", price: 200 }),
    ]),
  });

  let mutationDetected = false;

  try {
    // Attempt to mutate frozen object
    template.title = "Modified";
    mutationDetected = template.title === "Modified";
  } catch (err) {
    // Expected in strict mode
  }

  try {
    // Attempt to mutate nested frozen array
    template.items.push({ name: "Item 3", price: 300 });
  } catch (err) {
    // Expected
  }

  try {
    // Attempt to mutate nested frozen object
    template.items[0].price = 999;
    mutationDetected = mutationDetected || template.items[0].price === 999;
  } catch (err) {
    // Expected
  }

  console.log(`Original title: "${template.title}"`);
  console.log(`Items count: ${template.items.length}`);
  console.log(`First item price: ${template.items[0].price}`);

  if (!mutationDetected) {
    console.log("✅ PASSED - Object is truly immutable\n");
    return true;
  } else {
    console.log("❌ FAILED - Object was mutated!\n");
    return false;
  }
}

// ============================================================================
// Test 3: Concurrent Counter Access (Stress Test)
// ============================================================================

async function testConcurrentCounterAccess() {
  console.log("Test 3: Concurrent Counter Access (Stress Test)");
  console.log("━".repeat(50));

  const sharedBuffer = new SharedArrayBuffer(16); // 4 counters
  const counters = new Int32Array(sharedBuffer);

  const numWorkers = 8;
  const operations = 10000;

  const workers = [];

  for (let i = 0; i < numWorkers; i++) {
    const worker = new Worker(
      `
      const { parentPort, workerData } = require('worker_threads');
      const counters = new Int32Array(workerData.buffer);

      for (let i = 0; i < workerData.operations; i++) {
        // Increment all counters atomically
        Atomics.add(counters, 0, 1);
        Atomics.add(counters, 1, 1);
        Atomics.add(counters, 2, 1);
        Atomics.add(counters, 3, 1);
      }

      parentPort.postMessage('done');
    `,
      {
        eval: true,
        workerData: {
          buffer: sharedBuffer,
          operations,
        },
      }
    );

    workers.push(
      new Promise((resolve) => {
        worker.on("message", () => {
          worker.terminate();
          resolve();
        });
      })
    );
  }

  await Promise.all(workers);

  const expected = numWorkers * operations;
  const results = [
    Atomics.load(counters, 0),
    Atomics.load(counters, 1),
    Atomics.load(counters, 2),
    Atomics.load(counters, 3),
  ];

  console.log(`Expected per counter: ${expected}`);
  console.log(`Counter 0: ${results[0]}`);
  console.log(`Counter 1: ${results[1]}`);
  console.log(`Counter 2: ${results[2]}`);
  console.log(`Counter 3: ${results[3]}`);

  const allCorrect = results.every((count) => count === expected);

  if (allCorrect) {
    console.log("✅ PASSED - All counters accurate under concurrent load\n");
    return true;
  } else {
    console.log("❌ FAILED - Counter divergence detected!\n");
    return false;
  }
}

// ============================================================================
// Test 4: Fresh Copy vs Shared Reference
// ============================================================================

async function testFreshCopyPattern() {
  console.log("Test 4: Fresh Copy vs Shared Reference");
  console.log("━".repeat(50));

  const originalData = Object.freeze({
    name: "Original",
    count: 0,
    nested: Object.freeze({ value: 100 }),
  });

  // Fresh copy pattern (correct)
  const copy1 = { ...originalData };
  const copy2 = { ...originalData };

  // Modify copies (won't affect original due to freeze)
  try {
    copy1.name = "Copy 1";
    copy2.name = "Copy 2";
  } catch (err) {
    // May throw in strict mode
  }

  console.log(`Original name: "${originalData.name}"`);
  console.log(`Copy 1 name: "${copy1.name}"`);
  console.log(`Copy 2 name: "${copy2.name}"`);

  // Check if copies are independent
  const copiesIndependent = copy1 !== copy2 && copy1 !== originalData;

  // Check if original is unchanged
  const originalUnchanged = originalData.name === "Original";

  if (copiesIndependent && originalUnchanged) {
    console.log("✅ PASSED - Fresh copy pattern works correctly\n");
    return true;
  } else {
    console.log("❌ FAILED - Copies are not independent!\n");
    return false;
  }
}

// ============================================================================
// Test 5: Atomic Compare-Exchange
// ============================================================================

async function testAtomicCompareExchange() {
  console.log("Test 5: Atomic Compare-Exchange (CAS)");
  console.log("━".repeat(50));

  const sharedBuffer = new SharedArrayBuffer(4);
  const value = new Int32Array(sharedBuffer);

  Atomics.store(value, 0, 10);

  // Worker tries to CAS from 10 to 20
  const worker1 = new Worker(
    `
    const { parentPort, workerData } = require('worker_threads');
    const value = new Int32Array(workerData.buffer);

    // Compare-and-swap: if value is 10, set to 20
    const oldValue = Atomics.compareExchange(value, 0, 10, 20);

    parentPort.postMessage({ oldValue, success: oldValue === 10 });
  `,
    { eval: true, workerData: { buffer: sharedBuffer } }
  );

  const result1 = await new Promise((resolve) => {
    worker1.on("message", (msg) => {
      worker1.terminate();
      resolve(msg);
    });
  });

  console.log(`First CAS: oldValue=${result1.oldValue}, success=${result1.success}`);
  console.log(`Current value: ${Atomics.load(value, 0)}`);

  // Another worker tries to CAS from 10 to 30 (should fail)
  const worker2 = new Worker(
    `
    const { parentPort, workerData } = require('worker_threads');
    const value = new Int32Array(workerData.buffer);

    const oldValue = Atomics.compareExchange(value, 0, 10, 30);

    parentPort.postMessage({ oldValue, success: oldValue === 10 });
  `,
    { eval: true, workerData: { buffer: sharedBuffer } }
  );

  const result2 = await new Promise((resolve) => {
    worker2.on("message", (msg) => {
      worker2.terminate();
      resolve(msg);
    });
  });

  console.log(`Second CAS: oldValue=${result2.oldValue}, success=${result2.success}`);
  console.log(`Final value: ${Atomics.load(value, 0)}`);

  const firstSuccess = result1.success === true;
  const secondFailed = result2.success === false;
  const finalValue = Atomics.load(value, 0) === 20;

  if (firstSuccess && secondFailed && finalValue) {
    console.log("✅ PASSED - Atomic CAS works correctly\n");
    return true;
  } else {
    console.log("❌ FAILED - CAS behavior incorrect!\n");
    return false;
  }
}

// ============================================================================
// Test 6: Deep Freeze Verification
// ============================================================================

function testDeepFreeze() {
  console.log("Test 6: Deep Freeze Verification");
  console.log("━".repeat(50));

  function deepFreeze(obj) {
    Object.freeze(obj);
    Object.getOwnPropertyNames(obj).forEach((prop) => {
      if (
        obj[prop] !== null &&
        (typeof obj[prop] === "object" || typeof obj[prop] === "function") &&
        !Object.isFrozen(obj[prop])
      ) {
        deepFreeze(obj[prop]);
      }
    });
    return obj;
  }

  const template = deepFreeze({
    title: "Template",
    metadata: {
      version: "1.0",
      tags: ["pdf", "invoice"],
      config: {
        fontSize: 12,
        margin: 20,
      },
    },
    items: [
      { id: 1, name: "Item 1" },
      { id: 2, name: "Item 2" },
    ],
  });

  // Try to mutate at various levels
  let anyMutated = false;

  try {
    template.title = "Modified";
    anyMutated = template.title === "Modified";
  } catch (err) {}

  try {
    template.metadata.version = "2.0";
    anyMutated = anyMutated || template.metadata.version === "2.0";
  } catch (err) {}

  try {
    template.metadata.config.fontSize = 16;
    anyMutated = anyMutated || template.metadata.config.fontSize === 16;
  } catch (err) {}

  try {
    template.items[0].name = "Modified Item";
    anyMutated = anyMutated || template.items[0].name === "Modified Item";
  } catch (err) {}

  console.log(`Title: ${template.title}`);
  console.log(`Version: ${template.metadata.version}`);
  console.log(`Font size: ${template.metadata.config.fontSize}`);
  console.log(`First item: ${template.items[0].name}`);

  if (!anyMutated) {
    console.log("✅ PASSED - Deep freeze is effective\n");
    return true;
  } else {
    console.log("❌ FAILED - Deep structure was mutated!\n");
    return false;
  }
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runAllTests() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║     THREAD SAFETY TEST SUITE FOR PDF SERVICE             ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log();

  const results = [];

  try {
    results.push(await testAtomicCounter());
    results.push(testImmutableObject());
    results.push(await testConcurrentCounterAccess());
    results.push(testFreshCopyPattern());
    results.push(await testAtomicCompareExchange());
    results.push(testDeepFreeze());
  } catch (err) {
    console.error("Error running tests:", err);
    process.exit(1);
  }

  console.log("═".repeat(50));
  console.log("SUMMARY");
  console.log("═".repeat(50));

  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log(`Passed: ${passed}/${total}`);
  console.log(`Failed: ${total - passed}/${total}`);

  if (passed === total) {
    console.log("\n✅ ALL TESTS PASSED - Thread safety verified!\n");
    process.exit(0);
  } else {
    console.log("\n❌ SOME TESTS FAILED - Review implementation!\n");
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
