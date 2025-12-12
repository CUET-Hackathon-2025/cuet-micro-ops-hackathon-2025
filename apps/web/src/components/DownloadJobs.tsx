import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Download,
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Wifi,
  WifiOff,
  RotateCcw,
  Plus,
  Trash2,
  PlayCircle,
  Zap,
  Clock,
  Info,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  checkDownload,
  createAsyncDownload,
  subscribeToJobUpdates,
  downloadFileWithProgress,
  type DownloadCheckResponse,
  type AsyncDownloadResponse,
  type SSEUpdate,
  type DownloadProgress,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { addBreadcrumb } from "@/lib/sentry";

// Real-time elapsed time display component
function ElapsedTime({ startTime }: { startTime: Date }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  return <span className="text-warning font-mono ml-2">{elapsed}s</span>;
}

interface DownloadJob {
  id: string;
  fileId: number;
  status:
    | "pending"
    | "checking"
    | "available"
    | "unavailable"
    | "queued"
    | "processing"
    | "completed"
    | "failed"
    | "downloading"; // New status for file download
  progress: number;
  traceId: string | null;
  checkResult?: DownloadCheckResponse;
  asyncResponse?: AsyncDownloadResponse;
  downloadUrl?: string;
  error?: string;
  timestamp: Date;
  startedAt?: Date;
  completedAt?: Date;
  sseConnected: boolean;
  // File download progress (separate from processing progress)
  fileDownloadProgress?: DownloadProgress;
}

