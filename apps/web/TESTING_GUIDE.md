# Observability Dashboard - Testing Guide

## Quick Start

### Start All Services with Docker Compose

```bash
# From project root
docker compose -f docker/compose.dev.yml up --build
```

Wait for all services to start (watch the logs), then access:

| Service | URL | Description |
|---------|-----|-------------|
| **Frontend Dashboard** | http://localhost:5173 | React observability dashboard |
| **Backend API** | http://localhost:4000 | Hono API server |
| **API Docs** | http://localhost:4000/docs | OpenAPI documentation |
| **Jaeger UI** | http://localhost:16686 | Distributed tracing |
| **MinIO Console** | http://localhost:9001 | S3 storage (user: minioadmin, pass: minioadmin) |

---

## Testing Each Dashboard Feature

### 1. Health Status Panel

**Location:** Top-left card on dashboard

**What it shows:**
- Real-time API health from `/health` endpoint
- Storage status (MinIO/S3)
- Redis connection status
- Auto-refresh every 10 seconds
- Trace ID for each health check

**How to test:**
1. Open the dashboard at http://localhost:5173
2. Verify "HEALTHY" badge is green
3. Verify "Storage: OK" is shown
4. Wait 10 seconds - should auto-refresh
5. Click refresh button manually
6. Check that trace ID changes with each request

**Verify via cURL:**
```bash
curl http://localhost:4000/health
# Expected: {"status":"healthy","checks":{"storage":"ok","redis":"ok"}}
```

---

### 2. Download Jobs Panel

**Location:** Center-right panel on dashboard

**What it shows:**
- File availability checker
- Download job queue with real-time progress
- SSE (Server-Sent Events) connection status
- Trace IDs for correlation

**Test 1: Check File Availability**
1. Enter file ID: `70007` (files divisible by 7 are mock-available)
2. Click "Check" button
3. Status should show "AVAILABLE" with file size

**Test 2: Start Download with Real-Time Progress**
1. After checking a file that shows "AVAILABLE"
2. Click "Start Download" button
3. Watch the progress bar fill up in real-time
4. Green wifi icon shows SSE connection active
5. Download completes with download link

**Test 3: Test Unavailable File**
1. Enter file ID: `70001` (not divisible by 7)
2. Click "Check" button
3. Status should show "UNAVAILABLE"

**Test 4: Multiple Downloads**
- Try starting multiple downloads simultaneously
- Each shows independent progress
- Rate limiting kicks in after 3 concurrent downloads

---

### 3. Error Log Panel

**Location:** Bottom-left panel

**What it shows:**
- Recent errors captured by Sentry
- Error message, endpoint, status code
- Trace ID for Jaeger correlation

**How to test:**
1. In Download Jobs panel, click "Trigger Error" button
2. Error should appear in Error Log
3. Shows "Sentry test error triggered for file_id=70000"
4. Click trace ID link to view in Jaeger

**Verify error in Sentry (if configured):**
1. Log into your Sentry dashboard
2. Navigate to Issues
3. Find "Sentry test error triggered" error
4. Check that `trace_id` tag is present

---

### 4. Trace Viewer Panel

**Location:** Bottom-center panel

**What it shows:**
- Recent trace IDs from API calls
- Response time for each request
- Success/failure status
- Links to view traces in Jaeger

**How to test:**
1. Make some API requests (health check, download check)
2. Traces appear in the list
3. Click copy icon to copy trace ID
4. Click external link to open Jaeger
5. In Jaeger, verify you see both frontend and backend spans

**Verify trace propagation:**
1. Open browser DevTools → Network tab
2. Click "Check" on a file ID
3. Find the POST request
4. Check Headers - should include `traceparent` header
5. Copy the trace ID from the header
6. Search in Jaeger - should find the trace

---

### 5. Performance Metrics Panel

**Location:** Bottom-right panel

**What it shows:**
- Total request count
- Success rate percentage
- Average response time
- P95 response time
- Per-endpoint breakdown with bar chart

