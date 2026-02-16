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

      // 2. Формируем команду
      // ИЗМЕНЕНИЕ: Используем "py -m whisper" вместо просто "whisper",
      // так как скрипт не добавлен в PATH, но python доступен.
      // --model small (баланс скорости/качества)
      // --language uk (украинский)
      // --fp16 False (чтобы избежать предупреждений на CPU)
      const command = `py -m whisper "${tempFilePath}" --model small --language uk --output_format txt --output_dir "${this.tempDir}" --fp16 False`;

      console.log(`[Transcription] Running command: ${command}`);
      
      // 3. Запускаем процесс
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr) console.log(`[Transcription Log]: ${stderr}`);

      // 4. Ищем файл результата
      // Whisper обычно создает файл [имя_файла].txt
      const expectedTxtPath = tempFilePath + ".txt";
      
      // Иногда Whisper меняет расширение самого файла в имени вывода
      // Например: audio.webm -> audio.txt (вместо audio.webm.txt)
      const alternativeTxtPath = path.join(
          this.tempDir, 
          path.basename(tempFilePath, path.extname(tempFilePath)) + ".txt"
      );
      
      let transcription = "";
      
      if (fs.existsSync(expectedTxtPath)) {
          transcription = fs.readFileSync(expectedTxtPath, 'utf-8');
          // Удаляем файл транскрипции
          fs.unlinkSync(expectedTxtPath);
      } else if (fs.existsSync(alternativeTxtPath)) {
          transcription = fs.readFileSync(alternativeTxtPath, 'utf-8');
          fs.unlinkSync(alternativeTxtPath);
      } else {
          // Если файл не создан, возможно вывод в консоли
          console.warn("[Transcription] Txt file not found, trying stdout");
          transcription = stdout;
      }

      return transcription.trim();

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