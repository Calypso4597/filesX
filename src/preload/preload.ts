import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  checkFfmpeg: () => ipcRenderer.invoke("ffmpeg:check"),
  getEncoders: () => ipcRenderer.invoke("ffmpeg:encoders"),
  setFfmpegPaths: (paths: { ffmpegPath?: string; ffprobePath?: string }) =>
    ipcRenderer.invoke("ffmpeg:setPaths", paths),
  selectFiles: () => ipcRenderer.invoke("dialog:openFiles"),
  selectOutputDir: () => ipcRenderer.invoke("dialog:openOutputDir"),
  selectBinary: (title: string) => ipcRenderer.invoke("dialog:selectBinary", title),
  startQueue: (jobs: unknown) => ipcRenderer.invoke("jobs:start", jobs),
  cancelJob: (jobId: string) => ipcRenderer.invoke("jobs:cancel", jobId),
  revealItem: (filePath: string) => ipcRenderer.invoke("paths:reveal", filePath),
  onJobUpdate: (callback: (update: any) => void) => {
    const handler = (_event: unknown, update: any) => callback(update);
    ipcRenderer.on("jobs:update", handler);
    return () => ipcRenderer.removeListener("jobs:update", handler);
  }
});