**How to test:**
1. Make several API requests
2. Watch metrics update in real-time
3. Verify success rate calculation
4. Check response time distributions
5. Clear metrics and start fresh

---

## End-to-End Trace Propagation Test

This is the key feature for the hackathon challenge!

### Flow:
```
User clicks "Check" button
        │
        ▼
Frontend creates span with trace-id: abc123
        │
        ▼
API request includes header: traceparent: 00-abc123-...
        │
        ▼
Backend logs include: trace_id=abc123
        │
        ▼
Errors in Sentry tagged with: trace_id=abc123
```

### Step-by-Step Verification:

1. **Open Browser DevTools** → Network tab

2. **Click "Check"** on file ID 70007

3. **Find the request** to `/v1/download/check`

4. **Verify `traceparent` header:**
   ```
   traceparent: 00-abc123def456...-789xyz...-01
   ```
   - First part (00) = version
   - Second part = trace ID
   - Third part = span ID
   - Fourth part = flags

5. **Copy trace ID** from the Trace Viewer panel

6. **Open Jaeger UI** at http://localhost:16686

7. **Search by trace ID**

8. **Verify you see:**
   - `observability-dashboard` (frontend) spans
   - `delineate-hackathon-challenge` (backend) spans
   - Same trace ID across both

9. **Trigger an error** and verify Sentry has `trace_id` tag

---

## API Endpoints Reference

### Health Check
```bash
curl http://localhost:4000/health
```

### Check File Availability
```bash
curl -X POST http://localhost:4000/v1/download/check \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70007}'
```

### Trigger Sentry Error
```bash
curl -X POST "http://localhost:4000/v1/download/check?sentry_test=true" \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'
```

### Create Async Download Job
```bash
curl -X POST http://localhost:4000/v1/download \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: test-123" \
  -d '{"file_id": 70007}'
```

### Get Job Status
```bash
curl http://localhost:4000/v1/download/status/{jobId}
```

### Subscribe to Job Updates (SSE)
```bash
curl -N http://localhost:4000/v1/download/subscribe/{jobId}
```

---

## Troubleshooting

### "Failed to fetch" errors
- Backend not running or wrong port
- Check: `curl http://localhost:4000/health`
- Verify port in Docker logs

### Worker keeps crashing
- Missing environment variables
- Check Docker Compose logs for delineate-worker
- Ensure Redis is healthy

### SSE not connecting
- CORS issues - check browser console
- Backend SSE endpoint not working
- Try polling fallback: `/v1/download/status/:jobId`

### Traces not in Jaeger
- Jaeger not running: http://localhost:16686
- OTEL exporter URL wrong
- Check: `docker logs delineate-jaeger`

### Sentry errors not appearing
- DSN not configured
- Check browser console for Sentry init messages
- Errors batch-sent, wait a few seconds

---

## Challenge Requirements Checklist

| Requirement | Status | How to Verify |
|-------------|--------|---------------|
| React app with Vite | ✅ | `frontend/` directory |
| Sentry ErrorBoundary | ✅ | `ErrorBoundary.tsx` wraps app |
| Sentry error capture | ✅ | "Trigger Error" → Error Log |
| User feedback dialog | ✅ | Error boundary has feedback button |
| Performance monitoring | ✅ | BrowserTracing in `sentry.ts` |
| OpenTelemetry traces | ✅ | `tracing.ts` with fetch instrumentation |
| Trace propagation | ✅ | `traceparent` header in requests |
| Trace correlation | ✅ | Same trace ID in Jaeger |
| Trace ID in UI | ✅ | Shown in all panels |
| Health Status | ✅ | Real-time /health polling |
| Download Jobs | ✅ | Progress bar, SSE updates |
| Error Log | ✅ | Errors with trace links |
| Trace Viewer | ✅ | Jaeger links, copy trace ID |
| Performance Metrics | ✅ | Response times, success rates |
| Docker Compose | ✅ | Frontend service added |
| Documentation | ✅ | README + this guide |

