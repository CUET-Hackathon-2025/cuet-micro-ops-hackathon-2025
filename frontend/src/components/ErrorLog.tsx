import { useState, useEffect } from "react";
import { AlertCircle, Trash2, RefreshCw, ExternalLink } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getErrorLog, clearErrorLog, type ErrorLogEntry } from "@/lib/api";

const JAEGER_UI_URL =
  import.meta.env.VITE_JAEGER_UI_URL ?? "http://localhost:16686";

export function ErrorLog() {
  const [errors, setErrors] = useState<ErrorLogEntry[]>([]);

  const refreshErrors = () => {
    setErrors(getErrorLog());
  };

  useEffect(() => {
    refreshErrors();
    const interval = setInterval(refreshErrors, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleClear = () => {
    clearErrorLog();
    setErrors([]);
  };

  const getJaegerLink = (traceId: string) => {
    return `${JAEGER_UI_URL}/trace/${traceId}`;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <CardTitle className="text-lg">Error Log</CardTitle>
            {errors.length > 0 && (
              <Badge variant="destructive" className="text-xs">
                {errors.length}
              </Badge>
            )}
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={refreshErrors}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClear}
              disabled={errors.length === 0}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardDescription>Recent errors captured by Sentry</CardDescription>
      </CardHeader>
      <CardContent>
        {errors.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No errors captured yet</p>
            <p className="text-xs mt-1">
              Errors will appear here when they occur
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {errors.map((error) => (
              <div
                key={error.id}
                className="p-3 rounded-lg border border-destructive/20 bg-destructive/5 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-destructive truncate">
                      {error.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground font-mono">
                        {error.endpoint}
                      </span>
                      {error.status && (
                        <Badge variant="outline" className="text-xs">
                          {error.status}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {error.timestamp.toLocaleTimeString()}
                  </span>
                </div>

                {error.traceId && (
                  <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <code className="text-xs font-mono text-muted-foreground">
                      {error.traceId.slice(0, 16)}...
                    </code>
                    <a
                      href={getJaegerLink(error.traceId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      View in Jaeger <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
