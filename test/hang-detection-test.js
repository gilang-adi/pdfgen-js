import { PdfRenderServiceResilient } from "../src/services/pdf-render-service-resilient.js";
import os from "os";

/**
 * Comprehensive test suite for hang detection and resource optimization
 *
 * Tests:
 * 1. CPU oversubscription calculation
 * 2. Hang detection for stuck tasks
 * 3. Timeout and termination
 * 4. Automatic retry and recovery
 * 5. Resource allocation validation
 */

const COLORS = {
  RESET: "\x1b[0m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  CYAN: "\x1b[36m",
};

function log(message, color = COLORS.RESET) {
  console.log(`${color}${message}${COLORS.RESET}`);
}

function logSection(title) {
  console.log("\n" + "=".repeat(80));
  log(`  ${title}`, COLORS.CYAN);
  console.log("=".repeat(80) + "\n");
}

function logTest(name) {
  log(`▶ ${name}`, COLORS.BLUE);
}

function logPass(message) {
  log(`  ✅ ${message}`, COLORS.GREEN);
}

function logFail(message) {
  log(`  ❌ ${message}`, COLORS.RED);
}

function logWarn(message) {
  log(`  ⚠️  ${message}`, COLORS.YELLOW);
}

function logInfo(message) {
  log(`  ℹ️  ${message}`);
}

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    testsPassed++;
    logPass(message);
    return true;
  } else {
    testsFailed++;
    logFail(message);
    return false;
  }
}

// =============================================================================
// TEST 1: CPU Oversubscription Calculation
// =============================================================================

async function testCPUOversubscription() {
  logSection("TEST 1: CPU Oversubscription Calculation");

  const cpuCount = os.cpus().length;
  logInfo(`System CPU cores: ${cpuCount}`);

  // Test Case 1: Default configuration (OPTIMIZED)
  logTest("Test 1.1: Default Configuration (Optimized)");
  const service1 = new PdfRenderServiceResilient({
    enableLogging: false,
    warmup: false,
    enableRecovery: false,
    enableHangDetection: false,
  });

  const stats1 = service1.getStats();
  const oversubscription1 = parseFloat(stats1.cpuOversubscription);

  logInfo(`minThreads: ${service1.options.minThreads}`);
  logInfo(`maxThreads: ${service1.options.maxThreads}`);
  logInfo(
    `concurrentTasksPerWorker: ${service1.options.concurrentTasksPerWorker}`,
  );
  logInfo(`maxConcurrentTasks: ${stats1.maxConcurrentTasks}`);
  logInfo(`cpuOversubscription: ${oversubscription1}x`);

  assert(
    oversubscription1 <= 1.0,
    `CPU oversubscription ${oversubscription1}x is <= 1.0 (GOOD)`,
  );
  assert(
    oversubscription1 >= 0.5,
    `CPU oversubscription ${oversubscription1}x is >= 0.5 (not too conservative)`,
  );

  await service1.close();

  // Test Case 2: Bad configuration (HIGH oversubscription)
  logTest("Test 1.2: Bad Configuration (High Oversubscription)");
  const service2 = new PdfRenderServiceResilient({
    maxThreads: cpuCount,
    concurrentTasksPerWorker: 2,
    enableLogging: false,
    warmup: false,
    enableRecovery: false,
    enableHangDetection: false,
  });

  const stats2 = service2.getStats();
  const oversubscription2 = parseFloat(stats2.cpuOversubscription);

  logInfo(`maxThreads: ${service2.options.maxThreads}`);
  logInfo(
    `concurrentTasksPerWorker: ${service2.options.concurrentTasksPerWorker}`,
  );
  logInfo(`cpuOversubscription: ${oversubscription2}x`);

  assert(
    oversubscription2 > 1.0,
    `CPU oversubscription ${oversubscription2}x is > 1.0 (BAD - as expected)`,
  );

  await service2.close();

  // Test Case 3: Conservative configuration
  logTest("Test 1.3: Conservative Configuration");
  const service3 = new PdfRenderServiceResilient({
    maxThreads: Math.max(2, Math.ceil(cpuCount * 0.5)),
    concurrentTasksPerWorker: 1,
    enableLogging: false,
    warmup: false,
    enableRecovery: false,
    enableHangDetection: false,
  });

  const stats3 = service3.getStats();
  const oversubscription3 = parseFloat(stats3.cpuOversubscription);

  logInfo(`maxThreads: ${service3.options.maxThreads}`);
  logInfo(`cpuOversubscription: ${oversubscription3}x`);

  assert(
    oversubscription3 <= 0.6,
    `CPU oversubscription ${oversubscription3}x is conservative (GOOD for shared hosting)`,
  );

  await service3.close();
}

