import { useState, useEffect, useCallback } from "react"
import { useMutation } from "@tanstack/react-query"
import { Download, Play, Search, Loader2, CheckCircle, XCircle, AlertTriangle, ExternalLink, Wifi, WifiOff } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { 
  checkDownload, 
  createAsyncDownload,
  subscribeToJobUpdates,
  type DownloadCheckResponse,
  type AsyncDownloadResponse,
  type SSEUpdate,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { addBreadcrumb } from "@/lib/sentry"

interface DownloadJob {
  id: string
  fileId: number
  status: "pending" | "checking" | "available" | "unavailable" | "queued" | "processing" | "completed" | "failed"
  progress: number
  traceId: string | null
  checkResult?: DownloadCheckResponse
  asyncResponse?: AsyncDownloadResponse
  downloadUrl?: string
  error?: string
  timestamp: Date
  sseConnected: boolean
}

export function DownloadJobs() {
  const [fileIdInput, setFileIdInput] = useState("")
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const [cleanupFunctions, setCleanupFunctions] = useState<Map<string, () => void>>(new Map())

  // Cleanup SSE connections on unmount
  useEffect(() => {
    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup())
    }
  }, [cleanupFunctions])

  const updateJob = useCallback((jobId: string, updates: Partial<DownloadJob>) => {
    setJobs((prev) =>
      prev.map((job) =>
        job.id === jobId ? { ...job, ...updates } : job
      )
    )
  }, [])

  const subscribeToJob = useCallback((job: DownloadJob) => {
    if (!job.asyncResponse) return

    const cleanup = subscribeToJobUpdates(job.asyncResponse.jobId, {
      onStatus: (data: SSEUpdate) => {
        updateJob(job.id, {
          status: (data.status as DownloadJob["status"]) ?? job.status,
          progress: data.progress ?? job.progress,
          sseConnected: true,
        })
      },
      onProgress: (data: SSEUpdate) => {
        updateJob(job.id, {
          progress: data.progress ?? job.progress,
          status: "processing",
        })
      },
      onComplete: (data: SSEUpdate) => {
        updateJob(job.id, {
          status: "completed",
          progress: 100,
          downloadUrl: data.downloadUrl,
          sseConnected: false,
        })
        // Remove cleanup function
        setCleanupFunctions((prev) => {
          const next = new Map(prev)
          next.delete(job.id)
          return next
        })
      },
      onError: (data: SSEUpdate) => {
        updateJob(job.id, {
          status: "failed",
          error: data.error,
          sseConnected: false,
        })
        // Remove cleanup function
        setCleanupFunctions((prev) => {
          const next = new Map(prev)
          next.delete(job.id)
          return next
        })
      },
      onHeartbeat: () => {
        updateJob(job.id, { sseConnected: true })
      },
      onConnectionError: () => {
        updateJob(job.id, { sseConnected: false })
      },
    })

    // Store cleanup function
    setCleanupFunctions((prev) => {
      const next = new Map(prev)
      next.set(job.id, cleanup)
      return next
    })

    updateJob(job.id, { sseConnected: true })
  }, [updateJob])

  const checkMutation = useMutation({
    mutationFn: (fileId: number) => checkDownload(fileId),
    onMutate: (fileId) => {
      addBreadcrumb("Download check started", "user_action", { fileId })
      const jobId = crypto.randomUUID()
      const newJob: DownloadJob = {
        id: jobId,
        fileId,
        status: "checking",
        progress: 0,
        traceId: null,
        timestamp: new Date(),
        sseConnected: false,
      }
      setJobs((prev) => [newJob, ...prev])
      return { jobId }
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
            : job
        )
      )
    },
    onError: (_error, _, context) => {
      setJobs((prev) =>
        prev.map((job) =>
          job.id === context?.jobId
            ? { ...job, status: "failed", error: "Check failed" }
            : job
        )
      )
    },
  })

  const startAsyncMutation = useMutation({
    mutationFn: ({ fileId }: { jobId: string; fileId: number }) => 
      createAsyncDownload(fileId, crypto.randomUUID()),
    onMutate: ({ jobId }) => {
      updateJob(jobId, { status: "queued", progress: 0 })
    },
    onSuccess: (result, { jobId }) => {
      const updatedJob: Partial<DownloadJob> = {
        status: result.data.status === "queued" ? "queued" : "processing",
        asyncResponse: result.data,
        traceId: result.traceId,
      }
      updateJob(jobId, updatedJob)
      
      // Get the job and subscribe to SSE
      setJobs((prev) => {
        const job = prev.find((j) => j.id === jobId)
        if (job) {
          const updatedJobForSubscribe = { ...job, ...updatedJob }
          // Use setTimeout to avoid state update during render
          setTimeout(() => subscribeToJob(updatedJobForSubscribe), 0)
        }
        return prev
      })
    },
    onError: (_error, { jobId }) => {
      updateJob(jobId, { status: "failed", error: "Failed to start download" })
    },
  })

  const triggerSentryMutation = useMutation({
    mutationFn: () => checkDownload(70000, true),
    onMutate: () => {
      addBreadcrumb("Sentry test triggered", "user_action", { fileId: 70000 })
    },
  })

  const handleCheck = () => {
    const fileId = parseInt(fileIdInput, 10)
    if (isNaN(fileId) || fileId < 10000 || fileId > 100000000) {
      return
    }
    checkMutation.mutate(fileId)
    setFileIdInput("")
  }

  const handleStartDownload = (jobId: string, fileId: number) => {
    addBreadcrumb("Async download started", "user_action", { jobId, fileId })
    startAsyncMutation.mutate({ jobId, fileId })
  }

  const getStatusBadge = (job: DownloadJob) => {
    const statusConfig: Record<DownloadJob["status"], { variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning"; icon: React.ReactNode; label: string }> = {
      pending: { variant: "secondary", icon: null, label: "PENDING" },
      checking: { variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" />, label: "CHECKING" },
      available: { variant: "success", icon: <CheckCircle className="h-3 w-3" />, label: "AVAILABLE" },
      unavailable: { variant: "warning", icon: <AlertTriangle className="h-3 w-3" />, label: "UNAVAILABLE" },
      queued: { variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" />, label: "QUEUED" },
      processing: { variant: "default", icon: <Loader2 className="h-3 w-3 animate-spin" />, label: `${job.progress}%` },
      completed: { variant: "success", icon: <CheckCircle className="h-3 w-3" />, label: "COMPLETED" },
      failed: { variant: "destructive", icon: <XCircle className="h-3 w-3" />, label: "FAILED" },
    }
    const { variant, icon, label } = statusConfig[job.status]
    return (
      <Badge variant={variant} className="gap-1">
        {icon}
        {label}
      </Badge>
    )
  }

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
        {/* Input Section */}
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="File ID (10000-100000000)"
            value={fileIdInput}
            onChange={(e) => setFileIdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCheck()}
            min={10000}
            max={100000000}
            className="flex-1"
          />
          <Button
            onClick={handleCheck}
            disabled={checkMutation.isPending || !fileIdInput}
          >
            {checkMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Check
          </Button>
        </div>

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
                  job.status === "failed" && "border-destructive/30"
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
                    {job.asyncResponse && !job.sseConnected && job.status !== "completed" && job.status !== "failed" && (
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
                      <span>Progress</span>
                      <span>{job.progress}%</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300 ease-out"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {job.checkResult && (
                  <div className="text-xs text-muted-foreground">
                    {job.checkResult.available ? (
                      <span>
                        Size: {job.checkResult.size ? `${(job.checkResult.size / 1024 / 1024).toFixed(2)} MB` : "Unknown"}
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

                {job.downloadUrl && (
                  <a
                    href={job.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Download File <ExternalLink className="h-3 w-3" />
                  </a>
                )}

                {job.traceId && (
                  <div className="text-xs text-muted-foreground font-mono">
                    Trace: {job.traceId.slice(0, 16)}...
                  </div>
                )}

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
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
