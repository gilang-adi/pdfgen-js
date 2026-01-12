# PDF Generator - Just Commands
# Run `just --list` to see all available commands

# Default recipe to display help
default:
    @just --list

# === Development ===

# Start development server with hot reload
dev:
    node --watch src/server-ultra.js

# Start development server with auto-GC enabled
dev-gc:
    AUTO_GC=true node --watch --expose-gc src/server-ultra.js

# Start development server with debug stats
dev-debug:
    DEBUG_STATS=true node --watch src/server-ultra.js

# Start production server
prod:
    NODE_ENV=production node --expose-gc src/server-ultra.js

# Start production server with auto-GC
prod-gc:
    NODE_ENV=production AUTO_GC=true node --expose-gc src/server-ultra.js

# === Benchmarking ===

# Run standard benchmark (20 concurrent, 15s per endpoint)
bench:
    node benchmark-ultra-endpoints.js

# Quick benchmark test (10 concurrent, 10s per endpoint)
bench-quick:
    CONCURRENCY=10 DURATION=10000 node benchmark-ultra-endpoints.js

# Heavy load test (50 concurrent, 60s per endpoint)
bench-load:
    CONCURRENCY=50 DURATION=60000 node benchmark-ultra-endpoints.js

# Stress test (100 concurrent, 120s per endpoint)
bench-stress:
    CONCURRENCY=100 DURATION=120000 node benchmark-ultra-endpoints.js

# Light benchmark (5 concurrent, 5s per endpoint)
bench-light:
    CONCURRENCY=5 DURATION=5000 node benchmark-ultra-endpoints.js

# Custom benchmark (usage: just bench-custom <concurrency> <duration_ms>)
bench-custom CONCURRENCY DURATION:
    CONCURRENCY={{CONCURRENCY}} DURATION={{DURATION}} node benchmark-ultra-endpoints.js

# === Server Management ===

# Start server (background)
start:
    @echo "Starting server-ultra.js on port 3001..."
    @node --expose-gc src/server-ultra.js > /dev/null 2>&1 &
    @sleep 2
    @echo "✓ Server running on http://localhost:3001"

# Start server with auto-GC (background)
start-gc:
    @echo "Starting server-ultra.js with auto-GC on port 3001..."
    @AUTO_GC=true node --expose-gc src/server-ultra.js > /dev/null 2>&1 &
    @sleep 2
    @echo "✓ Server running with auto-GC enabled"

# Stop all servers on port 3001
stop:
    @echo "Stopping servers on port 3001..."
    @lsof -ti:3001 | xargs kill -9 2>/dev/null || echo "No servers running"
    @echo "✓ Servers stopped"

# Restart server
restart: stop start

# Check server health
health:
    @curl -s http://localhost:3001/health | jq '.' || echo "Server not responding"

# Check server metrics
metrics:
    @curl -s http://localhost:3001/metrics | jq '.' || echo "Server not responding"

# Check dead letter queue (DLQ) debug info
dlq:
    @curl -s http://localhost:3001/debug/dlq | jq '.' || echo "Server not responding"

# Check active tasks debug info
tasks:
    @curl -s http://localhost:3001/debug/tasks | jq '.' || echo "Server not responding"

# === Testing ===

# Generate a test PDF (GET request)
test-pdf:
    @echo "Generating test PDF..."
    @curl -s http://localhost:3001/pdf -o test-output.pdf
    @echo "✓ PDF saved to test-output.pdf"
    @ls -lh test-output.pdf

# Generate a test PDF with streaming (GET request)
test-pdf-stream:
    @echo "Generating streaming test PDF..."
    @curl -s http://localhost:3001/pdf/stream -o test-output-stream.pdf
    @echo "✓ PDF saved to test-output-stream.pdf"
    @ls -lh test-output-stream.pdf

# Generate a test PDF (POST request)
test-pdf-post:
    @echo "Generating test PDF via POST..."
    @curl -s -X POST http://localhost:3001/pdf -o test-output-post.pdf
    @echo "✓ PDF saved to test-output-post.pdf"
    @ls -lh test-output-post.pdf

# Test all PDF endpoints
test-all: test-pdf test-pdf-stream test-pdf-post
    @echo "✓ All PDF endpoints tested"

# Run multiple PDF generations for load testing
test-load N="10":
    #!/usr/bin/env sh
    echo "Generating {{N}} PDFs..."
    for i in $(seq 1 {{N}}); do \
        curl -s http://localhost:3001/pdf -o /dev/null && \
        echo "Generated PDF $i/{{N}}"; \
    done
    echo "✓ Load test complete"

# Run hang detection test
test-hang:
    npm run test:hang

# Run thread safety test
test-thread:
    npm run test:thread

# Run all tests (hang detection + thread safety)
test: test-hang test-thread

# === Cleanup ===

# Clean test outputs
clean-test:
    @echo "Removing test outputs..."
    @rm -f test-output*.pdf
    @rm -rf benchmark-results
    @echo "✓ Test outputs cleaned"

# Clean empty directories
clean-dirs:
    @echo "Removing empty directories..."
    @find src -type d -empty -delete 2>/dev/null || true
    @echo "✓ Empty directories removed"

# Full cleanup (test files + empty dirs)
clean: clean-test clean-dirs

# === Monitoring ===

# Show server status
status:
    @echo "=== Server Status ==="
    @if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1; then \
        echo "✓ Server is running on port 3001"; \
        echo ""; \
        curl -s http://localhost:3001/health | jq '.' 2>/dev/null || true; \
    else \
        echo "✗ No server running on port 3001"; \
    fi