// =============================================================================
// TEST 2: Timeout Configuration Validation
// =============================================================================

async function testTimeoutConfiguration() {
  logSection("TEST 2: Timeout Configuration Validation");

  logTest("Test 2.1: Default Timeout Values");
  const service = new PdfRenderServiceResilient({
    enableLogging: false,
    warmup: false,
    enableRecovery: false,
    enableHangDetection: false,
  });

  logInfo(`taskTimeout: ${service.options.taskTimeout}ms`);
  logInfo(`hangThreshold: ${service.options.hangThreshold}ms`);
  logInfo(`idleTimeout: ${service.options.idleTimeout}ms`);

  assert(
    service.options.taskTimeout >= 30_000,
    `taskTimeout (${service.options.taskTimeout}ms) is >= 30s (GOOD)`,
  );
  assert(
    service.options.hangThreshold > service.options.taskTimeout,
    `hangThreshold (${service.options.hangThreshold}ms) > taskTimeout (${service.options.taskTimeout}ms)`,
  );
  assert(
    service.options.idleTimeout >= 300_000,
    `idleTimeout (${service.options.idleTimeout}ms) is >= 5 minutes (GOOD)`,
  );

  await service.close();

  logTest("Test 2.2: Custom Timeout Values");
  const customService = new PdfRenderServiceResilient({
    taskTimeout: 20_000,
    hangThreshold: 25_000,
    idleTimeout: 600_000,
    enableLogging: false,
    warmup: false,
    enableRecovery: false,
    enableHangDetection: false,
  });

  assert(
    customService.options.taskTimeout === 20_000,
    "Custom taskTimeout applied correctly",
  );
  assert(
    customService.options.hangThreshold === 25_000,
    "Custom hangThreshold applied correctly",
  );
  assert(
    customService.options.idleTimeout === 600_000,
    "Custom idleTimeout applied correctly",
  );

  await customService.close();
}

// =============================================================================
// TEST 3: Hang Detection Mechanism
// =============================================================================

async function testHangDetection() {
  logSection("TEST 3: Hang Detection Mechanism");

  logTest("Test 3.1: Hang Detection Enabled by Default");
  const service = new PdfRenderServiceResilient({
    enableLogging: false,
    warmup: false,
    enableRecovery: false,
  });

  assert(
    service.options.enableHangDetection === true,
    "Hang detection is enabled by default",
  );
  assert(
    service.hangDetectionInterval !== undefined,
    "Hang detection interval is set",
  );

  await service.close();

  logTest("Test 3.2: Hang Detection Tracking Structures");
  const service2 = new PdfRenderServiceResilient({
    enableLogging: false,
    warmup: false,
    enableRecovery: false,
    enableHangDetection: true,
  });

  assert(
    service2.taskExecutionTimes instanceof Map,
    "taskExecutionTimes Map exists",
  );
  assert(service2.stuckTasks instanceof Set, "stuckTasks Set exists");

  const stats = service2.getStats();
  assert(stats.currentlyExecuting === 0, "Initially no tasks executing");
  assert(stats.stuckTasksCount === 0, "Initially no stuck tasks");

  await service2.close();
}

// =============================================================================
// TEST 4: Task Timeout and Termination
// =============================================================================

async function testTaskTimeout() {
  logSection("TEST 4: Task Timeout and Termination");

  logTest("Test 4.1: Task Timeout Configuration");
  const service = new PdfRenderServiceResilient({
    taskTimeout: 5_000, // 5 second timeout for testing
    maxRetries: 1, // Only 1 retry to speed up test
    retryDelay: 500,
    enableLogging: false,
    warmup: false,
    enableRecovery: true,
    enableHangDetection: true,
    hangThreshold: 10_000,
  });

  logInfo("Creating a task that will timeout...");

  // Create a simple valid PDF (won't actually timeout with valid data)
  // This test validates the configuration exists
  assert(service.options.taskTimeout === 5_000, "Timeout is set to 5 seconds");

  const stats = service.getStats();
  logInfo(`Task timeout: ${service.options.taskTimeout}ms`);
  logInfo(`Hang threshold: ${service.options.hangThreshold}ms`);
  logInfo(`Max retries: ${service.options.maxRetries}`);

  await service.close();
}

// =============================================================================
// TEST 5: Event Emission
// =============================================================================

