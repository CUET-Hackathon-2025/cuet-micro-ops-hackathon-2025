# Observability Dashboard

A React dashboard for monitoring the Download Service with Sentry error tracking
and OpenTelemetry distributed tracing.

## Features

- **Health Status**: Real-time API health monitoring from `/health` endpoint
- **Download Jobs**: Initiate and track file downloads with status updates
- **Error Log**: Recent errors captured and sent to Sentry
- **Trace Viewer**: View distributed traces with links to Jaeger UI
- **Performance Metrics**: API response times, success/failure rates

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React/Vite)                     │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Sentry SDK  │  │ OpenTelemetry│  │ React Query      │   │
│  │ - Errors    │  │ - Traces     │  │ - Server State   │   │
│  │ - Perf      │  │ - Propagation│  │ - Caching        │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────────────┘   │
└─────────┼────────────────┼──────────────────────────────────┘
          │                │
          │                │ traceparent header
          ▼                ▼
┌─────────────────┐  ┌─────────────┐  ┌──────────────────┐
│   Sentry.io     │  │ Jaeger      │  │ Backend API      │
│   Cloud         │  │ :16686      │  │ :3000            │
└─────────────────┘  └─────────────┘  └──────────────────┘
```

## Prerequisites

- Node.js >= 18
- Docker & Docker Compose (for full stack)
- Sentry account (optional, for error tracking)

## Quick Start

### 1. Clone and Install

```bash
cd frontend
npm install
```

### 2. Configure Environment

Create a `.env` file:

```env
VITE_API_URL=http://localhost:4000
VITE_SENTRY_DSN=<your-sentry-dsn>
VITE_OTEL_EXPORTER_URL=http://localhost:4318
VITE_JAEGER_UI_URL=http://localhost:16686
```

### 3. Run Development Server

```bash
npm run dev
```

The dashboard will be available at http://localhost:5173

## Setting Up Sentry

1. **Create a Sentry Account**: Go to [sentry.io](https://sentry.io) and sign up

2. **Create a New Project**:
   - Select "React" as the platform
   - Name your project (e.g., "observability-dashboard")

3. **Get Your DSN**:
   - Go to Settings → Projects → Your Project → Client Keys (DSN)
   - Copy the DSN URL

4. **Configure the Dashboard**:
   - Add the DSN to your `.env` file as `VITE_SENTRY_DSN`

### Sentry Features Used

- **Error Boundary**: Wraps the entire app to catch React errors
- **Performance Monitoring**: BrowserTracing for page load metrics
- **Breadcrumbs**: Automatic tracking of user actions
- **User Feedback**: Dialog shown when errors occur
- **Trace Correlation**: Links Sentry errors to OpenTelemetry traces

## OpenTelemetry Configuration

### Trace Propagation

The dashboard automatically propagates W3C Trace Context (`traceparent` header)
to the backend API. This enables:

- End-to-end distributed tracing
- Correlation between frontend and backend spans
- Error tracking with trace IDs in Sentry

### Viewing Traces in Jaeger

1. Open Jaeger UI at http://localhost:16686
2. Select "observability-dashboard" service
3. Search for traces by trace ID or time range

### Trace Flow

```
User clicks "Download" button
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

## Running with Docker Compose

### Full Stack (Recommended)

From the project root:

```bash
docker compose -f docker/compose.dev.yml up --build
```

This starts:

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000
- **Jaeger UI**: http://localhost:16686
- **MinIO Console**: http://localhost:9001

### Frontend Only

```bash
docker build -t observability-dashboard --target development .
docker run -p 5173:5173 \
  -e VITE_API_URL=http://localhost:4000 \
  -e VITE_OTEL_EXPORTER_URL=http://localhost:4318 \
  observability-dashboard
```

## Testing Sentry Integration

The API includes a built-in way to test Sentry error tracking:

### From the Dashboard

1. Navigate to the "Download Jobs" section
2. Click the "Trigger Error" button
3. Check your Sentry dashboard for the captured error

### From cURL

```bash
curl -X POST "http://localhost:3000/v1/download/check?sentry_test=true" \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'
```

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── ui/              # shadcn/ui components
│   │   ├── Dashboard.tsx    # Main layout
│   │   ├── HealthStatus.tsx # Health monitoring
│   │   ├── DownloadJobs.tsx # Download management
│   │   ├── ErrorLog.tsx     # Error display
│   │   ├── TraceViewer.tsx  # Trace correlation
│   │   ├── PerformanceMetrics.tsx
│   │   └── ErrorBoundary.tsx
│   ├── lib/
│   │   ├── api.ts           # API client
│   │   ├── sentry.ts        # Sentry configuration
│   │   ├── tracing.ts       # OpenTelemetry setup
│   │   └── utils.ts         # Utility functions
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css            # Tailwind CSS
├── Dockerfile
├── nginx.conf
└── package.json
```

## Environment Variables

| Variable                 | Description                   | Default                  |
| ------------------------ | ----------------------------- | ------------------------ |
| `VITE_API_URL`           | Backend API URL               | `http://localhost:3000`  |
| `VITE_SENTRY_DSN`        | Sentry DSN for error tracking | (empty)                  |
| `VITE_OTEL_EXPORTER_URL` | OTLP HTTP exporter URL        | `http://localhost:4318`  |
| `VITE_JAEGER_UI_URL`     | Jaeger UI URL for trace links | `http://localhost:16686` |

## Troubleshooting

### Traces not appearing in Jaeger

1. Check that Jaeger is running: `docker ps | grep jaeger`
2. Verify OTEL exporter URL is correct
3. Check browser console for CORS errors
4. Ensure the backend API has `traceparent` in allowed headers

### Sentry errors not captured

1. Verify DSN is correct and starts with `https://`
2. Check browser console for Sentry initialization messages
3. Ensure errors are not being caught by local error handlers

### CORS Issues

The backend API must allow:

- Origin: `http://localhost:5173` (or your frontend URL)
- Headers: `traceparent`, `Content-Type`

## License

MIT
