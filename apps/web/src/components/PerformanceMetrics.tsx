import { useState, useEffect, useMemo } from "react";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMetrics, clearMetrics, type ApiMetrics } from "@/lib/api";
import { cn } from "@/lib/utils";

interface MetricsSummary {
  totalRequests: number;
  successRate: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  requestsPerEndpoint: Record<
    string,
    { count: number; success: number; avgTime: number }
  >;
}

function calculateSummary(metrics: ApiMetrics[]): MetricsSummary {
  if (metrics.length === 0) {
    return {
      totalRequests: 0,
      successRate: 0,
      avgResponseTime: 0,
      p95ResponseTime: 0,
      minResponseTime: 0,
      maxResponseTime: 0,
      requestsPerEndpoint: {},
    };
  }

  const successful = metrics.filter((m) => m.success).length;
  const durations = metrics.map((m) => m.duration).sort((a, b) => a - b);
  const avgTime = durations.reduce((a, b) => a + b, 0) / durations.length;
  const p95Index = Math.floor(durations.length * 0.95);

  const byEndpoint: Record<
    string,
    { count: number; success: number; totalTime: number }
  > = {};
  metrics.forEach((m) => {
    if (!byEndpoint[m.endpoint]) {
      byEndpoint[m.endpoint] = { count: 0, success: 0, totalTime: 0 };
    }
    byEndpoint[m.endpoint].count++;
    if (m.success) byEndpoint[m.endpoint].success++;
    byEndpoint[m.endpoint].totalTime += m.duration;
  });

  const requestsPerEndpoint: Record<
    string,
    { count: number; success: number; avgTime: number }
  > = {};
  Object.entries(byEndpoint).forEach(([endpoint, data]) => {
    requestsPerEndpoint[endpoint] = {
      count: data.count,
      success: data.success,
      avgTime: data.totalTime / data.count,
    };
  });

  return {
    totalRequests: metrics.length,
    successRate: (successful / metrics.length) * 100,
    avgResponseTime: avgTime,
    p95ResponseTime: durations[p95Index] ?? durations[durations.length - 1],
    minResponseTime: durations[0],
    maxResponseTime: durations[durations.length - 1],
    requestsPerEndpoint,
  };
}

export function PerformanceMetrics() {
  const [metrics, setMetrics] = useState<ApiMetrics[]>([]);

  const refreshMetrics = () => {
    setMetrics(getMetrics());
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

  const summary = useMemo(() => calculateSummary(metrics), [metrics]);

  const handleClear = () => {
    clearMetrics();
    setMetrics([]);
  };

  // Simple bar chart using CSS
  const maxAvgTime = Math.max(
    ...Object.values(summary.requestsPerEndpoint).map((e) => e.avgTime),
    1,
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Performance Metrics</CardTitle>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={refreshMetrics}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClear}
              disabled={metrics.length === 0}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardDescription>API response times and success rates</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-secondary/50 border border-border">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              <span className="text-xs">Total Requests</span>
            </div>
            <p className="text-2xl font-bold">{summary.totalRequests}</p>
          </div>

          <div className="p-3 rounded-lg bg-secondary/50 border border-border">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              {summary.successRate >= 90 ? (
                <TrendingUp className="h-4 w-4 text-success" />
              ) : (
                <TrendingDown className="h-4 w-4 text-destructive" />
              )}
              <span className="text-xs">Success Rate</span>
            </div>
            <p
              className={cn(
                "text-2xl font-bold",
                summary.successRate >= 90 ? "text-success" : "text-destructive",
              )}
            >
              {summary.successRate.toFixed(1)}%
            </p>
          </div>

          <div className="p-3 rounded-lg bg-secondary/50 border border-border">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              <span className="text-xs">Avg Response</span>
            </div>
            <p className="text-2xl font-bold">
              {summary.avgResponseTime.toFixed(0)}ms
            </p>
          </div>

          <div className="p-3 rounded-lg bg-secondary/50 border border-border">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              <span className="text-xs">P95 Response</span>
            </div>
            <p className="text-2xl font-bold">
              {summary.p95ResponseTime.toFixed(0)}ms
            </p>
          </div>
        </div>

        {/* Response Time Range */}
        {metrics.length > 0 && (
          <div className="p-3 rounded-lg bg-secondary/30 border border-border">
            <p className="text-xs text-muted-foreground mb-2">
              Response Time Range
            </p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-success">
                {summary.minResponseTime.toFixed(0)}ms
              </span>
              <div className="flex-1 mx-4 h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-success via-warning to-destructive"
                  style={{ width: "100%" }}
                />
              </div>
              <span className="text-destructive">
                {summary.maxResponseTime.toFixed(0)}ms
              </span>
            </div>
          </div>
        )}

        {/* Per-Endpoint Stats */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            By Endpoint
          </h4>

          {Object.keys(summary.requestsPerEndpoint).length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No metrics yet</p>
              <p className="text-xs mt-1">
                Make API requests to see performance data
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(summary.requestsPerEndpoint).map(
                ([endpoint, data]) => {
                  const successRate = (data.success / data.count) * 100;
                  return (
                    <div
                      key={endpoint}
                      className="p-2 rounded-lg border border-border bg-card/50"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <code className="text-xs font-mono truncate flex-1">
                          {endpoint}
                        </code>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {data.count} req
                          </Badge>
                          <Badge
                            variant={
                              successRate >= 90 ? "success" : "destructive"
                            }
                            className="text-xs gap-1"
                          >
                            {successRate >= 90 ? (
                              <CheckCircle className="h-3 w-3" />
                            ) : (
                              <XCircle className="h-3 w-3" />
                            )}
                            {successRate.toFixed(0)}%
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all duration-300"
                            style={{
                              width: `${(data.avgTime / maxAvgTime) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-16 text-right">
                          {data.avgTime.toFixed(0)}ms
                        </span>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
