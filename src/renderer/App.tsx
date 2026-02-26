import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FilePlus2,
  Folder,
  FolderOpen,
  LocateFixed,
  Play,
  RefreshCw,
  RotateCcw,
  TerminalSquare,
  Trash2,
  XCircle
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { FileItem, JobUpdate } from "./types";

const PRESETS = [
  {
    id: "mp4-h264-vtb",
    label: "MP4 (H.264 VideoToolbox + AAC)",
    ext: "mp4",
    requiredEncoders: ["h264_videotoolbox", "aac"],
    args: ["-c:v", "h264_videotoolbox", "-b:v", "5M", "-c:a", "aac", "-b:a", "160k"]
  },
  {
    id: "mp4-hevc-vtb",
    label: "MP4 (HEVC VideoToolbox + AAC)",
    ext: "mp4",
    requiredEncoders: ["hevc_videotoolbox", "aac"],
    args: ["-c:v", "hevc_videotoolbox", "-b:v", "4M", "-tag:v", "hvc1", "-c:a", "aac", "-b:a", "160k"]
  },
  {
    id: "m4a-aac",
    label: "M4A (AAC 256 kbps)",
    ext: "m4a",
    requiredEncoders: ["aac"],
    args: ["-vn", "-c:a", "aac", "-b:a", "256k"]
  },
  {
    id: "wav",
    label: "WAV (PCM 48kHz)",
    ext: "wav",
    requiredEncoders: ["pcm_s16le"],
    args: ["-vn", "-c:a", "pcm_s16le", "-ar", "48000"]
  }
];

type Preset = (typeof PRESETS)[number];

function splitArgs(input: string) {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) args.push(current);
  return args;
}

function getFileName(filePath: string) {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
}

function getDir(filePath: string) {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
}

