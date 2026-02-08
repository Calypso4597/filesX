import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "path";
import fs from "fs";
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from "child_process";

let mainWindow: BrowserWindow | null = null;

const DEFAULT_FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const DEFAULT_FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const EXTRA_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"];

const overridePaths: { ffmpeg: string | null; ffprobe: string | null } = {
  ffmpeg: null,
  ffprobe: null
};

function addExtraPaths() {
  const current = process.env.PATH || "";
  const parts = current.split(":").filter(Boolean);
  const merged = [...EXTRA_PATHS, ...parts.filter((p) => !EXTRA_PATHS.includes(p))];
  process.env.PATH = merged.join(":");
}

function isExecutable(filePath: string) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function checkBinary(cmd: string) {
  try {
    const result = spawnSync(cmd, ["-version"], { encoding: "utf-8" });
    if (result.status === 0) {
      const firstLine = (result.stdout || "").split(/\r?\n/)[0] || "";
      return { ok: true, version: firstLine.trim() };
    }
    return { ok: false, version: "" };
  } catch {
    return { ok: false, version: "" };
  }
}

function resolveBinary(nameOrPath: string) {
  if (path.isAbsolute(nameOrPath)) {
    return isExecutable(nameOrPath) ? nameOrPath : null;
  }

  const available = checkBinary(nameOrPath).ok;
  if (available) return nameOrPath;

  for (const dir of EXTRA_PATHS) {
    const candidate = path.join(dir, nameOrPath);
    if (isExecutable(candidate)) return candidate;
  }

  return null;
}

function resolveFfmpeg() {
  const ffmpegCandidate = overridePaths.ffmpeg || DEFAULT_FFMPEG;
  const ffprobeCandidate = overridePaths.ffprobe || DEFAULT_FFPROBE;
  const ffmpegResolved = resolveBinary(ffmpegCandidate);
  const ffprobeResolved = resolveBinary(ffprobeCandidate);

  const ffmpeg = ffmpegResolved || ffmpegCandidate;
  const ffprobe = ffprobeResolved || ffprobeCandidate;

  const ffmpegCheck = ffmpegResolved ? checkBinary(ffmpegResolved) : { ok: false, version: "" };
  const ffprobeCheck = ffprobeResolved ? checkBinary(ffprobeResolved) : { ok: false, version: "" };
  const ok = ffmpegCheck.ok && ffprobeCheck.ok;
  const message = ok
    ? ""
    : "FFmpeg/FFprobe not found on PATH. Install with: brew install ffmpeg or set a custom path.";
  return {
    ok,
    ffmpeg,
    ffprobe,
    ffmpegVersion: ffmpegCheck.version,
    ffprobeVersion: ffprobeCheck.version,
    message
  };
}

function listEncoders() {
  const { ok, ffmpeg } = resolveFfmpeg();
  if (!ok) return { ok: false, encoders: [] as string[] };
  try {
    const result = spawnSync(ffmpeg, ["-encoders"], { encoding: "utf-8" });
    if (result.status !== 0) return { ok: false, encoders: [] as string[] };
    const encoders: string[] = [];
    const lines = (result.stdout || "").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*[A-Z\.]{6}\s+([0-9A-Za-z_]+)\s/);
      if (match?.[1]) encoders.push(match[1]);
    }
    return { ok: true, encoders };
  } catch {
    return { ok: false, encoders: [] as string[] };
  }
}

type JobStatus = "queued" | "running" | "done" | "error" | "canceled";

interface JobRequest {
  id: string;
  inputPath: string;
  outputPath: string;
  args: string[];
  overwrite: boolean;
}

interface JobState extends JobRequest {
  status: JobStatus;
  progress: number | null;
  message?: string;
  error?: string;
  command?: string;
}

const jobStates = new Map<string, JobState>();
let jobQueue: string[] = [];
let currentProcess: ChildProcessWithoutNullStreams | null = null;
let currentJobId: string | null = null;

function emitUpdate(jobId: string) {
  const job = jobStates.get(jobId);
  if (!job || !mainWindow) return;
  mainWindow.webContents.send("jobs:update", {
    id: job.id,
    status: job.status,
    progress: job.progress,
    outputPath: job.outputPath,
    message: job.message,
    error: job.error,
    command: job.command
  });
}

function ensureUniquePath(targetPath: string) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  let counter = 1;
  while (true) {
    const candidate = path.join(dir, `${base}-${counter}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    counter += 1;
  }
}

function buildCommandString(ffmpegPath: string, args: string[]) {
  const quote = (value: string) =>
    value.includes(" ") ? `"${value.replace(/"/g, "\\\"")}"` : value;
  return [ffmpegPath, ...args].map(quote).join(" ");
}

async function getDurationMs(ffprobePath: string, inputPath: string) {
  return new Promise<number | null>((resolve) => {
    const probe = spawn(ffprobePath, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath
    ]);

    let output = "";
    probe.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    probe.on("close", (code) => {
      if (code !== 0) return resolve(null);
      const seconds = parseFloat(output.trim());
      if (Number.isNaN(seconds)) return resolve(null);
      resolve(Math.round(seconds * 1000));
    });

    probe.on("error", () => resolve(null));
  });
}

