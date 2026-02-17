// electron/TranscriptionHelper.ts
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { promisify } from "util";

const execAsync = promisify(exec);
const writeFileAsync = promisify(fs.writeFile);

export class TranscriptionHelper {
  private tempDir: string;

  constructor() {
    this.tempDir = os.tmpdir();
  }

  public async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    // Используем .webm, так как MediaRecorder в браузере часто отдает его
    const tempFilePath = path.join(this.tempDir, `recording-${Date.now()}.webm`);
    
    try {
      // 1. Сохраняем временный файл
      await writeFileAsync(tempFilePath, audioBuffer);
      console.log(`[Transcription] Saved audio to ${tempFilePath}`);

      const scriptPath = path.join(process.cwd(), 'transcribe_script.py'); 
      const command = `py "${scriptPath}" "${tempFilePath}"`;

      console.log(`[Transcription] Running command: ${command}`);

      // 3. Запускаем процесс
      const { stdout, stderr } = await execAsync(command);

      // 4. Результат теперь приходит сразу в stdout (так настроен скрипт выше)
      // Убираем логику чтения файла .txt, она больше не нужна
      let transcription = stdout.trim();

      if (!transcription) {
          console.warn("[Transcription] Empty result");
          if (stderr) console.error(`[Transcription Error]: ${stderr}`);
      }

      return transcription;

    } catch (error: any) {
      console.error("[Transcription] Error:", error);
      throw new Error(`Transcription failed. Make sure FFmpeg is installed and accessible in PATH. Error: ${error.message}`);
    } finally {
      // Очистка аудиофайла
      if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
      }
    }
  }
}