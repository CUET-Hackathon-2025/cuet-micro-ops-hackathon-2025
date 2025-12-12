import { Activity, Github } from "lucide-react"
import { HealthStatus } from "./HealthStatus"
import { DownloadJobs } from "./DownloadJobs"
import { ErrorLog } from "./ErrorLog"
import { TraceViewer } from "./TraceViewer"
import { PerformanceMetrics } from "./PerformanceMetrics"

export function Dashboard() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Activity className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">
                  Observability Dashboard
                </h1>
                <p className="text-sm text-muted-foreground">
                  Sentry + OpenTelemetry + Jaeger
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-xs text-muted-foreground">API Endpoint</p>
                <code className="text-sm text-primary font-mono">
                  {import.meta.env.VITE_API_URL ?? "http://localhost:4000"}
                </code>
              </div>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-lg hover:bg-secondary transition-colors"
              >
                <Github className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {/* Health Status - Full width on mobile, 1 col on larger screens */}
          <div className="lg:col-span-1">
            <HealthStatus />
          </div>

          {/* Download Jobs - Takes 2 columns on xl */}
          <div className="lg:col-span-1 xl:col-span-2">
            <DownloadJobs />
          </div>

          {/* Error Log */}
          <div className="lg:col-span-1">
            <ErrorLog />
          </div>

          {/* Trace Viewer */}
          <div className="lg:col-span-1">
            <TraceViewer />
          </div>

          {/* Performance Metrics */}
          <div className="lg:col-span-2 xl:col-span-1">
            <PerformanceMetrics />
          </div>
        </div>

        {/* Footer Info */}
        <footer className="mt-8 pt-6 border-t border-border">
          <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">Quick Links:</span>
            </div>
            <a
              href={`${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}/docs`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              API Docs
            </a>
            <a
              href={import.meta.env.VITE_JAEGER_UI_URL ?? "http://localhost:16686"}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              Jaeger UI
            </a>
            <a
              href="https://sentry.io"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              Sentry Dashboard
            </a>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            CUET MicroOps Hackathon 2025 - Challenge 4: Observability Dashboard
          </p>
        </footer>
      </main>
    </div>
  )
}

