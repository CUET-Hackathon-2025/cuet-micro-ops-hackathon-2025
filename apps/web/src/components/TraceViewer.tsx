import { useState, useEffect } from "react";
import { Network, ExternalLink, Copy, Check, RefreshCw } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { getMetrics, type ApiMetrics } from "@/lib/api";
import { cn } from "@/lib/utils";

const JAEGER_UI_URL =
  import.meta.env.VITE_JAEGER_UI_URL ?? "http://localhost:16686";

export function TraceViewer() {
  const [metrics, setMetrics] = useState<ApiMetrics[]>([]);
  const [traceIdInput, setTraceIdInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refreshMetrics = () => {
    setMetrics(getMetrics().filter((m) => m.traceId));
  };

  useEffect(() => {
    // Initial load - use setTimeout to avoid synchronous setState
    const timeoutId = setTimeout(() => {
      refreshMetrics();
    }, 0);
    const interval = setInterval(refreshMetrics, 2000);
    return () => {
      clearTimeout(timeoutId);
      clearInterval(interval);
    };
  }, []);

  const handleCopy = async (traceId: string) => {
    await navigator.clipboard.writeText(traceId);
    setCopiedId(traceId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getJaegerLink = (traceId: string) => {
    return `${JAEGER_UI_URL}/trace/${traceId}`;
  };

  const openJaegerSearch = () => {
    if (traceIdInput.trim()) {
      window.open(getJaegerLink(traceIdInput.trim()), "_blank");
    }
  };

  // Get unique traces (most recent per trace ID)
  const uniqueTraces = metrics
    .reduce((acc, metric) => {
      if (metric.traceId && !acc.find((m) => m.traceId === metric.traceId)) {
        acc.push(metric);
      }
      return acc;
    }, [] as ApiMetrics[])
    .slice(0, 10);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Network className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Trace Viewer</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={refreshMetrics}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <a href={JAEGER_UI_URL} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4 mr-1" />
                Jaeger UI
              </Button>
            </a>
          </div>
        </div>
        <CardDescription>
          View distributed traces and correlate with Jaeger
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Trace ID Search */}
        <div className="flex gap-2">
          <Input
            placeholder="Enter trace ID to view in Jaeger..."
            value={traceIdInput}
            onChange={(e) => setTraceIdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && openJaegerSearch()}
            className="font-mono text-sm"
          />
          <Button onClick={openJaegerSearch} disabled={!traceIdInput.trim()}>
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>

        {/* Recent Traces */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Recent Traces ({uniqueTraces.length})
          </h4>

          {uniqueTraces.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Network className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No traces captured yet</p>
              <p className="text-xs mt-1">
                Make API requests to see traces here
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[250px] overflow-y-auto">
              {uniqueTraces.map((metric, idx) => (
                <div
                  key={`${metric.traceId}-${idx}`}
                  className={cn(
                    "p-3 rounded-lg border border-border bg-card/50 space-y-2",
                    metric.success && "border-l-4 border-l-success",
                    !metric.success && "border-l-4 border-l-destructive",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={metric.success ? "success" : "destructive"}
                        className="text-xs"
                      >
                        {metric.status || "ERR"}
                      </Badge>
                      <span className="text-sm font-medium">
                        {metric.method} {metric.endpoint}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {metric.duration.toFixed(0)}ms
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <code className="text-xs font-mono text-muted-foreground truncate flex-1">
                      {metric.traceId}
                    </code>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleCopy(metric.traceId!)}
                      >
                        {copiedId === metric.traceId ? (
                          <Check className="h-3 w-3 text-success" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                      <a
                        href={getJaegerLink(metric.traceId!)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </a>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {metric.timestamp.toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