async function runNextJob() {
  if (currentProcess || jobQueue.length === 0) return;
  const nextId = jobQueue.shift();
  if (!nextId) return;
  const job = jobStates.get(nextId);
  if (!job || job.status === "canceled") {
    runNextJob();
    return;
  }

  const { ffmpeg, ffprobe } = resolveFfmpeg();
  const durationMs = await getDurationMs(ffprobe, job.inputPath);

  const finalOutput = job.overwrite ? job.outputPath : ensureUniquePath(job.outputPath);
  if (finalOutput !== job.outputPath) {
    job.outputPath = finalOutput;
  }

  const globalArgs = job.overwrite ? ["-y"] : ["-n"];
  const ffmpegArgs = [
    ...globalArgs,
    "-i",
    job.inputPath,
    ...job.args,
    "-progress",
    "pipe:1",
    "-nostats",
    finalOutput
  ];

  job.command = buildCommandString(ffmpeg, [
    ...globalArgs,
    "-i",
    job.inputPath,
    ...job.args,
    finalOutput
  ]);
  job.status = "running";
  job.progress = 0;
  job.message = "Processing";
  job.error = undefined;
  emitUpdate(job.id);

  const proc = spawn(ffmpeg, ffmpegArgs, { windowsHide: true });
  currentProcess = proc;
  currentJobId = job.id;

  let buffer = "";
  let stderrBuffer = "";
  const stderrLines: string[] = [];
  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const [key, value] = line.split("=");
      if (!key || value === undefined) continue;
      if (key === "out_time_ms") {
        const outTime = parseInt(value, 10);
        if (!Number.isNaN(outTime) && durationMs) {
          const progress = Math.min(outTime / durationMs, 1);
          job.progress = progress;
          emitUpdate(job.id);
        }
      }
      if (key === "progress" && value === "end") {
        job.progress = 1;
        emitUpdate(job.id);
      }
    }
  });

  proc.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      stderrLines.push(trimmed);
      if (stderrLines.length > 8) stderrLines.shift();
    }
  });

  proc.on("close", (code) => {
    if (job.status === "canceled") {
      job.message = "Canceled";
      job.progress = null;
    } else if (code === 0) {
      job.status = "done";
      job.progress = 1;
      job.message = "Done";
    } else {
      job.status = "error";
      job.progress = null;
      job.message = "Failed";
      const detailLines = stderrLines.slice(-3);
      const detail = detailLines.length ? ` | ${detailLines.join(" | ")}` : "";
      job.error = `FFmpeg exited with code ${code ?? "unknown"}${detail}`;
    }
    emitUpdate(job.id);
    currentProcess = null;
    currentJobId = null;
    runNextJob();
  });

  proc.on("error", (err) => {
    job.status = "error";
    job.progress = null;
    job.message = "Failed to start";
    job.error = err.message;
    emitUpdate(job.id);
    currentProcess = null;
    currentJobId = null;
    runNextJob();
  });
}

function enqueueJobs(jobs: JobRequest[]) {
  for (const job of jobs) {
    const existing = jobStates.get(job.id);
    if (existing && existing.status === "running") continue;
    const state: JobState = {
      ...job,
      status: "queued",
      progress: 0
    };
    jobStates.set(job.id, state);
    jobQueue.push(job.id);
    emitUpdate(job.id);
  }
  runNextJob();
}

function cancelJob(jobId: string) {
  const job = jobStates.get(jobId);
  if (!job) return;
  if (job.status === "queued") {
    job.status = "canceled";
    job.progress = null;
    job.message = "Canceled";
    jobQueue = jobQueue.filter((id) => id !== jobId);
    emitUpdate(jobId);
    return;
  }
  if (job.status === "running" && currentProcess && currentJobId === jobId) {
    job.status = "canceled";
    job.progress = null;
    job.message = "Canceling";
    emitUpdate(jobId);
    currentProcess.kill("SIGTERM");
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#0B0F13",
    title: "FilesX",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (app.isPackaged) {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  } else {
    const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
    await mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

addExtraPaths();

app.whenReady().then(async () => {
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("ffmpeg:check", () => resolveFfmpeg());
ipcMain.handle("ffmpeg:encoders", () => listEncoders());

ipcMain.handle("ffmpeg:setPaths", (_event, paths: { ffmpegPath?: string; ffprobePath?: string }) => {
  if (paths.ffmpegPath) {
    overridePaths.ffmpeg = paths.ffmpegPath;
  }
  if (paths.ffprobePath) {
    overridePaths.ffprobe = paths.ffprobePath;
  }

  if (overridePaths.ffmpeg && !paths.ffprobePath) {
    const candidate = path.join(path.dirname(overridePaths.ffmpeg), "ffprobe");
    if (isExecutable(candidate)) {
      overridePaths.ffprobe = candidate;
    }
  }

  return resolveFfmpeg();
});

ipcMain.handle("dialog:openFiles", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile", "multiSelections"],
    title: "Add files to convert"
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("dialog:openOutputDir", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
    title: "Select output folder"
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("dialog:selectBinary", async (_event, title: string) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile"],
    title: title || "Select ffmpeg binary"
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("jobs:start", async (_event, jobs: JobRequest[]) => {
  enqueueJobs(jobs);
  return { accepted: jobs.length };
});

ipcMain.handle("jobs:cancel", async (_event, jobId: string) => {
  cancelJob(jobId);
  return true;
});

ipcMain.handle("paths:reveal", async (_event, filePath: string) => {
  if (filePath) shell.showItemInFolder(filePath);
});
