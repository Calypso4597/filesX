import type { JobUpdate } from "./types";

declare global {
  interface Window {
    api: {
      checkFfmpeg: () => Promise<any>;
      setFfmpegPaths: (paths: { ffmpegPath?: string; ffprobePath?: string }) => Promise<any>;
      selectFiles: () => Promise<string[]>;
      selectOutputDir: () => Promise<string | null>;
      selectBinary: (title: string) => Promise<string | null>;
      startQueue: (jobs: Array<any>) => Promise<{ accepted: number }>;
      cancelJob: (id: string) => Promise<boolean>;
      revealItem: (path: string) => Promise<void>;
      onJobUpdate: (callback: (update: JobUpdate) => void) => () => void;
    };
  }
}

export {};