function joinPath(dir: string, file: string) {
  if (!dir) return file;
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${file}` : `${dir}${sep}${file}`;
}

function buildOutputPath(inputPath: string, outputDir: string, template: string, ext: string) {
  const fileName = getFileName(inputPath);
  const dotIndex = fileName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const resolvedDir = outputDir || getDir(inputPath);
  const rendered = template.replaceAll("{name}", baseName).replaceAll("{ext}", ext);
  return joinPath(resolvedDir, rendered);
}

function statusLabel(status: FileItem["status"]) {
  switch (status) {
    case "idle":
      return "Ready";
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "done":
      return "Done";
    case "error":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return status;
  }
}

function statusVariant(status: FileItem["status"]) {
  switch (status) {
    case "done":
      return "default" as const;
    case "error":
      return "destructive" as const;
    case "running":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export default function App() {
  const [ffmpegInfo, setFfmpegInfo] = useState<any>(null);
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [outputDir, setOutputDir] = useState("");
  const [nameTemplate, setNameTemplate] = useState("{name}.{ext}");
  const [extraArgs, setExtraArgs] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [showCommand, setShowCommand] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [encoders, setEncoders] = useState<Set<string>>(new Set());

  const availablePresets = useMemo(() => {
    if (!encoders.size) return PRESETS;
    return PRESETS.filter((item) => item.requiredEncoders.every((enc) => encoders.has(enc)));
  }, [encoders]);

  const preset = useMemo<Preset | undefined>(
    () => availablePresets.find((item) => item.id === presetId) ?? availablePresets[0],
    [availablePresets, presetId]
  );

  useEffect(() => {
    window.api.checkFfmpeg().then(setFfmpegInfo);
  }, []);

  useEffect(() => {
    if (!ffmpegInfo?.ok) return;
    window.api.getEncoders().then((result) => {
      if (result?.ok) {
        setEncoders(new Set(result.encoders));
      }
    });
  }, [ffmpegInfo?.ok, ffmpegInfo?.ffmpeg]);

  useEffect(() => {
    const unsubscribe = window.api.onJobUpdate((update: JobUpdate) => {
      setFiles((prev) =>
        prev.map((item) =>
          item.id === update.id
            ? {
                ...item,
                status: update.status ?? item.status,
                progress: update.progress ?? item.progress,
                outputPath: update.outputPath ?? item.outputPath,
                message: update.message ?? item.message,
                error: update.error ?? item.error,
                command: update.command ?? item.command
              }
            : item
        )
      );
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!preset) return;
    setFiles((prev) =>
      prev.map((item) =>
        item.status === "idle"
          ? {
              ...item,
              outputPath: buildOutputPath(item.inputPath, outputDir, nameTemplate, preset.ext)
            }
          : item
      )
    );
  }, [outputDir, nameTemplate, preset]);

  useEffect(() => {
    if (!preset && availablePresets.length) {
      setPresetId(availablePresets[0].id);
    }
  }, [availablePresets, preset]);

  const queueRunning = files.some((file) => file.status === "queued" || file.status === "running");

  const addFiles = async () => {
    const paths: string[] = await window.api.selectFiles();
    if (!paths.length) return;
    setFiles((prev) => {
      const existing = new Set(prev.map((p) => p.inputPath));
      const additions = paths
        .filter((filePath) => !existing.has(filePath))
        .map((filePath) => ({
          id: crypto.randomUUID(),
          inputPath: filePath,
          outputPath: buildOutputPath(filePath, outputDir, nameTemplate, preset?.ext ?? "mp4"),
          status: "idle" as const,
          progress: null
        }));
      return [...prev, ...additions];
    });
  };

  const locateFfmpeg = async () => {
    const selected = await window.api.selectBinary("Select ffmpeg binary");
    if (!selected) return;
    const info = await window.api.setFfmpegPaths({ ffmpegPath: selected });
    setFfmpegInfo(info);
  };

  const locateFfprobe = async () => {
    const selected = await window.api.selectBinary("Select ffprobe binary");
    if (!selected) return;
    const info = await window.api.setFfmpegPaths({ ffprobePath: selected });
    setFfmpegInfo(info);
  };

  const chooseOutputDir = async () => {
    const dir = await window.api.selectOutputDir();
    if (dir) setOutputDir(dir);
  };

  const startQueue = async () => {
    if (!preset) return;
    const idleFiles = files.filter((item) => item.status === "idle");
    if (!idleFiles.length) return;

    const extra = splitArgs(extraArgs.trim());
    const jobs = idleFiles.map((file) => ({
      id: file.id,
      inputPath: file.inputPath,
      outputPath: file.outputPath,
      args: [...preset.args, ...extra],
      overwrite
    }));

    setFiles((prev) =>
      prev.map((item) =>
        item.status === "idle" ? { ...item, status: "queued", progress: 0, message: "Queued" } : item
      )
    );

    await window.api.startQueue(jobs);
  };

  const summary = {
    total: files.length,
    queued: files.filter((f) => f.status === "queued").length,
    running: files.filter((f) => f.status === "running").length,
    done: files.filter((f) => f.status === "done").length,
    failed: files.filter((f) => f.status === "error").length
  };

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-4 pb-12 sm:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">FilesX</h1>
          <p className="mt-2 text-sm text-muted-foreground">Desktop batch conversion with FFmpeg</p>
          {ffmpegInfo?.ffmpeg ? (
            <p className="mt-1 text-xs text-muted-foreground">Using: {ffmpegInfo.ffmpeg}</p>
          ) : null}
        </div>
        <Badge variant={ffmpegInfo?.ok ? "default" : "destructive"} className="px-3 py-1 text-xs uppercase">
          {ffmpegInfo?.ok ? "FFmpeg Ready" : "FFmpeg Missing"}
        </Badge>
      </div>

      {ffmpegInfo && !ffmpegInfo.ok ? (
        <Alert variant="destructive" className="mb-6 bg-destructive/5">
          <AlertCircle className="mb-2 h-4 w-4" />
          <AlertTitle>FFmpeg binaries not resolved</AlertTitle>
          <AlertDescription>
            <p className="mb-3">Point FilesX to your binaries or keep them in `bin/` for portable mode.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={locateFfmpeg}>
                <LocateFixed className="mr-2 h-4 w-4" /> Locate ffmpeg
              </Button>
              <Button size="sm" variant="outline" onClick={locateFfprobe}>
                <LocateFixed className="mr-2 h-4 w-4" /> Locate ffprobe
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="frost-card border-white/60">
          <CardHeader>
            <CardTitle>Core Settings</CardTitle>
            <CardDescription>Choose preset, output behavior, and optional ffmpeg flags.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">Preset</label>
              <select
                value={preset?.id ?? presetId}
                onChange={(event) => setPresetId(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {availablePresets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              {!availablePresets.length ? (
                <p className="text-xs text-destructive">No compatible presets for this FFmpeg build.</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Output folder</label>
              <div className="flex gap-2">
                <Input
                  value={outputDir}
                  placeholder="Same as input folder"
                  onChange={(event) => setOutputDir(event.target.value)}
                />
                <Button type="button" variant="outline" onClick={chooseOutputDir}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOutputDir("")} disabled={!outputDir}>
                  Clear
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Output naming template</label>
              <Input value={nameTemplate} onChange={(event) => setNameTemplate(event.target.value)} />
              <p className="text-xs text-muted-foreground">Use {"{name}"} and {"{ext}"} placeholders.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Advanced ffmpeg args</label>
              <Input
                value={extraArgs}
                onChange={(event) => setExtraArgs(event.target.value)}
                placeholder="-vf scale=1280:-2 -r 30"
              />
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={overwrite} onCheckedChange={(state) => setOverwrite(Boolean(state))} />
                Overwrite outputs
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={showCommand} onCheckedChange={(state) => setShowCommand(Boolean(state))} />
                Show ffmpeg command
              </label>
            </div>
          </CardContent>
        </Card>

        <Card className="frost-card border-white/60">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Queue</CardTitle>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Total: {summary.total}</Badge>
                <Badge variant="outline">Queued: {summary.queued}</Badge>
                <Badge variant="outline">Running: {summary.running}</Badge>
                <Badge variant="outline">Done: {summary.done}</Badge>
                <Badge variant="outline">Failed: {summary.failed}</Badge>
              </div>
            </div>
            <CardDescription>Batch jobs execute sequentially.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={addFiles}>
                <FilePlus2 className="mr-2 h-4 w-4" /> Add files
              </Button>
              <Button
                type="button"
                onClick={startQueue}
                disabled={!files.length || queueRunning || !ffmpegInfo?.ok || !preset}
              >
                <Play className="mr-2 h-4 w-4" /> Start queue
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setFiles((prev) =>
                    prev.map((item) =>
                      item.status === "error" || item.status === "canceled"
                        ? { ...item, status: "idle", message: undefined, error: undefined, progress: null }
                        : item
                    )
                  )
                }
                disabled={!files.length || queueRunning}
              >
                <RotateCcw className="mr-2 h-4 w-4" /> Reset failed
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setFiles((prev) => prev.filter((item) => item.status !== "done"))}
                disabled={!files.length}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Clear finished
              </Button>
            </div>

            {!files.length ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                <Folder className="mx-auto mb-3 h-5 w-5" />
                Add files to start a conversion batch.
              </div>
            ) : (
              <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className={cn(
                      "rounded-xl border bg-card/70 p-4",
                      file.status === "running" && "border-primary/45",
                      file.status === "done" && "border-emerald-400/55",
                      (file.status === "error" || file.status === "canceled") && "border-destructive/50"
                    )}
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{getFileName(file.inputPath)}</p>
                        <p className="truncate text-xs text-muted-foreground">{file.outputPath}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={statusVariant(file.status)}>{statusLabel(file.status)}</Badge>
                        {(file.status === "running" || file.status === "queued") && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => window.api.cancelJob(file.id)}>
                            <XCircle className="mr-1 h-4 w-4" /> Cancel
                          </Button>
                        )}
                        {file.status === "done" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => window.api.revealItem(file.outputPath)}
                          >
                            Show
                          </Button>
                        )}
                      </div>
                    </div>

                    <Progress value={Math.round((file.progress ?? 0) * 100)} />

                    <div className="mt-2 flex flex-wrap items-start justify-between gap-2 text-xs text-muted-foreground">
                      <span>{file.message || ""}</span>
                      {file.error ? <span className="max-w-xl text-right text-destructive">{file.error}</span> : null}
                    </div>

                    {showCommand && file.command ? (
                      <div className="mt-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                        <TerminalSquare className="mr-1 inline h-3.5 w-3.5" />
                        {file.command}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <footer className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        {ffmpegInfo?.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertCircle className="h-4 w-4 text-destructive" />}
        Portable mode checks `bin/ffmpeg` and `bin/ffprobe` automatically.
        <RefreshCw className="h-3.5 w-3.5" />
      </footer>
    </main>
  );
}
