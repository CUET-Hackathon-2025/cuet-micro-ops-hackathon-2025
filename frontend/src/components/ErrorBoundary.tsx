import * as Sentry from "@sentry/react";
import { AlertTriangle, RefreshCw, MessageSquare } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { showFeedbackDialog } from "@/lib/sentry";

interface FallbackProps {
  error: unknown;
  componentStack: string | null;
  eventId: string | null;
  resetError: () => void;
}

function ErrorFallback({
  error,
  componentStack,
  eventId,
  resetError,
}: FallbackProps) {
  const errorMessage = error instanceof Error ? error.message : String(error);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-lg w-full border-destructive/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <CardTitle className="text-destructive">
              Something went wrong
            </CardTitle>
          </div>
          <CardDescription>
            An unexpected error occurred. Our team has been notified.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <p className="text-sm font-mono text-destructive">{errorMessage}</p>
          </div>

          {eventId && (
            <p className="text-xs text-muted-foreground">
              Error ID: <code className="text-primary">{eventId}</code>
            </p>
          )}

          {componentStack && import.meta.env.DEV && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Show stack trace
              </summary>
              <pre className="mt-2 p-2 bg-secondary rounded text-xs overflow-x-auto">
                {componentStack}
              </pre>
            </details>
          )}

          <div className="flex gap-2">
            <Button onClick={resetError} className="flex-1">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
            <Button
              variant="outline"
              onClick={() => showFeedbackDialog()}
              className="flex-1"
            >
              <MessageSquare className="h-4 w-4 mr-2" />
              Send Feedback
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export function ErrorBoundary({ children }: ErrorBoundaryProps) {
  return (
    <Sentry.ErrorBoundary
      fallback={({ error, componentStack, eventId, resetError }) => (
        <ErrorFallback
          error={error}
          componentStack={componentStack}
          eventId={eventId}
          resetError={resetError}
        />
      )}
      showDialog
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