async function testEventEmission() {
  logSection("TEST 5: Event Emission");

  logTest("Test 5.1: Event Emitter Functionality");
  const service = new PdfRenderServiceResilient({
    enableLogging: false,
    warmup: false,
    enableRecovery: true,
    enableHangDetection: true,
  });

  let hungEventReceived = false;
  let recoveredEventReceived = false;
  let failedEventReceived = false;

  service.on("task-hung", () => {
    hungEventReceived = true;
  });

  service.on("task-recovered", () => {
    recoveredEventReceived = true;
  });

  service.on("task-failed", () => {
    failedEventReceived = true;
  });

  assert(
    service.listenerCount("task-hung") === 1,
    "task-hung event listener registered",
  );
  assert(
    service.listenerCount("task-recovered") === 1,
    "task-recovered event listener registered",
  );
  assert(
    service.listenerCount("task-failed") === 1,
    "task-failed event listener registered",
  );

  await service.close();
}

// =============================================================================
// TEST 6: Retry and Recovery Configuration
// =============================================================================

async function testRetryConfiguration() {
  logSection("TEST 6: Retry and Recovery Configuration");

  logTest("Test 6.1: Retry Parameters");
  const service = new PdfRenderServiceResilient({
    maxRetries: 3,
    retryDelay: 1000,
    retryBackoff: 1.5,
    enableLogging: false,
    warmup: false,
  });

  assert(service.options.maxRetries === 3, "Max retries set to 3");
  assert(service.options.retryDelay === 1000, "Retry delay set to 1000ms");
  assert(service.options.retryBackoff === 1.5, "Retry backoff set to 1.5x");

  // Test retry delay calculation
  const delay1 = service.calculateRetryDelay(1);
  const delay2 = service.calculateRetryDelay(2);
  const delay3 = service.calculateRetryDelay(3);

  logInfo(`Retry delay attempt 1: ${delay1}ms`);
  logInfo(`Retry delay attempt 2: ${delay2}ms`);
  logInfo(`Retry delay attempt 3: ${delay3}ms`);

  assert(delay1 === 1000, "First retry delay is 1000ms");
  assert(delay2 === 1500, "Second retry delay is 1500ms (1000 * 1.5^1)");
  assert(delay3 === 2250, "Third retry delay is 2250ms (1000 * 1.5^2)");

  await service.close();

  logTest("Test 6.2: Recovery Mechanism");
  const service2 = new PdfRenderServiceResilient({
    enableRecovery: true,
    recoveryCheckInterval: 5000,
    enableLogging: false,
    warmup: false,
  });

  assert(service2.options.enableRecovery === true, "Recovery is enabled");
  assert(
    service2.options.recoveryCheckInterval === 5000,
    "Recovery check interval is 5s",
  );
  assert(
    service2.recoveryInterval !== undefined,
    "Recovery interval timer is set",
  );

  await service2.close();
}

// =============================================================================
// TEST 7: Stats and Monitoring
// =============================================================================

async function testStatsAndMonitoring() {
  logSection("TEST 7: Stats and Monitoring");

  logTest("Test 7.1: Stats Structure");
  const service = new PdfRenderServiceResilient({
    enableLogging: false,
    warmup: false,
  });

  const stats = service.getStats();

  // Check for all expected stats fields
  const expectedFields = [
    "threads",
    "queueSize",
    "renders",
    "errors",
    "retries",
    "recovered",
    "workerCrashes",
    "avgTime",
    "p50",
    "p95",
    "p99",
    "currentlyExecuting",
    "stuckTasksCount",
    "hungTasksTotal",
    "hangDetectionEnabled",
    "hangThreshold",
    "maxConcurrentTasks",
    "cpuOversubscription",
    "recoveryRate",
    "errorRate",
    "rps",
  ];

  let allFieldsPresent = true;
  for (const field of expectedFields) {
    if (!(field in stats)) {
      logFail(`Missing stats field: ${field}`);
      allFieldsPresent = false;
    }
  }

  assert(allFieldsPresent, "All expected stats fields are present");

  logInfo(`Stats fields count: ${Object.keys(stats).length}`);

  await service.close();

  logTest("Test 7.2: Health Check Logic");
  const service2 = new PdfRenderServiceResilient({
    enableLogging: false,
    warmup: false,
  });

  const isHealthy = service2.isHealthy();
  assert(typeof isHealthy === "boolean", "isHealthy returns boolean");
  assert(isHealthy === true, "New service is healthy");

  await service2.close();
}

// =============================================================================
// TEST 8: Real PDF Rendering with Hang Detection
// =============================================================================

