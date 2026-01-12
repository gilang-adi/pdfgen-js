import http from "http";
import { spawn } from "child_process";
import { performance } from "perf_hooks";

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

class EndpointBenchmark {
  constructor() {
    this.serverProcess = null;
    this.memorySnapshots = [];
    this.monitoringInterval = null;
    this.concurrency = parseInt(process.env.CONCURRENCY) || 20;
    this.duration = parseInt(process.env.DURATION) || 15000; // 15s each
    this.endpoints = [
      {
        name: "/pdf (GET - Buffer)",
        path: "/pdf",
        color: COLORS.green,
        description: "GET request with buffer response",
      },
      {
        name: "/pdf/stream (GET - Stream)",
        path: "/pdf/stream",
        color: COLORS.cyan,
        description: "GET request with streaming response",
      },
      {
        name: "/pdf (POST - Buffer)",
        path: "/pdf",
        method: "POST",
        color: COLORS.yellow,
        description: "POST request with buffer response",
      },
      {
        name: "/pdf/stream (POST - Stream)",
        path: "/pdf/stream",
        method: "POST",
        color: COLORS.magenta,
        description: "POST request with streaming response",
      },
    ];
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  async getProcessMemory(pid) {
    return new Promise((resolve) => {
      const ps = spawn("ps", ["-o", "rss,vsz", "-p", pid]);
      let output = "";

      ps.stdout.on("data", (data) => {
        output += data.toString();
      });

      ps.on("close", () => {
        const lines = output.trim().split("\n");
        if (lines.length < 2) {
          resolve({ rss: 0, vsz: 0 });
          return;
        }

        const parts = lines[1].trim().split(/\s+/);
        resolve({
          rss: parseInt(parts[0]) * 1024, // Convert KB to bytes
          vsz: parseInt(parts[1]) * 1024,
        });
      });

      ps.on("error", () => {
        resolve({ rss: 0, vsz: 0 });
      });
    });
  }

  startMemoryMonitoring() {
    this.memorySnapshots = [];
    this.monitoringInterval = setInterval(async () => {
      if (this.serverProcessPid) {
        const mem = await this.getProcessMemory(this.serverProcessPid);
        this.memorySnapshots.push({
          timestamp: Date.now(),
          rss: mem.rss,
          vsz: mem.vsz,
        });
      }
    }, 500); // Sample every 500ms
  }

  stopMemoryMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  getMemoryStats() {
    if (this.memorySnapshots.length === 0) {
      return {
        initial: 0,
        peak: 0,
        final: 0,
        average: 0,
        min: 0,
      };
    }

    const rssValues = this.memorySnapshots.map((s) => s.rss);
    const sum = rssValues.reduce((a, b) => a + b, 0);

    return {
      initial: rssValues[0],
      peak: Math.max(...rssValues),
      final: rssValues[rssValues.length - 1],
      average: Math.round(sum / rssValues.length),
      min: Math.min(...rssValues),
    };
  }

  async killPort(port) {
    try {
      const kill = spawn("lsof", ["-ti", `:${port}`]);
      let pids = "";

      kill.stdout.on("data", (data) => {
        pids += data.toString();
      });

      return new Promise((resolve) => {
        kill.on("close", () => {
          if (pids.trim()) {
            const pidList = pids.trim().split("\n");
            pidList.forEach((pid) => {
              try {
                process.kill(parseInt(pid), "SIGKILL");
              } catch (e) {
                // Ignore
              }
            });
          }
          setTimeout(resolve, 1000);
        });
      });
    } catch (e) {
      // Ignore
    }
  }

  async startServer() {
    const port = 3001;
    await this.killPort(port);

    console.log(`\n${COLORS.bright}Starting server-ultra.js...${COLORS.reset}`);

    const env = {
      ...process.env,
      PORT: port,
      NODE_ENV: "production",
      AUTO_GC: "true",
    };

    // Simplified startServer: spawn the server and wait a short period for it to be ready
    this.serverProcess = spawn(
      "node",
      ["--expose-gc", process.env.SERVER_FILE || "src/server-ultra.js"],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    // Use the process PID directly (no worker PID parsing needed)
    this.serverProcessPid = this.serverProcess.pid;
    // Wait a moment for the server to initialize
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log(
      `${COLORS.green}✓ Server started (PID: ${this.serverProcessPid})${COLORS.reset}`,
    );
  }

  async stopServer() {
    if (this.serverProcess) {
      this.serverProcess.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (this.serverProcess.killed === false) {
        this.serverProcess.kill("SIGKILL");
      }
      this.serverProcess = null;
      this.serverProcessPid = null;
    }
  }

  async waitForServer(endpoint = "/health") {
    for (let i = 0; i < 10; i++) {
      try {
        const req = http.get(`http://localhost:3001${endpoint}`, () => {
          return true;
        });
        req.on("error", () => {});
        req.end();
        await new Promise((resolve) => setTimeout(resolve, 500));
        return true;
      } catch (e) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    return false;
  }

  async makeRequest(endpoint) {
    const startTime = performance.now();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, latency: 0, timeout: true });
      }, 30000);

