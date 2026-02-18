import { execFile } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

export interface DebugVideoTranscriptionResult {
  audioPath: string
  cleanupAudio: () => Promise<void>
}

export class VideoTranscriptionDebugHelper {
  public async extractAudioFromVideo(videoPath: string): Promise<DebugVideoTranscriptionResult> {
    if (!videoPath || !videoPath.trim()) {
      throw new Error("Video path is required")
    }

    const normalizedPath = path.resolve(videoPath)
    if (!fs.existsSync(normalizedPath)) {
      throw new Error(`Video file does not exist: ${normalizedPath}`)
    }

    const audioPath = path.join(
      os.tmpdir(),
      `debug-transcription-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`
    )

    const ffmpegArgs = [
      "-y",
      "-i",
      normalizedPath,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      audioPath
    ]

    try {
      await execFileAsync("ffmpeg", ffmpegArgs)
    } catch (error: any) {
      throw new Error(
        `Failed to extract audio from video. Make sure ffmpeg is installed and available in PATH. Error: ${error.message}`
      )
    }

    return {
      audioPath,
      cleanupAudio: async () => {
        if (fs.existsSync(audioPath)) {
          await fs.promises.unlink(audioPath)
        }
      }
    }
  }
}

