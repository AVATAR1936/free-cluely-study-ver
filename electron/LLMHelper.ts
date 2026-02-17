// electron/LLMHelper.ts
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"
import fs from "fs"
import os from "os"
import { TranscriptionHelper } from "./TranscriptionHelper"

interface OllamaResponse {
  response: string
  done: boolean
}

export class LLMHelper {
  private model: GenerativeModel | null = null
  private readonly systemPrompt = `You are Wingman AI, a helpful, proactive assistant for any kind of problem or situation (not just coding). For any user input, analyze the situation, provide a clear problem statement, relevant context, and suggest several possible responses or actions the user could take next. Always explain your reasoning. Present your suggestions as a list of options or next steps.`
  private useOllama: boolean = false
  private ollamaModel: string = "gemma3:12b"
  private ollamaUrl: string = "http://localhost:11434"
  private transcriptionHelper: TranscriptionHelper;

  constructor(apiKey?: string, useOllama: boolean = false, ollamaModel?: string, ollamaUrl?: string) {
    this.useOllama = useOllama
    
    if (useOllama) {
      this.ollamaUrl = ollamaUrl || "http://localhost:11434"
      this.ollamaModel = ollamaModel || "gemma3:12b"
      console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)
      
      // Auto-detect and use first available model if specified model doesn't exist
      this.initializeOllamaModel()
    } else if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey)
      this.model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" })
      console.log("[LLMHelper] Using Google Gemini")
    } else {
      throw new Error("Either provide Gemini API key or enable Ollama mode")
    }
    this.transcriptionHelper = new TranscriptionHelper();
  }

  private async fileToGenerativePart(imagePath: string) {
    const imageData = await fs.promises.readFile(imagePath)
    return {
      inlineData: {
        data: imageData.toString("base64"),
        mimeType: "image/png"
      }
    }
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  private async callOllama(prompt: string): Promise<string> {
    return this.callOllamaWithOptions(prompt)
  }

  private getOllamaThreadCount(): number {
    return Math.max(1, Math.min(6, os.cpus().length))
  }

  private async callOllamaWithOptions(
    prompt: string,
    options: { temperature?: number; top_p?: number; num_ctx?: number; num_thread?: number } = {}
  ): Promise<string> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: prompt,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.7,
            top_p: options.top_p ?? 0.9,
            num_ctx: options.num_ctx,
            num_thread: options.num_thread ?? this.getOllamaThreadCount(),
          }
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data: OllamaResponse = await response.json()
      return data.response
    } catch (error) {
      console.error("[LLMHelper] Error calling Ollama:", error)
      throw new Error(`Failed to connect to Ollama: ${error.message}. Make sure Ollama is running on ${this.ollamaUrl}`)
    }
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  private async initializeOllamaModel(): Promise<void> {
    try {
      const availableModels = await this.getOllamaModels()
      if (availableModels.length === 0) {
        console.warn("[LLMHelper] No Ollama models found")
        return
      }

      // Check if current model exists, if not use the first available
      if (!availableModels.includes(this.ollamaModel)) {
        this.ollamaModel = availableModels[0]
        console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`)
      }

      // Test the selected model works
      const testResult = await this.callOllama("Hello")
      console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`)
    } catch (error) {
      console.error(`[LLMHelper] Failed to initialize Ollama model: ${error.message}`)
      // Try to use first available model as fallback
      try {
        const models = await this.getOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError) {
        console.error(`[LLMHelper] Fallback also failed: ${fallbackError.message}`)
      }
    }
  }

  public async processMeetingAudio(audioBuffer: Buffer): Promise<{ success: boolean, transcription: string, notes: string, error?: string }> {
    try {
      console.log("[LLMHelper] Starting meeting processing...")

      const transcription = await this.transcriptionHelper.transcribeAudio(audioBuffer)

      if (!transcription || transcription.trim().length === 0) {
        return {
          success: false,
          transcription: "",
          notes: "",
          error: "Whisper не смог распознать речь или запись пустая."
        }
      }

      console.log("[LLMHelper] Transcription complete. Length:", transcription.length)

      const chunks = this.splitTextIntoChunks(transcription, 12000, 10000)
      const extractedBlocks: string[] = []
      let breadcrumbs = "Немає попереднього контексту."

      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index]
        console.log(`[LLMHelper] Processing chunk ${index + 1}/${chunks.length}`)

        try {
          const sanitizationPrompt = `Ти — редактор технічних текстів. Очисти транскрипцію від запинок, повторів та розмов не по темі. Залиш лише факти, терміни та логіку обговорення. Відповідай виключно очищеним текстом.

Текст:
"""
${chunk}
"""`
          const sanitizedChunk = await this.callMeetingLLM(sanitizationPrompt, {
            temperature: 0.1,
            num_ctx: 4096,
          })

          const extractionPrompt = `Контекст попередньої частини: ${breadcrumbs}
Проаналізуй цей фрагмент. Виділи ключові тези, технічні параметри та формули в LaTeX ().
Якщо є завдання або дедлайни — випиши їх окремо.
Мова: Українська.

Фрагмент:
"""
${sanitizedChunk}
"""`
          const extractedChunk = await this.callMeetingLLM(extractionPrompt, {
            temperature: 0.2,
            num_ctx: 4096,
          })

          extractedBlocks.push(`### Блок ${index + 1}
${extractedChunk}`)
          breadcrumbs = this.buildBreadcrumbsFromExtraction(extractedChunk)
        } catch (chunkError: any) {
          console.error(`[LLMHelper] Failed to process chunk ${index + 1}:`, chunkError)
        }
      }

      if (extractedBlocks.length === 0) {
        return {
          success: true,
          transcription,
          notes: `## Не вдалося побудувати конспект
* Ollama не зміг обробити жоден чанк.
* Збережено сирий текст транскрипції нижче.

## Сирий текст
${transcription}`,
          error: "Chunk processing failed for all parts"
        }
      }

      const synthesisPrompt = `Ти — професійний асистент. На основі наданих блоків створи фінальний конспект.
1. Використовуй жирні заголовки (##).
2. Математика — тільки в LaTeX.
3. Окремий блок **'Action Items'**: чіткий список завдань, дедлайнів та організаційних рішень для студентів.
4. Жодних вступних фраз, відразу до справи.

Блоки для синтезу:
"""
${extractedBlocks.join("\n\n")}
"""`

      const notes = await this.callMeetingLLM(synthesisPrompt, {
        temperature: 0.2,
        num_ctx: 8192,
      })

      return {
        success: true,
        transcription,
        notes
      }
    } catch (error: any) {
      console.error("[LLMHelper] Error processing meeting:", error)
      return {
        success: false,
        transcription: "",
        notes: "",
        error: error.message
      }
    }
  }

  private splitTextIntoChunks(text: string, maxChunkLength: number = 12000, targetChunkLength: number = 10000): string[] {
    const normalizedText = text.replace(/\s+/g, " ").trim()
    if (!normalizedText) return []

    const sentenceParts = normalizedText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [normalizedText]
    const sentences = sentenceParts.map((sentence) => sentence.trim()).filter(Boolean)
    const chunks: string[] = []
    let currentChunk = ""

    for (const sentence of sentences) {
      if (sentence.length > maxChunkLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim())
          currentChunk = ""
        }

        for (let i = 0; i < sentence.length; i += maxChunkLength) {
          chunks.push(sentence.slice(i, i + maxChunkLength).trim())
        }
        continue
      }

      const candidate = currentChunk ? `${currentChunk} ${sentence}` : sentence
      if (candidate.length > maxChunkLength || (currentChunk.length >= targetChunkLength && candidate.length > targetChunkLength)) {
        chunks.push(currentChunk.trim())
        currentChunk = sentence
      } else {
        currentChunk = candidate
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim())
    }

    return chunks
  }

  private buildBreadcrumbsFromExtraction(extractedChunk: string): string {
    const lines = extractedChunk
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^[-*•]\s*/, ""))
      .filter((line) => !line.startsWith("##") && !line.startsWith("###"))

    return lines.slice(0, 5).map((line) => `- ${line}`).join("\n") || "Немає попереднього контексту."
  }

  private async callMeetingLLM(
    prompt: string,
    options: { temperature?: number; num_ctx?: number }
  ): Promise<string> {
    if (this.useOllama) {
      return this.callOllamaWithOptions(prompt, {
        ...options,
        top_p: 0.9,
      })
    }

    return this.chatWithGemini(prompt)
  }

  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      const imageParts = await Promise.all(imagePaths.map(path => this.fileToGenerativePart(path)))
      
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const result = await this.model.generateContent([prompt, ...imageParts])
      const response = await result.response
      const text = this.cleanJsonResponse(response.text())
      return JSON.parse(text)
    } catch (error) {
      console.error("Error extracting problem from images:", error)
      throw error
    }
  }

  public async generateSolution(problemInfo: any) {
    const prompt = `${this.systemPrompt}\n\nGiven this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    console.log("[LLMHelper] Calling Gemini LLM for solution...");
    try {
      const result = await this.model.generateContent(prompt)
      console.log("[LLMHelper] Gemini LLM returned result.");
      const response = await result.response
      const text = this.cleanJsonResponse(response.text())
      const parsed = JSON.parse(text)
      console.log("[LLMHelper] Parsed LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("[LLMHelper] Error in generateSolution:", error);
      throw error;
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    try {
      const imageParts = await Promise.all(debugImagePaths.map(path => this.fileToGenerativePart(path)))
      
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const result = await this.model.generateContent([prompt, ...imageParts])
      const response = await result.response
      const text = this.cleanJsonResponse(response.text())
      const parsed = JSON.parse(text)
      console.log("[LLMHelper] Parsed debug LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("Error debugging solution with images:", error)
      throw error
    }
  }

  public async analyzeAudioFile(audioPath: string) {
    try {
      const audioData = await fs.promises.readFile(audioPath);
      const audioPart = {
        inlineData: {
          data: audioData.toString("base64"),
          mimeType: "audio/mp3"
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user.`;
      const result = await this.model.generateContent([prompt, audioPart]);
      const response = await result.response;
      const text = response.text();
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio file:", error);
      throw error;
    }
  }

  public async analyzeAudioFromBase64(data: string, mimeType: string) {
    try {
      const audioPart = {
        inlineData: {
          data,
          mimeType
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user and be concise.`;
      const result = await this.model.generateContent([prompt, audioPart]);
      const response = await result.response;
      const text = response.text();
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio from base64:", error);
      throw error;
    }
  }

  public async analyzeImageFile(imagePath: string) {
    try {
      const imageData = await fs.promises.readFile(imagePath);
      const imagePart = {
        inlineData: {
          data: imageData.toString("base64"),
          mimeType: "image/png"
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe the content of this image in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the image. Do not return a structured JSON object, just answer naturally as you would to a user. Be concise and brief.`;
      const result = await this.model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing image file:", error);
      throw error;
    }
  }

  public async chatWithGemini(message: string): Promise<string> {
    try {
      if (this.useOllama) {
        return this.callOllama(message);
      } else if (this.model) {
        const result = await this.model.generateContent(message);
        const response = await result.response;
        return response.text();
      } else {
        throw new Error("No LLM provider configured");
      }
    } catch (error) {
      console.error("[LLMHelper] Error in chatWithGemini:", error);
      throw error;
    }
  }

  public async chat(message: string): Promise<string> {
    return this.chatWithGemini(message);
  }

  public isUsingOllama(): boolean {
    return this.useOllama;
  }

  public async getOllamaModels(): Promise<string[]> {
    if (!this.useOllama) return [];
    
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed to fetch models');
      
      const data = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      console.error("[LLMHelper] Error fetching Ollama models:", error);
      return [];
    }
  }

  public getCurrentProvider(): "ollama" | "gemini" {
    return this.useOllama ? "ollama" : "gemini";
  }

  public getCurrentModel(): string {
    return this.useOllama ? this.ollamaModel : "gemini-2.5-flash-lite";
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    this.useOllama = true;
    if (url) this.ollamaUrl = url;
    
    if (model) {
      this.ollamaModel = model;
    } else {
      // Auto-detect first available model
      await this.initializeOllamaModel();
    }
    
    console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel} at ${this.ollamaUrl}`);
  }

  public async switchToGemini(apiKey?: string): Promise<void> {
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      this.model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    }
    
    if (!this.model && !apiKey) {
      throw new Error("No Gemini API key provided and no existing model instance");
    }
    
    this.useOllama = false;
    console.log("[LLMHelper] Switched to Gemini");
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.useOllama) {
        const available = await this.checkOllamaAvailable();
        if (!available) {
          return { success: false, error: `Ollama not available at ${this.ollamaUrl}` };
        }
        // Test with a simple prompt
        await this.callOllama("Hello");
        return { success: true };
      } else {
        if (!this.model) {
          return { success: false, error: "No Gemini model configured" };
        }
        // Test with a simple prompt
        const result = await this.model.generateContent("Hello");
        const response = await result.response;
        const text = response.text(); // Ensure the response is valid
        if (text) {
          return { success: true };
        } else {
          return { success: false, error: "Empty response from Gemini" };
        }
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
} 
