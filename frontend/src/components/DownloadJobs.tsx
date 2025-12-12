import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Download, Play, Search, Loader2, CheckCircle, XCircle, AlertTriangle, ExternalLink } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { checkDownload, startDownload, type DownloadCheckResponse, type DownloadStartResponse } from "@/lib/api"
import { cn } from "@/lib/utils"
import { addBreadcrumb } from "@/lib/sentry"

interface DownloadJob {
  id: string
  fileId: number
  status: "pending" | "checking" | "available" | "unavailable" | "downloading" | "completed" | "failed"
  traceId: string | null
  checkResult?: DownloadCheckResponse
  downloadResult?: DownloadStartResponse
  timestamp: Date
}

export function DownloadJobs() {
  const [fileIdInput, setFileIdInput] = useState("")
  const [jobs, setJobs] = useState<DownloadJob[]>([])

  const checkMutation = useMutation({
    mutationFn: (fileId: number) => checkDownload(fileId),
    onMutate: (fileId) => {
      addBreadcrumb("Download check started", "user_action", { fileId })
      const jobId = crypto.randomUUID()
      const newJob: DownloadJob = {
        id: jobId,
        fileId,
        status: "checking",
        traceId: null,
        timestamp: new Date(),
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
            ? { ...job, status: "failed" }
            : job
        )
      )
    },
  })

  const startMutation = useMutation({
    mutationFn: (params: { jobId: string; fileId: number }) => startDownload(params.fileId),
    onMutate: ({ jobId }) => {
      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId ? { ...job, status: "downloading" } : job
        )
      )
    },
    onSuccess: (result, { jobId }) => {
      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? {
                ...job,
                status: result.data.status === "completed" ? "completed" : "failed",
                downloadResult: result.data,
                traceId: result.traceId,
              }
            : job
        )
      )
    },
    onError: (_, { jobId }) => {
      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId ? { ...job, status: "failed" } : job
        )
      )
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
    addBreadcrumb("Download started", "user_action", { jobId, fileId })
    startMutation.mutate({ jobId, fileId })
  }

  const getStatusBadge = (status: DownloadJob["status"]) => {
    const variants: Record<DownloadJob["status"], { variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning"; icon: React.ReactNode }> = {
      pending: { variant: "secondary", icon: null },
      checking: { variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
      available: { variant: "success", icon: <CheckCircle className="h-3 w-3" /> },
      unavailable: { variant: "warning", icon: <AlertTriangle className="h-3 w-3" /> },
      downloading: { variant: "default", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
      completed: { variant: "success", icon: <CheckCircle className="h-3 w-3" /> },
      failed: { variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
    }
    const { variant, icon } = variants[status]
    return (
      <Badge variant={variant} className="gap-1">
        {icon}
        {status.toUpperCase()}
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
          Initiate and track file downloads
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
                    {getStatusBadge(job.status)}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {job.timestamp.toLocaleTimeString()}
                  </span>
                </div>

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

                {job.downloadResult && (
                  <div className="text-xs space-y-1">
                    <p className="text-muted-foreground">{job.downloadResult.message}</p>
                    {job.downloadResult.downloadUrl && (
                      <a
                        href={job.downloadResult.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline"
                      >
                        Download Link <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
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
                    disabled={startMutation.isPending}
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