      const options = {
        hostname: "localhost",
        port: 3001,
        path: endpoint.path || endpoint,
        method: endpoint.method || "GET",
      };

      const req = http.request(options, (res) => {
        let data = [];

        res.on("data", (chunk) => {
          data.push(chunk);
        });

        res.on("end", () => {
          clearTimeout(timeout);
          const latency = performance.now() - startTime;
          resolve({
            success: res.statusCode === 200,
            latency,
            timeout: false,
          });
        });
      });

      req.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ success: false, latency: 0, timeout: false });
      });

      req.end();
    });
  }

  async runBenchmark(endpoint) {
    console.log(
      `\n${COLORS.bright}${COLORS.blue}Benchmarking: ${endpoint.name}${COLORS.reset}`,
    );
    console.log(`${COLORS.cyan}Path: ${endpoint.path}${COLORS.reset}`);
    console.log(
      `${COLORS.cyan}Description: ${endpoint.description}${COLORS.reset}`,
    );
    console.log(
      `Concurrency: ${this.concurrency} | Duration: ${this.duration}ms\n`,
    );

    const results = {
      requests: 0,
      errors: 0,
      timeouts: 0,
      latencies: [],
    };

    const startTime = Date.now();
    const endTime = startTime + this.duration;

    const workers = [];
    for (let i = 0; i < this.concurrency; i++) {
      workers.push(
        (async () => {
          while (Date.now() < endTime) {
            const result = await this.makeRequest(endpoint.path);
            results.requests++;
            if (result.success) {
              results.latencies.push(result.latency);
            } else if (result.timeout) {
              results.timeouts++;
            } else {
              results.errors++;
            }
          }
        })(),
      );
    }

    await Promise.all(workers);

    const totalTime = (Date.now() - startTime) / 1000;
    const latencies = results.latencies.sort((a, b) => a - b);
    const successfulRequests = latencies.length;

    return {
      endpoint: endpoint.name,
      totalRequests: results.requests,
      successfulRequests,
      errors: results.errors,
      timeouts: results.timeouts,
      requestsPerSecond: (results.requests / totalTime).toFixed(2),
      avgLatency: successfulRequests
        ? (latencies.reduce((a, b) => a + b, 0) / successfulRequests).toFixed(2)
        : 0,
      minLatency: latencies[0]?.toFixed(2) || 0,
      maxLatency: latencies[latencies.length - 1]?.toFixed(2) || 0,
      p50: latencies[Math.floor(latencies.length * 0.5)]?.toFixed(2) || 0,
      p95: latencies[Math.floor(latencies.length * 0.95)]?.toFixed(2) || 0,
      p99: latencies[Math.floor(latencies.length * 0.99)]?.toFixed(2) || 0,
      totalTime: totalTime.toFixed(2),
    };
  }

  printResults(result, memoryStats) {
    console.log(`\n${COLORS.bright}${COLORS.green}Results:${COLORS.reset}`);
    console.log(`  Total Requests:      ${result.totalRequests}`);
    console.log(`  Successful:          ${result.successfulRequests}`);
    console.log(`  Errors:              ${result.errors}`);
    console.log(`  Timeouts:            ${result.timeouts}`);
    console.log(
      `  ${COLORS.bright}Throughput:${COLORS.reset}          ${COLORS.green}${result.requestsPerSecond} req/s${COLORS.reset}`,
    );
    console.log(`\n${COLORS.bright}Latency:${COLORS.reset}`);
    console.log(`  Average:             ${result.avgLatency} ms`);
    console.log(`  Min:                 ${result.minLatency} ms`);
    console.log(`  Max:                 ${result.maxLatency} ms`);
    console.log(`  p50:                 ${result.p50} ms`);
    console.log(`  p95:                 ${result.p95} ms`);
    console.log(
      `  ${COLORS.bright}p99:${COLORS.reset}                 ${COLORS.cyan}${result.p99} ms${COLORS.reset}`,
    );

    if (memoryStats && memoryStats.peak > 0) {
      const growth = memoryStats.final - memoryStats.initial;
      const growthPercent = ((growth / memoryStats.initial) * 100).toFixed(1);
      const growthColor = growth > 0 ? COLORS.yellow : COLORS.green;

      console.log(`\n${COLORS.bright}Memory Usage:${COLORS.reset}`);
      console.log(
        `  Initial:             ${this.formatBytes(memoryStats.initial)}`,
      );
      console.log(
        `  ${COLORS.bright}Peak:${COLORS.reset}                ${COLORS.red}${this.formatBytes(memoryStats.peak)}${COLORS.reset}`,
      );
      console.log(
        `  Final:               ${this.formatBytes(memoryStats.final)}`,
      );
      console.log(
        `  Average:             ${this.formatBytes(memoryStats.average)}`,
      );
      console.log(
        `  ${COLORS.bright}Growth:${COLORS.reset}              ${growthColor}${this.formatBytes(growth)} (${growthPercent}%)${COLORS.reset}`,
      );
    }
  }

  compareResults(allResults) {
    console.log(
      `\n\n${COLORS.bright}${COLORS.blue}${"=".repeat(80)}${COLORS.reset}`,
    );
    console.log(
      `${COLORS.bright}${COLORS.blue}COMPARISON SUMMARY - All Endpoints${COLORS.reset}`,
    );
    console.log(
      `${COLORS.bright}${COLORS.blue}${"=".repeat(80)}${COLORS.reset}\n`,
    );

    // Throughput comparison
    console.log(
      `${COLORS.bright}${COLORS.green}📊 Throughput (req/s):${COLORS.reset}`,
    );
    const sortedByThroughput = [...allResults].sort(
      (a, b) =>
        parseFloat(b.result.requestsPerSecond) -
        parseFloat(a.result.requestsPerSecond),
    );
    sortedByThroughput.forEach((item, idx) => {
      const medal =
        idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "  ";
      const baseline = parseFloat(
        sortedByThroughput[sortedByThroughput.length - 1].result
          .requestsPerSecond,
      );
      const current = parseFloat(item.result.requestsPerSecond);
      const improvement = (((current - baseline) / baseline) * 100).toFixed(1);
      const improvementStr =
        improvement > 0 ? `+${improvement}%` : `${improvement}%`;
      const color = idx === 0 ? COLORS.green : COLORS.reset;

      console.log(
        `  ${medal} ${item.endpoint.name.padEnd(40)} ${color}${item.result.requestsPerSecond} req/s${COLORS.reset} (${improvementStr})`,
      );
    });

    // Average Latency comparison
    console.log(
      `\n${COLORS.bright}${COLORS.yellow}⚡ Average Latency (ms):${COLORS.reset}`,
    );
    const sortedByLatency = [...allResults].sort(
      (a, b) =>
        parseFloat(a.result.avgLatency) - parseFloat(b.result.avgLatency),
    );
    sortedByLatency.forEach((item, idx) => {
      const medal =
        idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "  ";
      const baseline = parseFloat(
        sortedByLatency[sortedByLatency.length - 1].result.avgLatency,
      );
      const current = parseFloat(item.result.avgLatency);
      const improvement = (((baseline - current) / baseline) * 100).toFixed(1);
      const improvementStr =
        improvement > 0 ? `-${improvement}%` : `+${Math.abs(improvement)}%`;
      const color = idx === 0 ? COLORS.green : COLORS.reset;

      console.log(
        `  ${medal} ${item.endpoint.name.padEnd(40)} ${color}${item.result.avgLatency} ms${COLORS.reset} (${improvementStr})`,
      );
    });

    // P99 Latency comparison
    console.log(
      `\n${COLORS.bright}${COLORS.cyan}📈 P99 Latency (ms):${COLORS.reset}`,
    );
    const sortedByP99 = [...allResults].sort(
      (a, b) => parseFloat(a.result.p99) - parseFloat(b.result.p99),
    );
    sortedByP99.forEach((item, idx) => {
      const medal =
        idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "  ";
      const baseline = parseFloat(
        sortedByP99[sortedByP99.length - 1].result.p99,
      );
      const current = parseFloat(item.result.p99);
      const improvement = (((baseline - current) / baseline) * 100).toFixed(1);
      const improvementStr =
        improvement > 0 ? `-${improvement}%` : `+${Math.abs(improvement)}%`;
      const color = idx === 0 ? COLORS.green : COLORS.reset;

      console.log(
        `  ${medal} ${item.endpoint.name.padEnd(40)} ${color}${item.result.p99} ms${COLORS.reset} (${improvementStr})`,
      );
    });

    // Memory comparison
    if (allResults[0].memory && allResults[0].memory.peak > 0) {
      console.log(
        `\n${COLORS.bright}${COLORS.magenta}💾 Peak Memory Usage:${COLORS.reset}`,
      );
      const sortedByMemory = [...allResults].sort(
        (a, b) => a.memory.peak - b.memory.peak,
      );
      sortedByMemory.forEach((item, idx) => {
        const medal =
          idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "  ";
        const baseline = sortedByMemory[sortedByMemory.length - 1].memory.peak;
        const current = item.memory.peak;
        const improvement = (((baseline - current) / baseline) * 100).toFixed(
          1,
        );
        const improvementStr =
          improvement > 0 ? `-${improvement}%` : `+${Math.abs(improvement)}%`;
        const color = idx === 0 ? COLORS.green : COLORS.reset;

        console.log(
          `  ${medal} ${item.endpoint.name.padEnd(40)} ${color}${this.formatBytes(item.memory.peak)}${COLORS.reset} (${improvementStr})`,
        );
      });

      console.log(
        `\n${COLORS.bright}${COLORS.yellow}📊 Memory Growth:${COLORS.reset}`,
      );
      const sortedByGrowth = [...allResults].sort(
        (a, b) =>
          a.memory.final -
          a.memory.initial -
          (b.memory.final - b.memory.initial),
      );
      sortedByGrowth.forEach((item, idx) => {
        const medal =
          idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "  ";
        const growth = item.memory.final - item.memory.initial;
        const growthPercent = ((growth / item.memory.initial) * 100).toFixed(1);
        const color =
          growth < 0 ? COLORS.green : idx === 0 ? COLORS.yellow : COLORS.reset;

        console.log(
          `  ${medal} ${item.endpoint.name.padEnd(40)} ${color}${this.formatBytes(growth)} (${growthPercent}%)${COLORS.reset}`,
        );
      });
    }

    // Winner summary
    console.log(`\n${COLORS.bright}${COLORS.green}🏆 WINNERS:${COLORS.reset}`);
    console.log(
      `  Highest Throughput:  ${sortedByThroughput[0].endpoint.name} (${sortedByThroughput[0].result.requestsPerSecond} req/s)`,
    );
    console.log(
      `  Lowest Avg Latency:  ${sortedByLatency[0].endpoint.name} (${sortedByLatency[0].result.avgLatency} ms)`,
    );
    console.log(
      `  Lowest P99 Latency:  ${sortedByP99[0].endpoint.name} (${sortedByP99[0].result.p99} ms)`,
    );

    if (allResults[0].memory && allResults[0].memory.peak > 0) {
      const sortedByMemory = [...allResults].sort(
        (a, b) => a.memory.peak - b.memory.peak,
      );
      console.log(
        `  Lowest Peak Memory:  ${sortedByMemory[0].endpoint.name} (${this.formatBytes(sortedByMemory[0].memory.peak)})`,
      );
    }

    console.log(
      `\n${COLORS.bright}${COLORS.blue}${"=".repeat(80)}${COLORS.reset}\n`,
    );
  }

  async warmup() {
    console.log(`\n${COLORS.yellow}Warming up server...${COLORS.reset}`);
    for (let i = 0; i < 10; i++) {
      await this.makeRequest("/pdf-static");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(`${COLORS.green}✓ Warmup complete${COLORS.reset}`);
  }

  async run() {
    console.log(
      `\n${COLORS.bright}${COLORS.blue}${"=".repeat(80)}${COLORS.reset}`,
    );
    console.log(
      `${COLORS.bright}${COLORS.blue}SERVER-ULTRA.JS - ALL ENDPOINTS BENCHMARK${COLORS.reset}`,
    );
    console.log(
      `${COLORS.bright}${COLORS.blue}${"=".repeat(80)}${COLORS.reset}`,
    );
    console.log(`Concurrency: ${this.concurrency}`);
    console.log(`Duration per endpoint: ${this.duration}ms`);
    console.log(`Total endpoints: ${this.endpoints.length}`);

    try {
      // Start server once
      await this.startServer();

      // Warmup
      await this.warmup();

      const allResults = [];

      // Test each endpoint
      for (const endpoint of this.endpoints) {
        console.log(
          `\n${COLORS.bright}${COLORS.blue}${"=".repeat(80)}${COLORS.reset}`,
        );

        // Start memory monitoring
        this.memorySnapshots = [];
        this.startMemoryMonitoring();

        // Run benchmark
        const result = await this.runBenchmark(endpoint);

        // Stop memory monitoring
        this.stopMemoryMonitoring();
        const memoryStats = this.getMemoryStats();

        // Print results
        this.printResults(result, memoryStats);

        // Store results
        allResults.push({
          endpoint,
          result,
          memory: memoryStats,
        });

        // Cool down between tests
        console.log(`\n${COLORS.yellow}Cooling down...${COLORS.reset}`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      // Compare all results
      this.compareResults(allResults);

      // Stop server
      await this.stopServer();

      console.log(
        `\n${COLORS.green}${COLORS.bright}✓ All benchmarks completed!${COLORS.reset}\n`,
      );
    } catch (error) {
      console.error(`${COLORS.red}Error: ${error.message}${COLORS.reset}`);
      await this.stopServer();
      process.exit(1);
    }
  }
}

const benchmark = new EndpointBenchmark();
benchmark.run();