export function DownloadJobs() {
  const [fileIdInput, setFileIdInput] = useState("");
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [cleanupFunctions, setCleanupFunctions] = useState<
    Map<string, () => void>
  >(new Map());

  // Cleanup SSE connections on unmount
  useEffect(() => {
    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup());
    };
  }, [cleanupFunctions]);

  const updateJob = useCallback(
    (jobId: string, updates: Partial<DownloadJob>) => {
      setJobs((prev) =>
        prev.map((job) => (job.id === jobId ? { ...job, ...updates } : job)),
      );
    },
    [],
  );

  const subscribeToJob = useCallback(
    (job: DownloadJob) => {
      if (!job.asyncResponse) return;

      const cleanup = subscribeToJobUpdates(job.asyncResponse.jobId, {
        onStatus: (data: SSEUpdate) => {
          updateJob(job.id, {
            status: (data.status as DownloadJob["status"]) ?? job.status,
            progress: data.progress ?? job.progress,
            sseConnected: true,
          });
        },
        onProgress: (data: SSEUpdate) => {
          updateJob(job.id, {
            progress: data.progress ?? job.progress,
            status: "processing",
          });
        },
        onComplete: (data: SSEUpdate) => {
          updateJob(job.id, {
            status: "completed",
            progress: 100,
            downloadUrl: data.downloadUrl,
            completedAt: new Date(),
            sseConnected: false,
          });
          // Remove cleanup function
          setCleanupFunctions((prev) => {
            const next = new Map(prev);
            next.delete(job.id);
            return next;
          });
        },
        onError: (data: SSEUpdate) => {
          updateJob(job.id, {
            status: "failed",
            error: data.error,
            sseConnected: false,
          });
          // Remove cleanup function
          setCleanupFunctions((prev) => {
            const next = new Map(prev);
            next.delete(job.id);
            return next;
          });
        },
        onHeartbeat: () => {
          updateJob(job.id, { sseConnected: true });
        },
        onConnectionError: () => {
          updateJob(job.id, { sseConnected: false });
        },
      });

      // Store cleanup function
      setCleanupFunctions((prev) => {
        const next = new Map(prev);
        next.set(job.id, cleanup);
        return next;
      });

      updateJob(job.id, { sseConnected: true });
    },
    [updateJob],
  );

  const checkMutation = useMutation({
    mutationFn: (fileId: number) => checkDownload(fileId),
    onMutate: (fileId) => {
      addBreadcrumb("Download check started", "user_action", { fileId });
      const jobId = crypto.randomUUID();
      const newJob: DownloadJob = {
        id: jobId,
        fileId,
        status: "checking",
        progress: 0,
        traceId: null,
        timestamp: new Date(),
        sseConnected: false,
      };
      setJobs((prev) => [newJob, ...prev]);
      return { jobId };
    },
    onSuccess: (result, _, context) => {
      setJobs((prev) =>
        prev.map((job) =>
          job.id === context?.jobId
            ? {
                ...job,
                status: result.data.available ? "available" : "unavailable",
                traceId: result.traceId,
                checkResult: result.data,
              }
            : job,
        ),
      );
    },
    onError: (_error, _, context) => {
      setJobs((prev) =>
        prev.map((job) =>
          job.id === context?.jobId
            ? { ...job, status: "failed", error: "Check failed" }
            : job,
        ),
      );
    },
  });

  const startAsyncMutation = useMutation({
    mutationFn: ({ fileId }: { jobId: string; fileId: number }) =>
      createAsyncDownload(fileId, crypto.randomUUID()),
    onMutate: ({ jobId }) => {
      updateJob(jobId, {
        status: "queued",
        progress: 0,
        startedAt: new Date(),
      });
    },
    onSuccess: (result, { jobId }) => {
      const updatedJob: Partial<DownloadJob> = {
        status: result.data.status === "queued" ? "queued" : "processing",
        asyncResponse: result.data,
        traceId: result.traceId,
      };
      updateJob(jobId, updatedJob);

      // Get the job and subscribe to SSE
      setJobs((prev) => {
        const job = prev.find((j) => j.id === jobId);
        if (job) {
          const updatedJobForSubscribe = { ...job, ...updatedJob };
          // Use setTimeout to avoid state update during render
          setTimeout(() => subscribeToJob(updatedJobForSubscribe), 0);
        }
        return prev;
      });
    },
    onError: (_error, { jobId }) => {
      updateJob(jobId, { status: "failed", error: "Failed to start download" });
    },
  });

  const triggerSentryMutation = useMutation({
    mutationFn: () => checkDownload(70000, true),
    onMutate: () => {
      addBreadcrumb("Sentry test triggered", "user_action", { fileId: 70000 });
    },
  });

  const handleStartDownload = (jobId: string, fileId: number) => {
    addBreadcrumb("Async download started", "user_action", { jobId, fileId });
    startAsyncMutation.mutate({ jobId, fileId });
  };

  // Retry failed download
  const handleRetry = (job: DownloadJob) => {
    addBreadcrumb("Download retry", "user_action", {
      jobId: job.id,
      fileId: job.fileId,
    });
    // Reset job status and start again
    updateJob(job.id, {
      status: "pending",
      progress: 0,
      error: undefined,
      downloadUrl: undefined,
      asyncResponse: undefined,
    });
    // Re-check availability first
    checkMutation.mutate(job.fileId);
  };

  // Add multiple files at once
  const handleAddMultipleFiles = () => {
    const input = fileIdInput.trim();
    // Support comma-separated or space-separated file IDs
    const fileIds = input
      .split(/[,\s]+/)
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id) && id >= 10000 && id <= 100000000);

    if (fileIds.length === 0) return;

    // Add all files and check them
    fileIds.forEach((fileId) => {
      checkMutation.mutate(fileId);
    });
    setFileIdInput("");
  };

  // Start all available downloads
  const handleStartAllAvailable = () => {
    const availableJobs = jobs.filter((job) => job.status === "available");
    addBreadcrumb("Bulk download started", "user_action", {
      count: availableJobs.length,
    });
    availableJobs.forEach((job) => {
      handleStartDownload(job.id, job.fileId);
    });
  };

  // Clear completed/failed jobs
  const handleClearFinished = () => {
    setJobs((prev) =>
      prev.filter(
        (job) =>
          job.status !== "completed" &&
          job.status !== "failed" &&
          job.status !== "unavailable",
      ),
    );
  };

  // Download file with progress tracking
  const handleFileDownload = async (job: DownloadJob) => {
    if (!job.downloadUrl) return;

    addBreadcrumb("File download started", "user_action", {
      jobId: job.id,
      fileId: job.fileId,
    });

    updateJob(job.id, {
      status: "downloading",
      fileDownloadProgress: { loaded: 0, total: 0, percentage: 0 },
    });

    try {
      await downloadFileWithProgress(
        job.downloadUrl,
        `file-${job.fileId}.bin`,
        (progress) => {
          updateJob(job.id, { fileDownloadProgress: progress });
        },
      );

      // Reset to completed after download
      updateJob(job.id, {
        status: "completed",
        fileDownloadProgress: { loaded: 100, total: 100, percentage: 100 },
      });

      addBreadcrumb("File download completed", "user_action", {
        jobId: job.id,
        fileId: job.fileId,
      });
    } catch (error) {
      updateJob(job.id, {
        status: "failed",
        error: "File download failed",
        fileDownloadProgress: undefined,
      });
    }
  };

  const availableCount = jobs.filter((j) => j.status === "available").length;
  const processingCount = jobs.filter(
    (j) => j.status === "processing" || j.status === "queued",
  ).length;
  const completedCount = jobs.filter((j) => j.status === "completed").length;
  const failedCount = jobs.filter((j) => j.status === "failed").length;

  const getStatusBadge = (job: DownloadJob) => {
    const statusConfig: Record<
      DownloadJob["status"],
      {
        variant:
          | "default"
          | "secondary"
          | "destructive"
          | "outline"
          | "success"
          | "warning";
        icon: React.ReactNode;
        label: string;
      }
    > = {
      pending: { variant: "secondary", icon: null, label: "PENDING" },
      checking: {
        variant: "secondary",
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        label: "CHECKING",
      },
      available: {
        variant: "success",
        icon: <CheckCircle className="h-3 w-3" />,
        label: "AVAILABLE",
      },
      unavailable: {
        variant: "warning",
        icon: <AlertTriangle className="h-3 w-3" />,
        label: "UNAVAILABLE",
      },
      queued: {
        variant: "secondary",
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        label: "QUEUED",
      },
      processing: {
        variant: "default",
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        label: `${job.progress}%`,
      },
      completed: {
        variant: "success",
        icon: <CheckCircle className="h-3 w-3" />,
        label: "COMPLETED",
      },
      downloading: {
        variant: "default",
        icon: <Download className="h-3 w-3 animate-pulse" />,
        label: `${job.fileDownloadProgress?.percentage ?? 0}%`,
      },
      failed: {
        variant: "destructive",
        icon: <XCircle className="h-3 w-3" />,
        label: "FAILED",
      },
    };
    const { variant, icon, label } = statusConfig[job.status];
    return (
      <Badge variant={variant} className="gap-1">
        {icon}
        {label}
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Download Jobs</CardTitle>
        </div>
        <CardDescription>
          Initiate and track file downloads with real-time progress
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Problem Statement Banner */}
        <div className="p-4 rounded-lg bg-gradient-to-r from-warning/10 via-warning/5 to-transparent border border-warning/30">
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 text-warning mt-0.5 flex-shrink-0" />
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">
                The Problem: Long-Running Downloads
              </h4>
              <p className="text-xs text-muted-foreground">
                Downloads take{" "}
                <span className="text-warning font-mono">10-120 seconds</span>{" "}
                but HTTP requests timeout at 30s. Traditional sync requests will
                fail!
              </p>
              <div className="flex items-center gap-2 mt-2">
                <Zap className="h-4 w-4 text-success" />
                <span className="text-xs text-success font-medium">
                  Solution: Async downloads with real-time SSE progress updates
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Demo Section */}
        <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Quick Demo</span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setFileIdInput("70000");
                  setTimeout(() => handleAddMultipleFiles(), 100);
                }}
                disabled={checkMutation.isPending}
              >
                Single File
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setFileIdInput("70001, 70002, 70003, 70004, 70005");
                  setTimeout(() => handleAddMultipleFiles(), 100);
                }}
                disabled={checkMutation.isPending}
              >
                Bulk (5 files)
              </Button>
            </div>
          </div>
        </div>

        {/* Input Section */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="File ID(s) - e.g., 70000 or 70000, 70001, 70002"
              value={fileIdInput}
              onChange={(e) => setFileIdInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddMultipleFiles()}
              className="flex-1"
            />
            <Button
              onClick={handleAddMultipleFiles}
              disabled={checkMutation.isPending || !fileIdInput}
            >
              {checkMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Enter single ID or multiple IDs separated by commas
            (10000-100000000)
          </p>
        </div>

        {/* Bulk Actions */}
        {jobs.length > 0 && (
          <div className="flex flex-wrap gap-2 p-3 rounded-lg bg-secondary/30 border border-border">
            <Button
              size="sm"
              onClick={handleStartAllAvailable}
              disabled={availableCount === 0 || startAsyncMutation.isPending}
            >
              <PlayCircle className="h-4 w-4 mr-1" />
              Start All ({availableCount})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleClearFinished}
              disabled={completedCount + failedCount === 0}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Clear Finished
            </Button>
            <div className="flex-1" />
            <div className="flex items-center gap-3 text-xs">
              {processingCount > 0 && (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  {processingCount} processing
                </span>
              )}
              {completedCount > 0 && (
                <span className="flex items-center gap-1 text-success">
                  <CheckCircle className="h-3 w-3" />
                  {completedCount} completed
                </span>
              )}
              {failedCount > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <XCircle className="h-3 w-3" />
                  {failedCount} failed
                </span>
              )}
            </div>
          </div>
        )}

        {/* Sentry Test Button */}
        <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <span className="text-sm text-muted-foreground flex-1">
            Test Sentry error tracking
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerSentryMutation.mutate()}
            disabled={triggerSentryMutation.isPending}
          >
            {triggerSentryMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Trigger Error"
            )}
          </Button>
        </div>

        {/* Jobs List */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Recent Jobs ({jobs.length})
          </h4>

          {jobs.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No download jobs yet. Enter a file ID to check availability.
            </p>
          )}

          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {jobs.map((job) => (
              <div
                key={job.id}
                className={cn(
                  "p-3 rounded-lg border border-border bg-card/50 space-y-2",
                  job.status === "completed" && "border-success/30",
                  job.status === "failed" && "border-destructive/30",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">ID: {job.fileId}</span>
                    {getStatusBadge(job)}
                    {job.sseConnected && (
                      <span title="Real-time connected">
                        <Wifi className="h-3 w-3 text-success" />
                      </span>
                    )}
                    {job.asyncResponse &&
                      !job.sseConnected &&
                      job.status !== "completed" &&
                      job.status !== "failed" && (
                        <span title="Reconnecting...">
                          <WifiOff className="h-3 w-3 text-muted-foreground" />
                        </span>
                      )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {job.timestamp.toLocaleTimeString()}
                  </span>
                </div>

                {/* Progress Bar */}
                {(job.status === "processing" || job.status === "queued") && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {job.status === "queued"
                          ? "Waiting in queue..."
                          : "Downloading..."}
                        {job.startedAt && (
                          <ElapsedTime startTime={job.startedAt} />
                        )}
                      </span>
                      <span className="font-mono">{job.progress}%</span>
                    </div>
                    <div className="h-3 bg-secondary rounded-full overflow-hidden relative">
                      <div
                        className={cn(
                          "h-full transition-all duration-500 ease-out rounded-full",
                          job.status === "queued"
                            ? "bg-secondary-foreground/30 animate-pulse"
                            : "bg-gradient-to-r from-primary via-primary/80 to-primary",
                        )}
                        style={{
                          width: `${Math.max(job.progress, job.status === "queued" ? 5 : 0)}%`,
                        }}
                      />
                      {job.status === "processing" &&
                        job.progress > 0 &&
                        job.progress < 100 && (
                          <div
                            className="absolute top-0 h-full w-8 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"
                            style={{ left: `${job.progress - 10}%` }}
                          />
                        )}
                    </div>
                  </div>
                )}

                {/* Completed Progress Bar */}
                {job.status === "completed" && !job.fileDownloadProgress && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-success">
                      <span>
                        Processing complete! Ready to download.
                        {job.startedAt && job.completedAt && (
                          <span className="text-muted-foreground ml-2">
                            (took{" "}
                            {(
                              (job.completedAt.getTime() -
                                job.startedAt.getTime()) /
                              1000
                            ).toFixed(1)}
                            s)
                          </span>
                        )}
                      </span>
                      <span className="font-mono">100%</span>
                    </div>
                    <div className="h-3 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full w-full bg-gradient-to-r from-success to-success/80 rounded-full" />
                    </div>
                  </div>
                )}

                {/* File Download Progress Bar */}
                {job.status === "downloading" && job.fileDownloadProgress && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-primary">
                      <span className="flex items-center gap-1">
                        <Download className="h-3 w-3 animate-bounce" />
                        Downloading file to your device...
                      </span>
                      <span className="font-mono">
                        {job.fileDownloadProgress.percentage}%
                        {job.fileDownloadProgress.total > 0 && (
                          <span className="text-muted-foreground ml-1">
                            (
                            {(
                              job.fileDownloadProgress.loaded /
                              1024 /
                              1024
                            ).toFixed(1)}
                            /
                            {(
                              job.fileDownloadProgress.total /
                              1024 /
                              1024
                            ).toFixed(1)}{" "}
                            MB)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-3 bg-secondary rounded-full overflow-hidden relative">
                      <div
                        className="h-full bg-gradient-to-r from-accent via-accent/80 to-accent transition-all duration-300 ease-out rounded-full"
                        style={{
                          width: `${job.fileDownloadProgress.percentage}%`,
                        }}
                      />
                      <div
                        className="absolute top-0 h-full w-8 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"
                        style={{
                          left: `${job.fileDownloadProgress.percentage - 10}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Downloaded Successfully */}
                {job.status === "completed" &&
                  job.fileDownloadProgress?.percentage === 100 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-success">
                        <span className="flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          File saved to your downloads!
                        </span>
                        <span className="font-mono">✓</span>
                      </div>
                      <div className="h-3 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full w-full bg-gradient-to-r from-success to-success/80 rounded-full" />
                      </div>
                    </div>
                  )}

                {job.checkResult && (
                  <div className="text-xs text-muted-foreground">
                    {job.checkResult.available ? (
                      <span>
                        Size:{" "}
                        {job.checkResult.size
                          ? `${(job.checkResult.size / 1024 / 1024).toFixed(2)} MB`
                          : "Unknown"}
                      </span>
                    ) : (
                      <span>File not available in storage</span>
                    )}
                  </div>
                )}

                {job.error && (
                  <div className="text-xs text-destructive">
                    Error: {job.error}
                  </div>
                )}

                {job.traceId && (
                  <div className="text-xs text-muted-foreground font-mono">
                    Trace: {job.traceId.slice(0, 16)}...
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2">
                  {job.status === "available" && (
                    <Button
                      size="sm"
                      onClick={() => handleStartDownload(job.id, job.fileId)}
                      disabled={startAsyncMutation.isPending}
                    >
                      <Play className="h-3 w-3 mr-1" />
                      Start Download
                    </Button>
                  )}

                  {job.status === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRetry(job)}
                      disabled={checkMutation.isPending}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Retry
                    </Button>
                  )}

                  {job.status === "completed" &&
                    job.downloadUrl &&
                    !job.fileDownloadProgress && (
                      <Button
                        size="sm"
                        variant="success"
                        onClick={() => handleFileDownload(job)}
                      >
                        <Download className="h-3 w-3 mr-1" />
                        Download File
                      </Button>
                    )}

                  {job.status === "downloading" && (
                    <Button size="sm" variant="outline" disabled>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Downloading...
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
