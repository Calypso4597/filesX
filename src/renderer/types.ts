export type JobStatus = "idle" | "queued" | "running" | "done" | "error" | "canceled";

export interface FileItem {
  id: string;
  inputPath: string;
  outputPath: string;
  status: JobStatus;
  progress: number | null;
  message?: string;
  error?: string;
  command?: string;
}

export interface JobUpdate {
  id: string;
  status?: JobStatus;
  progress?: number | null;
  outputPath?: string;
  message?: string;
  error?: string;
  command?: string;
}
