# FilesX

Desktop batch converter powered by FFmpeg (Electron + React).

## Requirements
- Node.js 18+
- FFmpeg + FFprobe available using one of these options:
  - Portable mode: place binaries in `bin/ffmpeg` and `bin/ffprobe` in this repo
  - System mode: installed on PATH (macOS example: `brew install ffmpeg`)

## Dev
```bash
npm install
npm run dev
```

## Build renderer + main
```bash
npm run build
```

## Portable FFmpeg setup
```bash
mkdir -p bin
cp /Users/sanmid/Downloads/ffmpeg-8.0.1/ffmpeg bin/ffmpeg
cp /Users/sanmid/Downloads/ffmpeg-8.0.1/ffprobe bin/ffprobe
chmod +x bin/ffmpeg bin/ffprobe
```

FilesX detection order:
1. Explicit paths selected in the app
2. Portable `bin/` binaries in the app/project directory
3. `FFMPEG_PATH` / `FFPROBE_PATH`
4. PATH / common macOS locations