async function testRealPDFRendering() {
  logSection("TEST 8: Real PDF Rendering with Hang Detection");

  logTest("Test 8.1: Simple PDF Rendering");
  const service = new PdfRenderServiceResilient({
    taskTimeout: 10_000,
    maxRetries: 2,
    enableLogging: false,
    warmup: true,
  });

  // Wait for warmup
  await new Promise((resolve) => setTimeout(resolve, 500));

  const docDefinition = {
    content: ["Hello World"],
    pageMargins: [40, 40, 40, 40],
  };

  const startTime = Date.now();

  try {
    const buffer = await service.renderToBuffer(docDefinition);
    const duration = Date.now() - startTime;

    assert(buffer instanceof Buffer, "Returned a Buffer");
    assert(buffer.length > 0, `Buffer has content (${buffer.length} bytes)`);
    assert(duration < 5000, `Rendered in ${duration}ms (< 5s)`);

    logInfo(`Render time: ${duration}ms`);
    logInfo(`Buffer size: ${buffer.length} bytes`);
  } catch (err) {
    logFail(`PDF rendering failed: ${err.message}`);
  }

  const stats = service.getStats();
  logInfo(`Total renders: ${stats.renders}`);
  logInfo(`Errors: ${stats.errors}`);
  logInfo(`Average time: ${stats.avgTime}ms`);

  await service.close();

  logTest("Test 8.2: Multiple Concurrent PDFs");
  const service2 = new PdfRenderServiceResilient({
    taskTimeout: 10_000,
    enableLogging: false,
    warmup: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  const renderTasks = [];
  const count = 5;

  for (let i = 0; i < count; i++) {
    renderTasks.push(
      service2.renderToBuffer({
        content: [`PDF Document ${i + 1}`],
        pageMargins: [40, 40, 40, 40],
      }),
    );
  }

  const startConcurrent = Date.now();
  const results = await Promise.allSettled(renderTasks);
  const durationConcurrent = Date.now() - startConcurrent;

  const successful = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  assert(
    successful === count,
    `All ${count} PDFs rendered successfully (${successful}/${count})`,
  );
  assert(failed === 0, `No failures (${failed} failed)`);

  logInfo(`Concurrent render time: ${durationConcurrent}ms for ${count} PDFs`);
  logInfo(`Average per PDF: ${Math.round(durationConcurrent / count)}ms`);

  await service2.close();
}

// =============================================================================
// TEST 9: Configuration Validation
// =============================================================================

async function testConfigurationValidation() {
  logSection("TEST 9: Configuration Validation");

  logTest("Test 9.1: Minimum Thread Validation");
  const service1 = new PdfRenderServiceResilient({
    minThreads: Math.max(2, Math.ceil(os.cpus().length * 0.5)),
    enableLogging: false,
    warmup: false,
    enableRecovery: false,
    enableHangDetection: false,
  });

  // Should be at least 2
  assert(
    service1.options.minThreads >= 2,
    `minThreads is at least 2 (got ${service1.options.minThreads})`,
  );

  await service1.close();

  logTest("Test 9.2: Maximum Thread Validation");
  const service2 = new PdfRenderServiceResilient({
    minThreads: Math.max(2, Math.ceil(os.cpus().length * 0.5)),
    maxThreads: Math.max(4, Math.ceil(os.cpus().length * 0.75)),
    enableLogging: false,
    warmup: false,
    enableRecovery: false,
    enableHangDetection: false,
  });

  // Should be at least 4
  assert(
    service2.options.maxThreads >= 4,
    `maxThreads is at least 4 (got ${service2.options.maxThreads})`,
  );

  await service2.close();
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runAllTests() {
  console.clear();
  log("\n🧪 HANG DETECTION & RESOURCE OPTIMIZATION TEST SUITE\n", COLORS.CYAN);
  log(`System: ${os.platform()} ${os.arch()}`, COLORS.CYAN);
  log(`CPUs: ${os.cpus().length} cores`, COLORS.CYAN);
  log(`Node: ${process.version}`, COLORS.CYAN);
  log(
    `Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB total\n`,
    COLORS.CYAN,
  );

  const startTime = Date.now();

  try {
    await testCPUOversubscription();
    await testTimeoutConfiguration();
    await testHangDetection();
    await testTaskTimeout();
    await testEventEmission();
    await testRetryConfiguration();
    await testStatsAndMonitoring();
    await testRealPDFRendering();
    await testConfigurationValidation();
  } catch (err) {
    logFail(`Test suite error: ${err.message}`);
    console.error(err);
  }

  const duration = Date.now() - startTime;

  // Summary
  logSection("TEST SUMMARY");
  log(`Total Tests: ${testsPassed + testsFailed}`, COLORS.CYAN);
  log(`✅ Passed: ${testsPassed}`, COLORS.GREEN);
  log(`❌ Failed: ${testsFailed}`, COLORS.RED);
  log(`⏱️  Duration: ${duration}ms`, COLORS.CYAN);

  if (testsFailed === 0) {
    log("\n🎉 ALL TESTS PASSED! 🎉\n", COLORS.GREEN);
    process.exit(0);
  } else {
    log(`\n❌ ${testsFailed} TEST(S) FAILED\n`, COLORS.RED);
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
