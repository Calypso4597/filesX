import React, { useEffect, useMemo, useState } from "react";
import type { FileItem, JobUpdate } from "./types";

const PRESETS = [
  {
    id: "mp4-h264-vtb",
    label: "MP4 (H.264 VideoToolbox + AAC)",
    ext: "mp4",
    args: ["-c:v", "h264_videotoolbox", "-b:v", "5M", "-c:a", "aac", "-b:a", "160k"]
  },
  {
    id: "mp4-hevc-vtb",
    label: "MP4 (HEVC VideoToolbox + AAC)",
    ext: "mp4",
    args: ["-c:v", "hevc_videotoolbox", "-b:v", "4M", "-tag:v", "hvc1", "-c:a", "aac", "-b:a", "160k"]
  },
  {
    id: "m4a-aac",
    label: "M4A (AAC 256 kbps)",
    ext: "m4a",
    args: ["-vn", "-c:a", "aac", "-b:a", "256k"]
  },
  {
    id: "wav",
    label: "WAV (PCM 48kHz)",
    ext: "wav",
    args: ["-vn", "-c:a", "pcm_s16le", "-ar", "48000"]
  }
];

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

function formatStatus(status: FileItem["status"]) {
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

export default function App() {
  const [ffmpegInfo, setFfmpegInfo] = useState<any>(null);
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [outputDir, setOutputDir] = useState("");
  const [nameTemplate, setNameTemplate] = useState("{name}.{ext}");
  const [extraArgs, setExtraArgs] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [showCommand, setShowCommand] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);

  const preset = useMemo(() => PRESETS.find((p) => p.id === presetId) ?? PRESETS[0], [presetId]);

  useEffect(() => {
    window.api.checkFfmpeg().then(setFfmpegInfo);
  }, []);

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
  }, [outputDir, nameTemplate, preset.ext]);

  const queueRunning = files.some((file) => file.status === "queued" || file.status === "running");

  const addFiles = async () => {
    const paths: string[] = await window.api.selectFiles();
    if (!paths.length) return;
    setFiles((prev) => {
      const existing = new Set(prev.map((p) => p.inputPath));
      const additions = paths
        .filter((p) => !existing.has(p))
        .map((path) => ({
          id: crypto.randomUUID(),
          inputPath: path,
          outputPath: buildOutputPath(path, outputDir, nameTemplate, preset.ext),
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

  const clearOutputDir = () => setOutputDir("");

  const startQueue = async () => {
    const idleFiles = files.filter((f) => f.status === "idle");
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

  const cancelJob = async (id: string) => {
    await window.api.cancelJob(id);
  };

  const clearFinished = () => setFiles((prev) => prev.filter((item) => item.status !== "done"));

  const resetFailed = () =>
    setFiles((prev) =>
      prev.map((item) =>
        item.status === "error" || item.status === "canceled"
          ? { ...item, status: "idle", message: undefined, error: undefined, progress: null }
          : item
      )
    );

  const revealOutput = async (path: string) => {
    await window.api.revealItem(path);
  };

  const summary = {
    total: files.length,
    queued: files.filter((f) => f.status === "queued").length,
    running: files.filter((f) => f.status === "running").length,
    done: files.filter((f) => f.status === "done").length,
    failed: files.filter((f) => f.status === "error").length
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <div className="title">FilesX</div>
          <div className="subtitle">Desktop batch conversion powered by FFmpeg</div>
          {ffmpegInfo?.ffmpeg ? (
            <div className="subtitle small">Using: {ffmpegInfo.ffmpeg}</div>
          ) : null}
        </div>
        <div className="status">
          {ffmpegInfo?.ok ? (
            <span className="pill ok">FFmpeg ready</span>
          ) : (
            <span className="pill warn">FFmpeg missing</span>
          )}
        </div>
      </header>

      {ffmpegInfo && !ffmpegInfo.ok && (
        <div className="alert">
          <strong>FFmpeg not found.</strong> Install it with <code>brew install ffmpeg</code> and reopen
          FilesX, or locate your existing binaries.
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" onClick={locateFfmpeg}>
              Locate ffmpeg
            </button>
            <button type="button" className="ghost" onClick={locateFfprobe}>
              Locate ffprobe
            </button>
          </div>
        </div>
      )}

      <div className="layout">
        <section className="panel">
          <h2>Core Settings</h2>
          <label className="field">
            <span>Preset</span>
            <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
              {PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Output folder</span>
            <div className="row">
              <input
                type="text"
                value={outputDir}
                placeholder="Same as input folder"
                onChange={(event) => setOutputDir(event.target.value)}
              />
              <button type="button" onClick={chooseOutputDir}>
                Choose
              </button>
              {outputDir && (
                <button type="button" className="ghost" onClick={clearOutputDir}>
                  Clear
                </button>
              )}
            </div>
          </label>

          <label className="field">
            <span>Output naming</span>
            <input
              type="text"
              value={nameTemplate}
              onChange={(event) => setNameTemplate(event.target.value)}
            />
            <small>Use {"{name}"} for base name and {"{ext}"} for preset extension.</small>
          </label>

          <label className="field">
            <span>Advanced ffmpeg args</span>
            <input
              type="text"
              value={extraArgs}
              onChange={(event) => setExtraArgs(event.target.value)}
              placeholder="e.g. -vf scale=1280:-2 -r 30"
            />
          </label>

          <div className="row wrap">
            <label className="toggle">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              <span>Overwrite outputs</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showCommand}
                onChange={(e) => setShowCommand(e.target.checked)}
              />
              <span>Show ffmpeg command</span>
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Queue</h2>
            <div className="summary">
              <span>Total: {summary.total}</span>
              <span>Queued: {summary.queued}</span>
              <span>Running: {summary.running}</span>
              <span>Done: {summary.done}</span>
              <span>Failed: {summary.failed}</span>
            </div>
          </div>

          <div className="actions">
            <button type="button" onClick={addFiles}>
              Add files
            </button>
            <button type="button" onClick={startQueue} disabled={!files.length || queueRunning || !ffmpegInfo?.ok}>
              Start queue
            </button>
            <button type="button" className="ghost" onClick={resetFailed} disabled={!files.length || queueRunning}>
              Reset failed
            </button>
            <button type="button" className="ghost" onClick={clearFinished} disabled={!files.length}>
              Clear finished
            </button>
          </div>

          {!files.length ? (
            <div className="empty">Add files to start converting. Batch jobs run sequentially.</div>
          ) : (
            <div className="list">
              {files.map((file) => (
                <div key={file.id} className={`item ${file.status}`}>
                  <div className="item-main">
                    <div>
                      <div className="file-name">{getFileName(file.inputPath)}</div>
                      <div className="file-path">{file.outputPath}</div>
                    </div>
                    <div className="item-meta">
                      <span className="badge">{formatStatus(file.status)}</span>
                      {file.status === "running" || file.status === "queued" ? (
                        <button type="button" className="ghost" onClick={() => cancelJob(file.id)}>
                          Cancel
                        </button>
                      ) : null}
                      {file.status === "done" ? (
                        <button type="button" className="ghost" onClick={() => revealOutput(file.outputPath)}>
                          Show
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="progress">
                    <div
                      className="progress-bar"
                      style={{ width: `${Math.round((file.progress ?? 0) * 100)}%` }}
                    />
                  </div>
                  <div className="item-footer">
                    <span>{file.message || ""}</span>
                    {file.error ? <span className="error">{file.error}</span> : null}
                  </div>
                  {showCommand && file.command ? <div className="command">{file.command}</div> : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
