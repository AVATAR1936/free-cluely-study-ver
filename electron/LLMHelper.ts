// electron/LLMHelper.ts
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"
import fs from "fs"
import { TranscriptionHelper } from "./TranscriptionHelper"

interface OllamaResponse {
  response: string
  done: boolean
}

type MeetingProcessingMode = "auto" | "gemini" | "local"

interface ProcessMeetingAudioOptions {
  mode?: MeetingProcessingMode
  allowLongTranscription?: boolean
  geminiApiKey?: string
  transcriptionOverride?: string
}

interface MeetingProcessingResult {
  success: boolean
  transcription: string
  notes: string
  tokenCount?: number
  requiresAction?: "confirm-long-transcription" | "provide-gemini-api-key"
  error?: string
}

export class LLMHelper {
  private model: GenerativeModel | null = null
  private readonly systemPrompt = `You are Wingman AI, a helpful, proactive assistant for any kind of problem or situation (not just coding). For any user input, analyze the situation, provide a clear problem statement, relevant context, and suggest several possible responses or actions the user could take next. Always explain your reasoning. Present your suggestions as a list of options or next steps.`
  private useOllama: boolean = false
  private ollamaModel: string = "gemma3:12b"
  private ollamaUrl: string = "http://localhost:11434"
  private ollamaInitializationPromise: Promise<void> | null = null
  private transcriptionHelper: TranscriptionHelper;
  private readonly transcriptionTokenThreshold = 10000;

  constructor(apiKey?: string, useOllama: boolean = false, ollamaModel?: string, ollamaUrl?: string) {
    this.useOllama = useOllama
    
    if (useOllama) {
      this.ollamaUrl = ollamaUrl || "http://localhost:11434"
      this.ollamaModel = ollamaModel || "gemma:latest" // Default fallback
      console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)
      
      // Auto-detect and use first available model if specified model doesn't exist
      this.ollamaInitializationPromise = this.initializeOllamaModel()
    } else if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey)
      this.model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" })
      console.log("[LLMHelper] Using Google Gemini")
    } else {
      throw new Error("Either provide Gemini API key or enable Ollama mode")
    }
    this.transcriptionHelper = new TranscriptionHelper();
  }

  private createGeminiModel(apiKey: string): GenerativeModel {
    const genAI = new GoogleGenerativeAI(apiKey)
    return genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" })
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
            temperature: 0.7,
            top_p: 0.9,
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
      const availableModels = await this.fetchOllamaModels()
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
        const models = await this.fetchOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError) {
        console.error(`[LLMHelper] Fallback also failed: ${fallbackError.message}`)
      }
    }
  }

  private async ensureOllamaModelInitialized(): Promise<void> {
    if (!this.ollamaInitializationPromise) {
      this.ollamaInitializationPromise = this.initializeOllamaModel().catch((error) => {
        this.ollamaInitializationPromise = null
        throw error
      })
    }

    await this.ollamaInitializationPromise
  }

  private estimateUkrainianTokens(text: string): number {
    // Приближенная оценка: слова + знаки препинания/символы.
    const wordLike = text.match(/[\p{L}\p{N}_'-]+/gu) ?? []
    const punctuation = text.match(/[^\s\p{L}\p{N}_'-]/gu) ?? []
    return wordLike.length + punctuation.length
  }

  private buildMeetingPrompt(transcription: string): string {
    return `
        Ти — професійний технічний асистент, що спеціалізується на створенні стислих та структурованих конспектів лекцій та технічних зустрічей. 

        Твоє завдання: опрацювати транскрипцію та перетворити її на логічний конспект.

        ### ПРАВИЛА ОФОРМЛЕННЯ:
        1. СТИЛЬ: Жодних есе. Використовуй лише короткі тези, марковані списки та чіткі визначення.
        2. МАТЕМАТИКА: Усі формули, змінні та математичні вирази обов'язково пиши у форматі LaTeX (наприклад, $R = \sum p_i \times v_i$).
        3. СТРУКТУРА: 
          - Виділяй логічні блоки жирними заголовками (##).
          - Кожну окрему думку пиши з нового рядка з булетом (*).
          - Використовуй жирний шрифт для ключових термінів.
        4. МОВА: Відповідай ВИКЛЮЧНО українською мовою.

        ### АЛГОРИТМ ОПРАЦЮВАННЯ:
        1. Класифікація понять: Виділи основні терміни, їхні види та ознаки.
        2. Формалізація: Якщо в тексті є опис розрахунків або моделей, виведи їх у вигляді формул.
        3. Сценарії/Приклади: Якщо згадуються конкретні випадки або умови (як-от сценарії ризику), винеси їх окремим блоком.
        4. Action Items: Тільки якщо в тексті є конкретні доручення чи плани.

        Текст транскрипції:
        """
        ${transcription}
        """
        
        Надай результат у вигляді чистого конспекту без вступних фраз типу "Ось ваш конспект".
      `
  }

  private async summarizeTranscription(
    transcription: string,
    mode: MeetingProcessingMode,
    geminiApiKey?: string
  ): Promise<string> {
    const prompt = this.buildMeetingPrompt(transcription)

    if (mode === "local") {
      await this.ensureOllamaModelInitialized()
      return this.callOllama(prompt)
    }

    if (mode === "gemini") {
      const geminiModel = this.model ?? (geminiApiKey ? this.createGeminiModel(geminiApiKey) : null)
      if (!geminiModel) {
        throw new Error("GEMINI_API_KEY_REQUIRED")
      }
      if (!this.model && geminiApiKey) {
        this.model = geminiModel
      }
      const result = await geminiModel.generateContent(prompt)
      const response = await result.response
      return response.text()
    }

    return this.chatWithGemini(prompt)
  }

  public async processMeetingAudio(audioBuffer: Buffer, options: ProcessMeetingAudioOptions = {}): Promise<MeetingProcessingResult> {
    try {
      console.log("[LLMHelper] Starting meeting processing...");

      // 1. Транскрибация (локально через Whisper)
      const transcription = options.transcriptionOverride ?? await this.transcriptionHelper.transcribeAudio(audioBuffer);
      
      if (!transcription || transcription.trim().length === 0) {
        return { 
            success: false, 
            transcription: "", 
            notes: "", 
            error: "Whisper не смог распознать речь или запись пустая." 
        };
      }

      console.log("[LLMHelper] Transcription complete. Length:", transcription.length);
      const tokenCount = this.estimateUkrainianTokens(transcription)

      if (tokenCount > this.transcriptionTokenThreshold && !options.allowLongTranscription) {
        return {
          success: false,
          transcription,
          notes: "",
          tokenCount,
          requiresAction: "confirm-long-transcription"
        }
      }

      const mode = options.mode ?? "auto"
      if (mode === "gemini" && !this.model && !options.geminiApiKey) {
        return {
          success: false,
          transcription,
          notes: "",
          tokenCount,
          requiresAction: "provide-gemini-api-key",
          error: "Для обробки через Gemini потрібен API ключ."
        }
      }

      const notes = await this.summarizeTranscription(transcription, mode, options.geminiApiKey)

      return {
        success: true,
        transcription,
        notes,
        tokenCount
      };

    } catch (error: any) {
      console.error("[LLMHelper] Error processing meeting:", error);
      return { 
          success: false, 
          transcription: "", 
          notes: "", 
          error: error.message 
      };
    }
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

  private async fetchOllamaModels(): Promise<string[]> {
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

  public async getOllamaModels(): Promise<string[]> {
    if (!this.useOllama) return [];
    return this.fetchOllamaModels();
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
