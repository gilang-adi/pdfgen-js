export class MetricsCollector {
  constructor(options = {}) {
    this.counters = new Map();
    this.timings = new Map();
    this.gauges = new Map();
    this.histograms = new Map();

    this.startTime = Date.now();
    this.maxTimings = options.maxTimings || 1000;
    this.histogramBuckets = options.histogramBuckets || [
      10, 50, 100, 200, 500, 1000, 2000, 5000,
    ];

    console.log('Metrics Collector initialized');
  }

  // Increment a counter
  increment(metric, value = 1, tags = {}) {
    const key = this.buildKey(metric, tags);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
  }

  // Decrement a counter
  decrement(metric, value = 1, tags = {}) {
    this.increment(metric, -value, tags);
  }

  // Set a gauge value
  gauge(metric, value, tags = {}) {
    const key = this.buildKey(metric, tags);
    this.gauges.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  // Record timing data
  recordTiming(metric, duration, tags = {}) {
    const key = this.buildKey(metric, tags);

    if (!this.timings.has(key)) {
      this.timings.set(key, []);
    }

    const timings = this.timings.get(key);
    timings.push({
      value: duration,
      timestamp: Date.now(),
    });

    // Keep only recent timings to prevent memory leak
    if (timings.length > this.maxTimings) {
      timings.splice(0, timings.length - this.maxTimings);
    }

    // Also update histogram
    this.updateHistogram(metric, duration, tags);
  }

  // Update histogram buckets
  updateHistogram(metric, value, tags = {}) {
    const key = this.buildKey(metric, tags);

    if (!this.histograms.has(key)) {
      const buckets = {};
      this.histogramBuckets.forEach((bucket) => {
        buckets[`le_${bucket}`] = 0;
      });
      buckets.le_inf = 0;
      buckets.count = 0;
      buckets.sum = 0;

      this.histograms.set(key, buckets);
    }

    const histogram = this.histograms.get(key);

    // Update buckets
    this.histogramBuckets.forEach((bucket) => {
      if (value <= bucket) {
        histogram[`le_${bucket}`]++;
      }
    });

    histogram.le_inf++;
    histogram.count++;
    histogram.sum += value;
  }

  // Time a function execution
  async time(metric, fn, tags = {}) {
    const startTime = process.hrtime.bigint();

    try {
      const result = await fn();
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1_000_000; // Convert to ms

      this.recordTiming(metric, duration, tags);
      this.increment(`${metric}.success`, 1, tags);

      return result;
    } catch (err) {
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1_000_000;

      this.recordTiming(`${metric}.error`, duration, tags);
      this.increment(`${metric}.error`, 1, tags);

      throw err;
    }
  }

  // Build metric key with tags
  buildKey(metric, tags = {}) {
    if (Object.keys(tags).length === 0) {
      return metric;
    }

    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join(',');

    return `${metric}{${tagString}}`;
  }

  // Get timing statistics
  getTimingStats(key) {
    const timings = this.timings.get(key);
    if (!timings || timings.length === 0) {
      return null;
    }

    const values = timings.map((t) => t.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count: values.length,
      sum: Math.round(sum),
      avg: Math.round(sum / values.length),
      min: values[0],
      max: values[values.length - 1],
      p50: values[Math.floor(values.length * 0.5)],
      p90: values[Math.floor(values.length * 0.9)],
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)],
    };
  }

  // Get all metrics
  getMetrics() {
    const now = Date.now();
    const uptime = now - this.startTime;

    // Process timing statistics
    const timingStats = {};
    for (const [key, timings] of this.timings.entries()) {
      const stats = this.getTimingStats(key);
      if (stats) {
        timingStats[key] = stats;
      }
    }

    // Process histograms
    const histogramStats = {};
    for (const [key, histogram] of this.histograms.entries()) {
      histogramStats[key] = {
        ...histogram,
        avg:
          histogram.count > 0 ? Math.round(histogram.sum / histogram.count) : 0,
      };
    }

    return {
      timestamp: now,
      uptime,
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      timings: timingStats,
      histograms: histogramStats,
      system: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        pid: process.pid,
      },
    };
  }

  // Get metrics in Prometheus format
  getPrometheusMetrics() {
    const lines = [];

    // Counters
    for (const [key, value] of this.counters.entries()) {
      lines.push(`# TYPE ${key} counter`);
      lines.push(`${key} ${value}`);
    }

    // Gauges
    for (const [key, data] of this.gauges.entries()) {
      lines.push(`# TYPE ${key} gauge`);
      lines.push(`${key} ${data.value}`);
    }

    // Histograms
    for (const [key, histogram] of this.histograms.entries()) {
      lines.push(`# TYPE ${key} histogram`);

      // Buckets
      this.histogramBuckets.forEach((bucket) => {
        lines.push(
          `${key}_bucket{le="${bucket}"} ${histogram[`le_${bucket}`]}`
        );
      });
      lines.push(`${key}_bucket{le="+Inf"} ${histogram.le_inf}`);

      // Count and sum
      lines.push(`${key}_count ${histogram.count}`);
      lines.push(`${key}_sum ${histogram.sum}`);
    }

    return lines.join('\n');
  }

  // Reset all metrics
  reset() {
    this.counters.clear();
    this.timings.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.startTime = Date.now();

    console.log('Metrics reset');
  }

  // Get summary statistics
  getSummary() {
    const metrics = this.getMetrics();

    return {
      uptime: metrics.uptime,
      totalCounters: this.counters.size,
      totalGauges: this.gauges.size,
      totalTimings: this.timings.size,
      totalHistograms: this.histograms.size,
      memoryUsageMB: Math.round(metrics.system.memory.heapUsed / 1024 / 1024),
      timestamp: metrics.timestamp,
    };
  }
}