# Monitor system resources
monitor:
    @echo "Monitoring port 3001..."
    @if command -v watch >/dev/null 2>&1; then \
        watch -n 1 'lsof -ti:3001 | xargs ps -p 2>/dev/null | tail -n +2'; \
    else \
        echo "Note: 'watch' command not found. Install with: brew install watch"; \
        echo ""; \
        echo "Current server process:"; \
        lsof -ti:3001 | xargs ps -p 2>/dev/null | tail -n +2 || echo "No server running"; \
    fi

# Show current connections to server
connections:
    @echo "Active connections to port 3001:"
    @lsof -i:3001 | grep ESTABLISHED || echo "No active connections"

# Watch server logs (continuous health check)
logs:
    @echo "Watching server health (Ctrl+C to stop)..."
    @while true; do \
        clear; \
        date; \
        echo ""; \
        curl -s http://localhost:3001/health | jq '.' 2>/dev/null || echo "Server not responding"; \
        sleep 2; \
    done

# === Info & Docs ===

# Show environment info
info:
    @echo "=== Environment Info ==="
    @node --version | xargs -I {} echo "Node version: {}"
    @npm --version | xargs -I {} echo "NPM version: {}"
    @just --version | xargs -I {} echo "Just version: {}"
    @uname -s | xargs -I {} echo "OS: {}"
    @sysctl -n hw.ncpu 2>/dev/null | xargs -I {} echo "CPU cores: {}" || nproc 2>/dev/null | xargs -I {} echo "CPU cores: {}" || echo "CPU cores: Unknown"
    @echo ""
    @echo "=== Project Info ==="
    @cat package.json | jq '{name, version, description, main}'

# Show available endpoints
endpoints:
    @echo "=== Available Endpoints ==="
    @echo ""
    @echo "Health & Monitoring:"
    @echo "  GET  /health           - Health check"
    @echo "  GET  /metrics          - Performance metrics"
    @echo "  GET  /debug/dlq        - Dead letter queue info"
    @echo "  GET  /debug/tasks      - Active tasks info"
    @echo ""
    @echo "PDF Generation:"
    @echo "  GET  /pdf              - Generate PDF (buffer response)"
    @echo "  POST /pdf              - Generate PDF (buffer response)"
    @echo "  GET  /pdf/stream       - Generate PDF (streaming response)"
    @echo "  POST /pdf/stream       - Generate PDF (streaming response)"
    @echo ""
    @echo "Data:"
    @echo "  GET  /api/invoice-data - Get mock invoice data"

# Show benchmark results summary
results:
    @echo "=== Latest Benchmark Results ==="
    @echo "Run 'just bench-quick' to generate new results"
    @echo ""
    @echo "Available benchmarks:"
    @echo "  just bench-light   - 5 concurrent, 5s per endpoint"
    @echo "  just bench-quick   - 10 concurrent, 10s per endpoint"
    @echo "  just bench         - 20 concurrent, 15s per endpoint"
    @echo "  just bench-load    - 50 concurrent, 60s per endpoint"
    @echo "  just bench-stress  - 100 concurrent, 120s per endpoint"

# Show README
readme:
    @cat README.md | head -100

# === Installation ===

# Install dependencies
install:
    npm install

# Install and setup
setup: install
    @echo "✓ Setup complete!"
    @echo ""
    @echo "Quick start:"
    @echo "  just dev          - Start development server"
    @echo "  just start        - Start server in background"
    @echo "  just test-pdf     - Generate a test PDF"
    @echo "  just bench-quick  - Run quick benchmark"

# === Quick Shortcuts ===

# Quick: Clean, start server, and run quick benchmark
quick: stop
    @echo "Starting fresh benchmark..."
    @sleep 1
    @just bench-quick

# Quick: Start server and generate test PDF
demo: stop start
    @sleep 2
    @just test-pdf
    @echo ""
    @echo "✓ Demo complete! Check test-output.pdf"

# Run complete workflow (install, start, test)
workflow: install start
    @sleep 3
    @just test-all
    @echo ""
    @echo "✓ Complete workflow finished!"

# === Help ===

# Show detailed help
help:
    @echo "PDF Generator - Just Commands"
    @echo ""
    @echo "Quick Start:"
    @echo "  just dev           - Start development server"
    @echo "  just start         - Start server in background"
    @echo "  just stop          - Stop server"
    @echo "  just demo          - Quick demo (start + generate PDF)"
    @echo ""
    @echo "Server Management:"
    @echo "  just start         - Start server"
    @echo "  just start-gc      - Start with auto-GC"
    @echo "  just stop          - Stop all servers"
    @echo "  just restart       - Restart server"
    @echo "  just health        - Check server health"
    @echo "  just metrics       - View metrics"
    @echo "  just status        - Full status info"
    @echo ""
    @echo "Testing:"
    @echo "  just test-pdf      - Generate test PDF"
    @echo "  just test-all      - Test all endpoints"
    @echo "  just test-load N   - Generate N PDFs"
    @echo "  just test          - Run all tests"
    @echo ""
    @echo "Benchmarking:"
    @echo "  just bench-light   - Light test (5s)"
    @echo "  just bench-quick   - Quick test (10s)"
    @echo "  just bench         - Standard (15s)"
    @echo "  just bench-load    - Heavy load (60s)"
    @echo "  just bench-stress  - Stress test (120s)"
    @echo ""
    @echo "Information:"
    @echo "  just endpoints     - Show all API endpoints"
    @echo "  just info          - Environment info"
    @echo "  just --list        - List all commands"
    @echo ""
    @echo "Cleanup:"
    @echo "  just clean         - Remove test files"
