// electron/TranscriptionHelper.ts
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { promisify } from "util";

const execAsync = promisify(exec);
const writeFileAsync = promisify(fs.writeFile);

// Увеличиваем буфер до 16MB, чтобы длинные транскрипции не вызывали ошибку
const TRANSCRIPTION_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

export class TranscriptionHelper {
  private tempDir: string;

  constructor() {
    this.tempDir = os.tmpdir();
  }

  /**
   * Общий метод запуска команды транскрибации.
   * Обрабатывает лимиты буфера и "восстанавливает" результат, если процесс вернул ошибку, но успел выдать текст.
   */
  private async runTranscriptionCommand(command: string): Promise<string> {
    try {
      console.log(`[Transcription] Running command: ${command}`);
      // Передаем увеличенный maxBuffer
      const { stdout } = await execAsync(command, { maxBuffer: TRANSCRIPTION_MAX_BUFFER_BYTES });
      return this.validateOutput(stdout);
    } catch (error: any) {
      // ЛОГИКА ВОССТАНОВЛЕНИЯ:
      // Если процесс упал (например, cuda error при закрытии), но stdout содержит текст — используем его.
      if (error.stdout && error.stdout.toString().trim().length > 0) {
        console.warn("[Transcription] Process exited with error code, but stdout was captured. Recovering...");
        return this.validateOutput(error.stdout);
      }
      
      console.error("[Transcription] Error:", error);
      if (error.stderr) console.error(`[Transcription Stderr]: ${error.stderr}`);
      
      throw new Error(`Transcription failed. Error: ${error.message}`);
    }
  }

  private validateOutput(stdout: any): string {
    let transcription = stdout.toString().trim();
    if (!transcription) {
      throw new Error("Transcription result is empty");
    }
    return transcription;
  }

  public async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    // Используем .webm, так как MediaRecorder в браузере часто отдает его
    const tempFilePath = path.join(this.tempDir, `recording-${Date.now()}.webm`);
    
    try {
      // 1. Сохраняем временный файл
      await writeFileAsync(tempFilePath, audioBuffer);
      console.log(`[Transcription] Saved audio to ${tempFilePath}`);

      // 2. Собираем команду (используем умный поиск python и скрипта)
      const scriptPath = this.resolveScriptPath();
      const pythonCommand = await this.resolvePythonCommand();
      const command = `${pythonCommand} "${scriptPath}" "${tempFilePath}"`;

      // 3. Запускаем через защищенный метод
      return await this.runTranscriptionCommand(command);

    } finally {
      // Очистка аудиофайла
      if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
      }
    }
  }

  // Метод для транскрибации готового файла (видео/аудио), нужен для режима отладки и загрузки файлов
  public async transcribeExistingFile(filePath: string): Promise<string> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    console.log(`[Transcription Debug] Processing existing file: ${filePath}`);

    const scriptPath = this.resolveScriptPath();
    const pythonCommand = await this.resolvePythonCommand();
    
    // Оборачиваем пути в кавычки
    const command = `${pythonCommand} "${scriptPath}" "${filePath}"`;

    return await this.runTranscriptionCommand(command);
  }

  // Вспомогательный метод для поиска скрипта (работает и в dev, и в prod)
  private resolveScriptPath(): string {
    const candidates = [
      path.join(process.cwd(), "transcribe_script.py"),
      path.join(__dirname, "..", "transcribe_script.py"),
      path.join(__dirname, "transcribe_script.py"),
      // Fallback для некоторых конфигураций electron-builder
      path.join(process.resourcesPath || "", "transcribe_script.py") 
    ];

    const scriptPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!scriptPath) {
      // Если не нашли, пробуем дефолтный вариант
      return path.join(process.cwd(), 'transcribe_script.py');
    }

    return scriptPath;
  }

  // Вспомогательный метод для поиска команды запуска python
  private async resolvePythonCommand(): Promise<string> {
    const candidates = process.platform === "win32"
      ? ["py", "python", "python3"]
      : ["python3", "python"];

    for (const candidate of candidates) {
      try {
        await execAsync(`${candidate} --version`);
        return candidate;
      } catch {
        // пробуем следующий
      }
    }

    // Если ничего не нашли, возвращаем просто python (пусть система разбирается)
    return "python";
  }
}