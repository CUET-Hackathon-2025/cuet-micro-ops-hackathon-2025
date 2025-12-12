import { useQuery } from "@tanstack/react-query"
import { Activity, Database, CheckCircle, XCircle, RefreshCw } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { checkHealth } from "@/lib/api"
import { cn } from "@/lib/utils"

export function HealthStatus() {
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["health"],
    queryFn: checkHealth,
    refetchInterval: 10000, // Poll every 10 seconds
    retry: 1,
  })

  const health = data?.data
  const traceId = data?.traceId
  const isHealthy = health?.status === "healthy"
  const storageOk = health?.checks.storage === "ok"

  return (
    <Card className={cn(
      "border-l-4 transition-colors",
      isLoading && "border-l-muted",
      isHealthy && "border-l-success",
      !isHealthy && !isLoading && "border-l-destructive"
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">API Health</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
        </div>
        <CardDescription>
          Real-time health status from /health endpoint
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && !health && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Checking health...</span>
          </div>
        )}

        {isError && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="h-4 w-4" />
              <span className="font-medium">Connection Error</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Failed to connect to API"}
            </p>
          </div>
        )}

        {health && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {isHealthy ? (
                <CheckCircle className="h-6 w-6 text-success" />
              ) : (
                <XCircle className="h-6 w-6 text-destructive" />
              )}
              <Badge variant={isHealthy ? "success" : "destructive"} className="text-sm">
                {health.status.toUpperCase()}
              </Badge>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Service Checks</h4>
              <div className="flex items-center gap-2 pl-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Storage:</span>
                <Badge variant={storageOk ? "success" : "destructive"} className="text-xs">
                  {health.checks.storage.toUpperCase()}
                </Badge>
              </div>
            </div>

            {traceId && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Trace ID: <code className="text-primary font-mono">{traceId.slice(0, 16)}...</code>
                </p>
              </div>
            )}

            {dataUpdatedAt && (
              <p className="text-xs text-muted-foreground">
                Last checked: {new Date(dataUpdatedAt).toLocaleTimeString()}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

