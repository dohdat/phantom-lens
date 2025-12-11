import { GoogleGenerativeAI } from "@google/generative-ai";
import { IProcessingHelperDeps } from "./main";
import { ScreenshotHelper } from "./ScreenshotHelper";
import fs from "node:fs";
import process from "process";
import sharp from "sharp";

// Image optimization settings
const IMAGE_MAX_WIDTH = 1920;
const IMAGE_MAX_HEIGHT = 1080;
const IMAGE_QUALITY = 80; // JPEG quality (0-100)

export class ProcessingHelper {
  private deps: IProcessingHelperDeps;
  private screenshotHelper: ScreenshotHelper;
  private isCurrentlyProcessing: boolean = false;
  private previousResponse: string | null = null; // Store previous response for context

  // ============================================================================
  // BUG FIX: Enhanced AbortController Management
  // ============================================================================
  private currentProcessingAbortController: AbortController | null = null;
  private currentExtraProcessingAbortController: AbortController | null = null;
  private processingTimeouts: Set<NodeJS.Timeout> = new Set(); // Track all timeouts

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps;
    this.screenshotHelper = deps.getScreenshotHelper();
  }

  // ============================================================================
  // BUG FIX: Safe AbortController Creation and Cleanup
  // ============================================================================
  private createAbortController(type: 'main' | 'extra'): AbortController {
    // Clean up existing controller first
    this.safeAbortController(type === 'main' ? this.currentProcessingAbortController : this.currentExtraProcessingAbortController);
    
    const controller = new AbortController();
    
    if (type === 'main') {
      this.currentProcessingAbortController = controller;
    } else {
      this.currentExtraProcessingAbortController = controller;
    }
    
    // Set up timeout protection to prevent hanging requests
    const timeoutId = setTimeout(() => {
      this.safeAbortController(controller);
    }, 120000); // 2 minute timeout
    
    this.processingTimeouts.add(timeoutId);
    
    return controller;
  }

  private safeAbortController(controller: AbortController | null): void {
    if (!controller) return;
    
    try {
      if (!controller.signal.aborted) {
        // Wrap abort in additional try-catch to prevent uncaught exceptions
        // from abort event listeners that might throw
        try {
          controller.abort();
        } catch (abortError: any) {
          // If abort throws (e.g., from event listeners), catch it here
          // This prevents uncaught exceptions when canceling requests
          if (abortError?.message !== "Request aborted" && abortError?.name !== "AbortError") {
            console.warn("Error during abort (non-fatal):", abortError);
          }
          // Silently ignore abort errors - they're expected when canceling
        }
      }
    } catch (error) {
      // Silently handle abort errors - they're expected when canceling
      console.warn("Error aborting request controller (this is usually safe to ignore):", error);
    }
  }

  private clearProcessingTimeouts(): void {
    this.processingTimeouts.forEach(timeout => {
      try {
        clearTimeout(timeout);
      } catch (error) {
        console.warn("Error clearing timeout:", error);
      }
    });
    this.processingTimeouts.clear();
  }

  /**
   * Optimize an image buffer for sending to Gemini API
   * Resizes to max dimensions and converts to JPEG for smaller file size
   */
  private async optimizeImage(imageBuffer: Buffer): Promise<{ data: string; mimeType: string }> {
    try {
      const optimized = await sharp(imageBuffer)
        .resize(IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: IMAGE_QUALITY })
        .toBuffer();
      
      const originalSize = imageBuffer.length;
      const optimizedSize = optimized.length;
      const savings = ((originalSize - optimizedSize) / originalSize * 100).toFixed(1);
      console.log(`[ImageOptimization] Optimized: ${(originalSize / 1024).toFixed(1)}KB -> ${(optimizedSize / 1024).toFixed(1)}KB (${savings}% smaller)`);
      
      return {
        data: optimized.toString("base64"),
        mimeType: "image/jpeg"
      };
    } catch (error) {
      console.warn("[ImageOptimization] Failed to optimize image, using original:", error);
      // Fallback to original PNG if optimization fails
      return {
        data: imageBuffer.toString("base64"),
        mimeType: "image/png"
      };
    }
  }

  /**
   * Check if a Groq model is the configured vision model
   * This dynamically checks against the actual vision model setting
   */
  private async isGroqVisionModel(model: string): Promise<boolean> {
    try {
      const visionModel = await this.deps.getVisionModel();
      return visionModel === model;
    } catch {
      // Fallback to hardcoded list if settings unavailable
      const knownVisionModels = [
        "meta-llama/llama-4-scout-17b-16e-instruct"
      ];
      return knownVisionModels.includes(model);
    }
  }

  /**
   * Call Groq API with text prompt and optional images
   */
  private async callGroqAPI(
    prompt: string,
    apiKey: string,
    model: string,
    signal: AbortSignal,
    onChunk?: (text: string) => void,
    base64Images?: string[]
  ): Promise<string> {
    // Build message content based on whether images are provided
    const isVisionModel = await this.isGroqVisionModel(model);
    let messageContent: any;
    if (base64Images && base64Images.length > 0 && isVisionModel) {
      // Groq vision models (like llama-4-scout-17b-16e-instruct) support up to 5 images
      const imagesToSend = base64Images.slice(-5);
      // Multi-modal content with images
      messageContent = [
        {
          type: 'text',
          text: prompt
        },
        ...imagesToSend.map(imageData => ({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${imageData}`
          }
        }))
      ];
    } else {
      // Text-only content
      messageContent = prompt;
    }

    // Get configurable parameters from environment or use defaults
    const maxCompletionTokens = parseInt(process.env.MAX_COMPLETION_TOKENS || "8192");
    const reasoningEffort = process.env.REASONING_EFFORT || "medium";

    // Build request body - only include reasoning_effort for non-vision models
    const requestBody: any = {
      model: model,
      messages: [
        {
          role: 'user',
          content: messageContent
        }
      ],
      temperature: 1,
      max_completion_tokens: maxCompletionTokens,
      top_p: 1,
      stream: true
    };

    // Only add reasoning_effort for non-vision models (text/reasoning models)
    if (!isVisionModel) {
      requestBody.reasoning_effort = reasoningEffort;
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal
    });

    if (!response.ok) {
      let detail = '';
      try {
        const errJson = await response.json();
        detail = errJson?.error?.message || JSON.stringify(errJson);
      } catch (e) {
        detail = response.statusText;
      }
      throw new Error(`Groq API error: HTTP ${response.status} ${detail}`);
    }

    // Handle streaming response
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body from Groq API');
    }

    const decoder = new TextDecoder();
    let fullText = '';
    let bufferedLine = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Accumulate partial lines to avoid losing tokens when JSON splits across chunks
        bufferedLine += decoder.decode(value, { stream: true });
        const lines = bufferedLine.split('\n');
        bufferedLine = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;

          const data = line.replace(/^data:\s*/, '');
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              if (onChunk) {
                onChunk(content);
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      // Flush any remaining buffered data after the stream ends
      const finalLine = bufferedLine.trim();
      if (finalLine.startsWith('data:')) {
        const data = finalLine.replace(/^data:\s*/, '');
        if (data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              if (onChunk) {
                onChunk(content);
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return fullText;
  }

  /**
   * Analyze screenshots with the vision model (Llama) and return descriptions
   * This is used for two-step processing: vision analysis -> text generation
   */
  private async analyzeScreenshotsWithVision(
    base64Images: string[],
    apiKey: string,
    visionModel: string,
    signal: AbortSignal,
    userPrompt?: string
  ): Promise<string> {
    console.log(`[VisionAnalysis] Analyzing ${base64Images.length} screenshot(s) with ${visionModel}`);
    
    // Build analysis prompt
    const analysisPromptLines = [
      "# Screenshot Analysis Task",
      "",
      "Analyze the provided screenshot(s) and describe what you see in detail.",
      "Focus on:",
      "- Text content visible on screen",
      "- UI elements and their states",
      "- Important information being displayed",
      "- Any notable patterns or data",
      "",
      "Be comprehensive but concise. Your analysis will be used by another AI to generate a response.",
    ];

    if (userPrompt && userPrompt.trim().length > 0) {
      analysisPromptLines.push(
        "",
        "## Additional Context",
        userPrompt.trim()
      );
    }

    const analysisPrompt = analysisPromptLines.join("\n");

    // Use Groq API to analyze screenshots
    const description = await this.callGroqAPI(
      analysisPrompt,
      apiKey,
      visionModel,
      signal,
      undefined, // No streaming callback for analysis
      base64Images
    );

    console.log(`[VisionAnalysis] Analysis completed, ${description.length} characters`);
    return description;
  }

  public async processScreenshots(): Promise<void> {
    if (this.isCurrentlyProcessing) {
      console.log("Processing already in progress. Skipping duplicate call.");
      return;
    }

    this.isCurrentlyProcessing = true;
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow) {
      this.isCurrentlyProcessing = false;
      return;
    }

    try {
      const view = this.deps.getView();

      if (view === "initial") {
        // PERFORMANCE: Set properties once before processing starts
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setSkipTaskbar(true);
          mainWindow.setFocusable(false);
          mainWindow.setIgnoreMouseEvents(true);
          if (mainWindow.isFocused()) {
            mainWindow.blur();
          }
        }
        
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);
        
        const screenshotQueue = this.screenshotHelper.getScreenshotQueue();
        
        try {
          // Create abort controller with enhanced management
          const abortController = this.createAbortController('main');
          const { signal } = abortController;

          const screenshots = await Promise.all(
            screenshotQueue.map(async (path) => ({
              path,
              data: fs.readFileSync(path).toString("base64"),
            }))
          );

          // Validate base64 data before processing
          const validScreenshots = screenshots.filter((screenshot, index) => {
            const { data } = screenshot;
            if (!data || typeof data !== 'string') {
              console.warn(`[INITIAL] Invalid image data at index ${index}:`, typeof data);
              return false;
            }
            
            // Check if it's a valid base64 string
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
              console.warn(`[INITIAL] Invalid base64 format at index ${index}`);
              return false;
            }
            
            // Check minimum length (base64 should be reasonably long)
            if (data.length < 100) {
              console.warn(`[INITIAL] Base64 data too short at index ${index}: ${data.length} chars`);
              return false;
            }
            
            return true;
          });

          if (validScreenshots.length === 0) {
            throw new Error("No valid screenshot data available for processing");
          }

          const result = await this.processScreenshotsHelper(
            validScreenshots,
            signal
          );

          if (!result.success) {
            const errorMessage =
              result.error || "Failed to generate response. Please try again.";
            const normalizedError = errorMessage.toLowerCase();
            const isApiKeyError = normalizedError.includes("api key not found");
            const isRateLimitError =
              normalizedError.includes("429") ||
              normalizedError.includes("resource exhausted") ||
              normalizedError.includes("too many requests");

            console.log("Processing failed:", errorMessage);

            if (isApiKeyError) {
              mainWindow.webContents.send(
                this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
                "API key not found. Please set your API key in settings."
              );
              console.log("Resetting view to queue due to API key error");
              this.deps.setView("initial");
            } else {
              mainWindow.webContents.send(
                this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
                errorMessage
              );

              if (isRateLimitError) {
                console.log(
                  "Rate limit encountered. Keeping response view active for retry."
                );
                this.deps.setView("response");
              } else {
                console.log("Resetting view to queue due to error");
                this.deps.setView("initial");
              }
            }
            return;
          }

          // Only set view to response if processing succeeded
          console.log("Setting view to response after successful processing");
          // Save to local history (main export)
          try {
            const main = require("./main");
            main.saveResponseToHistory?.(result.data);
          } catch {}
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: result.data });
          this.deps.setView("response");
        } catch (error: any) {
          console.error("Processing error:", error);
          
          if (error.message === "Request aborted" || error.name === "AbortError") {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
              "Processing was canceled by the user."
            );
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
              error.message || "Server error. Please try again."
            );
          }
          // Reset view back to queue on error
          console.log("Resetting view to queue due to error");
          this.deps.setView("initial");
        } finally {
          this.currentProcessingAbortController = null;
        }
      } else {
        // view == 'response' - follow-up processing
        const extraScreenshotQueue =
          this.screenshotHelper.getExtraScreenshotQueue();
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.FOLLOW_UP_START
        );

        // Create abort controller with enhanced management
        const abortController = this.createAbortController('extra');
        const { signal } = abortController;

        try {
          const screenshots = await Promise.all(
            [
              ...this.screenshotHelper.getScreenshotQueue(),
              ...extraScreenshotQueue,
            ].map(async (path) => ({
              path,
              data: fs.readFileSync(path).toString("base64"),
            }))
          );

          const result = await this.processExtraScreenshotsHelper(
            screenshots,
            signal,
            "" // No user prompt for main processing
          );

          if (result.success && 'data' in result) {
            this.deps.setHasFollowedUp(true);
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.FOLLOW_UP_SUCCESS,
              { response: result.data }
            );
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.FOLLOW_UP_ERROR,
              result.error
            );
          }
        } catch (error: any) {
          if (error.message === "Request aborted" || error.name === "AbortError") {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.FOLLOW_UP_ERROR,
              "Extra processing was canceled by the user."
            );
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.FOLLOW_UP_ERROR,
              error.message
            );
          }
        } finally {
          this.currentExtraProcessingAbortController = null;
        }
      }
    } finally {
      this.isCurrentlyProcessing = false; // Ensure flag is reset
      this.clearProcessingTimeouts(); // Clean up any timeouts
    }
  }

  /**
   * Process audio transcript without screenshots - text-only route to Gemini
   * This is used for meeting assistant to avoid sending screenshots with audio
   */
  public async processAudioTranscript(prompt: string): Promise<void> {
    if (this.isCurrentlyProcessing) {
      console.log("Processing already in progress. Skipping audio transcript call.");
      return;
    }

    this.isCurrentlyProcessing = true;
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow) {
      this.isCurrentlyProcessing = false;
      return;
    }

    try {
      // PERFORMANCE: Set properties before processing starts
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setSkipTaskbar(true);
        mainWindow.setFocusable(false);
        mainWindow.setIgnoreMouseEvents(true);
        if (mainWindow.isFocused()) {
          mainWindow.blur();
        }
      }

      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);

      // Create abort controller
      const abortController = this.createAbortController('main');
      const { signal } = abortController;

      try {
        const result = await this.processAudioTranscriptHelper(prompt, signal);

        if (!result.success) {
          const errorMessage = result.error || "Failed to generate response. Please try again.";
          console.log("Audio processing failed:", errorMessage);
          
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
            errorMessage
          );
          this.deps.setView("initial");
          return;
        }

        // Success - set view to response
        console.log("Setting view to response after successful audio processing");
        try {
          const main = require("./main");
          main.saveResponseToHistory?.(result.data);
        } catch {}
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: result.data });
        this.deps.setView("response");
      } catch (error: any) {
        console.error("Audio processing error:", error);

        if (error.message === "Request aborted" || error.name === "AbortError") {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
            "Processing was canceled by the user."
          );
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
            error.message || "Server error. Please try again."
          );
        }
        this.deps.setView("initial");
      } finally {
        this.currentProcessingAbortController = null;
      }
    } finally {
      this.isCurrentlyProcessing = false;
      this.clearProcessingTimeouts();
    }
  }

  /**
   * Process audio transcript WITH screenshot - uses audio prompt (not system prompt)
   * This sends the audio prompt along with a screenshot to Gemini
   */
  public async processAudioWithScreenshot(prompt: string): Promise<void> {
    if (this.isCurrentlyProcessing) {
      console.log("Processing already in progress. Skipping audio+screenshot call.");
      return;
    }

    this.isCurrentlyProcessing = true;
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow) {
      this.isCurrentlyProcessing = false;
      return;
    }

    try {
      // PERFORMANCE: Set properties before processing starts
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setSkipTaskbar(true);
        mainWindow.setFocusable(false);
        mainWindow.setIgnoreMouseEvents(true);
        if (mainWindow.isFocused()) {
          mainWindow.blur();
        }
      }

      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);

      // Create abort controller
      const abortController = this.createAbortController('main');
      const { signal } = abortController;

      try {
        const result = await this.processAudioWithScreenshotHelper(prompt, signal);

        if (!result.success) {
          const errorMessage = result.error || "Failed to generate response. Please try again.";
          console.log("Audio+screenshot processing failed:", errorMessage);
          
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
            errorMessage
          );
          this.deps.setView("initial");
          return;
        }

        // Success - set view to response
        console.log("Setting view to response after successful audio+screenshot processing");
        try {
          const main = require("./main");
          main.saveResponseToHistory?.(result.data);
        } catch {}
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: result.data });
        this.deps.setView("response");
      } catch (error: any) {
        console.error("Audio+screenshot processing error:", error);

        if (error.message === "Request aborted" || error.name === "AbortError") {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
            "Processing was canceled by the user."
          );
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
            error.message || "Server error. Please try again."
          );
        }
        this.deps.setView("initial");
      } finally {
        this.currentProcessingAbortController = null;
      }
    } finally {
      this.isCurrentlyProcessing = false;
      this.clearProcessingTimeouts();
    }
  }
  /**
   * Helper to process audio transcript with Gemini or Groq - text only, no images
   */
  private async processAudioTranscriptHelper(
    prompt: string,
    signal: AbortSignal
  ): Promise<{ success: boolean; data?: string; error?: string }> {
    let responseText = "";
    let chunksSent = false;
    let accumulatedText = "";

    try {
      const apiKey = process.env.API_KEY;
      const model = await this.deps.getAudioOnlyModel();
      const provider = process.env.API_PROVIDER || "gemini";

      if (!apiKey) {
        throw new Error("API key not found. Please configure it in settings.");
      }

      const mainWindow = this.deps.getMainWindow();

      if (signal.aborted) throw new Error("Request aborted");

      const abortHandler = () => {};
      signal.addEventListener("abort", abortHandler);

      try {
        if (provider === "groq") {
          // Use Groq API for text-only processing
          console.log(`[Groq] Processing audio transcript with model: ${model}`);
          
          accumulatedText = "";
          let pendingBuffer = "";
          let lastSentLength = 0;
          const FLUSH_INTERVAL = 200;
          let lastFlushTime = Date.now();
          
          const isParagraphBoundary = (text: string, pos: number): boolean => {
            // Check for double newline (paragraph break)
            if (pos > 0 && text[pos] === '\n' && text[pos - 1] === '\n') {
              return true;
            }
            return false;
          };
          
          const flushToUI = (force: boolean = false) => {
            const now = Date.now();
            const timeSinceLastFlush = now - lastFlushTime;
            
            if (pendingBuffer.length > 0 && (force || timeSinceLastFlush >= FLUSH_INTERVAL)) {
              let flushUpTo = pendingBuffer.length;
              
              if (!force) {
                // Look for the last paragraph boundary (double newline)
                for (let i = pendingBuffer.length - 1; i >= 1; i--) {
                  if (isParagraphBoundary(pendingBuffer, i)) {
                    flushUpTo = i + 1;
                    break;
                  }
                }
                // If no paragraph boundary found and buffer is small, don't flush yet
                if (flushUpTo === pendingBuffer.length && pendingBuffer.length < 100) {
                  return;
                }
              }
              
              const toFlush = pendingBuffer.slice(0, flushUpTo);
              accumulatedText += toFlush;
              pendingBuffer = pendingBuffer.slice(flushUpTo);
              
              if (mainWindow && !mainWindow.isDestroyed() && accumulatedText.length > lastSentLength) {
                chunksSent = true;
                mainWindow.webContents.send(
                  this.deps.PROCESSING_EVENTS.RESPONSE_CHUNK,
                  { response: accumulatedText }
                );
                lastSentLength = accumulatedText.length;
                lastFlushTime = now;
              }
            }
          };

          await this.callGroqAPI(prompt, apiKey, model, signal, (chunk) => {
            pendingBuffer += chunk;
            flushToUI(false);
          });
          
          flushToUI(true);
          responseText = accumulatedText;
        } else {
          // Use Gemini API for text-only processing
          const genAI = new GoogleGenerativeAI(apiKey);
          const geminiModelId = model.startsWith("gemini-") ? `models/${model}` : model;
          const geminiModel = genAI.getGenerativeModel({ model: geminiModelId });

          // Stream the response with paragraph-buffering - TEXT ONLY, no images
          const result = await geminiModel.generateContentStream([prompt]);

          accumulatedText = "";
          let pendingBuffer = "";
          let lastSentLength = 0;
          const FLUSH_INTERVAL = 200;
          let lastFlushTime = Date.now();
          
          const isParagraphBoundary = (text: string, pos: number): boolean => {
            // Check for double newline (paragraph break)
            if (pos > 0 && text[pos] === '\n' && text[pos - 1] === '\n') {
              return true;
            }
            return false;
          };
          
          const flushToUI = (force: boolean = false) => {
            const now = Date.now();
            const timeSinceLastFlush = now - lastFlushTime;
            
            if (pendingBuffer.length > 0 && (force || timeSinceLastFlush >= FLUSH_INTERVAL)) {
              let flushUpTo = pendingBuffer.length;
              
              if (!force) {
                // Look for the last paragraph boundary (double newline)
                for (let i = pendingBuffer.length - 1; i >= 1; i--) {
                  if (isParagraphBoundary(pendingBuffer, i)) {
                    flushUpTo = i + 1;
                    break;
                  }
                }
                // If no paragraph boundary found and buffer is small, don't flush yet
                if (flushUpTo === pendingBuffer.length && pendingBuffer.length < 100) {
                  return;
                }
              }
              
              const toFlush = pendingBuffer.slice(0, flushUpTo);
              accumulatedText += toFlush;
              pendingBuffer = pendingBuffer.slice(flushUpTo);
              
              if (mainWindow && !mainWindow.isDestroyed() && accumulatedText.length > lastSentLength) {
                chunksSent = true;
                mainWindow.webContents.send(
                  this.deps.PROCESSING_EVENTS.RESPONSE_CHUNK,
                  { response: accumulatedText }
                );
                lastSentLength = accumulatedText.length;
                lastFlushTime = now;
              }
            }
          };

          for await (const chunk of result.stream) {
            if (signal.aborted) {
              throw new Error("Request aborted");
            }

            const chunkText = chunk.text();
            pendingBuffer += chunkText;
            flushToUI(false);
          }
          
          flushToUI(true);
          responseText = accumulatedText;
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            const main = require("./main");
            main.saveResponseToHistory?.(responseText);
          } catch {}
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: responseText });
        }

        return { success: true, data: responseText };
      } finally {
        try {
          signal.removeEventListener("abort", abortHandler);
        } catch (e) {}
      }
    } catch (error: any) {
      const mainWindow = this.deps.getMainWindow();
      console.error("Audio response generation error:", {
        message: error.message,
        chunksSent,
      });

      if (chunksSent) {
        console.log("Chunks were already sent - allowing partial response");
        if (mainWindow && !mainWindow.isDestroyed() && accumulatedText) {
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: accumulatedText });
        }
        return { success: true, data: accumulatedText || "" };
      }

      if (error.message === "Request aborted" || error.name === "AbortError") {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
            "Audio response generation canceled."
          );
        }
        return { success: false, error: "Response generation canceled." };
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
          error.message || "Server error during audio response generation."
        );
      }
      this.deps.setView("initial");
      return { success: false, error: error.message || "Unknown error" };
    }
  }

  /**
   * Helper to process audio transcript with screenshot - uses audio prompt directly
   */
  private async processAudioWithScreenshotHelper(
    prompt: string,
    signal: AbortSignal
  ): Promise<{ success: boolean; data?: string; error?: string }> {
    let responseText = "";
    let chunksSent = false;
    let accumulatedText = "";

    try {
      const apiKey = process.env.API_KEY;
      const model = await this.deps.getAudioScreenshotModel();
      const provider = process.env.API_PROVIDER || "gemini";

      if (!apiKey) {
        throw new Error("API key not found. Please configure it in settings.");
      }

      // Get screenshots from queue
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue();
      if (screenshotQueue.length === 0) {
        console.log("[AudioWithScreenshot] No screenshots in queue, proceeding without image");
      }

      // Read and optimize screenshots
      const optimizedScreenshots = await Promise.all(
        screenshotQueue.map(async (filePath) => {
          const buffer = fs.readFileSync(filePath);
          return this.optimizeImage(buffer);
        })
      );

      // Check if we should use two-step processing (vision -> text)
      const visionModel = await this.deps.getVisionModel();
      const textModel = await this.deps.getTextModel();
      const useTwoStepProcessing = provider === "groq" && 
                                    optimizedScreenshots.length > 0 &&
                                    visionModel && textModel && 
                                    visionModel !== textModel;

      if (useTwoStepProcessing) {
        // TWO-STEP PROCESSING: Vision model analyzes screenshots, text model generates response
        console.log(`[AudioScreenshot-TwoStep] Using vision: ${visionModel}, text: ${textModel}`);
        
        const mainWindow = this.deps.getMainWindow();
        if (signal.aborted) throw new Error("Request aborted");

        // Step 1: Analyze screenshots with vision model
        const base64Images = optimizedScreenshots.map(s => s.data);
        const screenshotDescription = await this.analyzeScreenshotsWithVision(
          base64Images,
          apiKey,
          visionModel,
          signal
        );

        if (signal.aborted) throw new Error("Request aborted");

        // Step 2: Combine audio transcript with screenshot analysis for text model
        const combinedPrompt = `${prompt}\n\n## Screenshot Analysis\nThe following describes what was visible on screen:\n\n${screenshotDescription}`;

        const abortHandler = () => {};
        signal.addEventListener("abort", abortHandler);

        try {
          accumulatedText = "";
          let pendingBuffer = "";
          let lastSentLength = 0;
          const FLUSH_INTERVAL = 200;
          let lastFlushTime = Date.now();
          
          const isParagraphBoundary = (text: string, pos: number): boolean => {
            // Check for double newline (paragraph break)
            if (pos > 0 && text[pos] === '\n' && text[pos - 1] === '\n') {
              return true;
            }
            return false;
          };
          
          const flushToUI = (force: boolean = false) => {
            const now = Date.now();
            const timeSinceLastFlush = now - lastFlushTime;
            
            if (pendingBuffer.length > 0 && (force || timeSinceLastFlush >= FLUSH_INTERVAL)) {
              let flushUpTo = pendingBuffer.length;
              
              if (!force) {
                // Look for the last paragraph boundary (double newline)
                for (let i = pendingBuffer.length - 1; i >= 1; i--) {
                  if (isParagraphBoundary(pendingBuffer, i)) {
                    flushUpTo = i + 1;
                    break;
                  }
                }
                // If no paragraph boundary found and buffer is small, don't flush yet
                if (flushUpTo === pendingBuffer.length && pendingBuffer.length < 100) {
                  return;
                }
              }
              
              const toFlush = pendingBuffer.slice(0, flushUpTo);
              accumulatedText += toFlush;
              pendingBuffer = pendingBuffer.slice(flushUpTo);
              
              if (mainWindow && !mainWindow.isDestroyed() && accumulatedText.length > lastSentLength) {
                chunksSent = true;
                mainWindow.webContents.send(
                  this.deps.PROCESSING_EVENTS.RESPONSE_CHUNK,
                  { response: accumulatedText }
                );
                lastSentLength = accumulatedText.length;
                lastFlushTime = now;
              }
            }
          };

          // Call text model without images
          await this.callGroqAPI(combinedPrompt, apiKey, textModel, signal, (chunk) => {
            pendingBuffer += chunk;
            flushToUI(false);
          });
          
          flushToUI(true);
          responseText = accumulatedText;

          this.screenshotHelper.clearExtraScreenshotQueue();

          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              const main = require("./main");
              main.saveResponseToHistory?.(responseText);
            } catch {}
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: responseText });
          }

          return { success: true, data: responseText };
        } finally {
          try {
            signal.removeEventListener("abort", abortHandler);
          } catch (e) {}
        }
      }

      // Check if using Groq with a non-vision model (without two-step)
      if (provider === "groq" && !(await this.isGroqVisionModel(model))) {
        throw new Error(`Groq model ${model} does not support image analysis. Please use a vision model or enable two-step processing with separate vision/text models.`);
      }

      if (provider === "groq") {
        // Use Groq API for audio with screenshots
        console.log(`[Groq] Processing audio with screenshots using vision model: ${model}`);
        
        const mainWindow = this.deps.getMainWindow();
        if (signal.aborted) throw new Error("Request aborted");

        const abortHandler = () => {};
        signal.addEventListener("abort", abortHandler);

        try {
          accumulatedText = "";
          let pendingBuffer = "";
          let lastSentLength = 0;
          const FLUSH_INTERVAL = 200;
          let lastFlushTime = Date.now();
          
          const isParagraphBoundary = (text: string, pos: number): boolean => {
            // Check for double newline (paragraph break)
            if (pos > 0 && text[pos] === '\n' && text[pos - 1] === '\n') {
              return true;
            }
            return false;
          };
          
          const flushToUI = (force: boolean = false) => {
            const now = Date.now();
            const timeSinceLastFlush = now - lastFlushTime;
            
            if (pendingBuffer.length > 0 && (force || timeSinceLastFlush >= FLUSH_INTERVAL)) {
              let flushUpTo = pendingBuffer.length;
              
              if (!force) {
                // Look for the last paragraph boundary (double newline)
                for (let i = pendingBuffer.length - 1; i >= 1; i--) {
                  if (isParagraphBoundary(pendingBuffer, i)) {
                    flushUpTo = i + 1;
                    break;
                  }
                }
                // If no paragraph boundary found and buffer is small, don't flush yet
                if (flushUpTo === pendingBuffer.length && pendingBuffer.length < 100) {
                  return;
                }
              }
              
              const toFlush = pendingBuffer.slice(0, flushUpTo);
              accumulatedText += toFlush;
              pendingBuffer = pendingBuffer.slice(flushUpTo);
              
              if (mainWindow && !mainWindow.isDestroyed() && accumulatedText.length > lastSentLength) {
                chunksSent = true;
                mainWindow.webContents.send(
                  this.deps.PROCESSING_EVENTS.RESPONSE_CHUNK,
                  { response: accumulatedText }
                );
                lastSentLength = accumulatedText.length;
                lastFlushTime = now;
              }
            }
          };

          const base64Images = optimizedScreenshots.map(s => s.data);
          await this.callGroqAPI(prompt, apiKey, model, signal, (chunk) => {
            pendingBuffer += chunk;
            flushToUI(false);
          }, base64Images);
          
          flushToUI(true);
          responseText = accumulatedText;

          this.screenshotHelper.clearExtraScreenshotQueue();

          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              const main = require("./main");
              main.saveResponseToHistory?.(responseText);
            } catch {}
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: responseText });
          }

          return { success: true, data: responseText };
        } finally {
          try {
            signal.removeEventListener("abort", abortHandler);
          } catch (e) {}
        }
      }

      // Gemini processing
      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModelId = model.startsWith("gemini-") ? `models/${model}` : model;
      const geminiModel = genAI.getGenerativeModel({ model: geminiModelId });

      const mainWindow = this.deps.getMainWindow();

      if (signal.aborted) throw new Error("Request aborted");

      const abortHandler = () => {};
      signal.addEventListener("abort", abortHandler);

      try {
        // Build content parts - audio prompt + optimized images
        const contentParts: any[] = [prompt];
        
        // Add optimized images if available
        if (optimizedScreenshots.length > 0) {
          const imageParts = optimizedScreenshots.map((screenshot) => ({
            inlineData: {
              mimeType: screenshot.mimeType,
              data: screenshot.data,
            },
          }));
          contentParts.push(...imageParts);
          console.log(`[AudioWithScreenshot] Added ${imageParts.length} optimized screenshots to request`);
        }

        // Stream the response with paragraph-buffering - uses audio prompt directly with images
        const result = await geminiModel.generateContentStream(contentParts);

        accumulatedText = "";
        let pendingBuffer = "";
        let lastSentLength = 0;
        const FLUSH_INTERVAL = 200;
        let lastFlushTime = Date.now();
        
        const isParagraphBoundary = (text: string, pos: number): boolean => {
          // Check for double newline (paragraph break)
          if (pos > 0 && text[pos] === '\n' && text[pos - 1] === '\n') {
            return true;
          }
          return false;
        };
        
        const flushToUI = (force: boolean = false) => {
          const now = Date.now();
          const timeSinceLastFlush = now - lastFlushTime;
          
          if (pendingBuffer.length > 0 && (force || timeSinceLastFlush >= FLUSH_INTERVAL)) {
            let flushUpTo = pendingBuffer.length;
            
            if (!force) {
              // Look for the last paragraph boundary (double newline)
              for (let i = pendingBuffer.length - 1; i >= 1; i--) {
                if (isParagraphBoundary(pendingBuffer, i)) {
                  flushUpTo = i + 1;
                  break;
                }
              }
              // If no paragraph boundary found and buffer is small, don't flush yet
              if (flushUpTo === pendingBuffer.length && pendingBuffer.length < 100) {
                return;
              }
            }
            
            const toFlush = pendingBuffer.slice(0, flushUpTo);
            accumulatedText += toFlush;
            pendingBuffer = pendingBuffer.slice(flushUpTo);
            
            if (mainWindow && !mainWindow.isDestroyed() && accumulatedText.length > lastSentLength) {
              chunksSent = true;
              mainWindow.webContents.send(
                this.deps.PROCESSING_EVENTS.RESPONSE_CHUNK,
                { response: accumulatedText }
              );
              lastSentLength = accumulatedText.length;
              lastFlushTime = now;
            }
          }
        };

        for await (const chunk of result.stream) {
          if (signal.aborted) {
            throw new Error("Request aborted");
          }

          const chunkText = chunk.text();
          pendingBuffer += chunkText;
          flushToUI(false);
        }
        
        flushToUI(true);

        responseText = accumulatedText;

        // Clear screenshot queue after successful processing
        this.screenshotHelper.clearExtraScreenshotQueue();

        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            const main = require("./main");
            main.saveResponseToHistory?.(responseText);
          } catch {}
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: responseText });
        }

        return { success: true, data: responseText };
      } finally {
        try {
          signal.removeEventListener("abort", abortHandler);
        } catch (e) {}
      }
    } catch (error: any) {
      const mainWindow = this.deps.getMainWindow();
      console.error("Audio+screenshot response generation error:", {
        message: error.message,
        chunksSent,
      });

      if (chunksSent) {
        console.log("Chunks were already sent - allowing partial response");
        if (mainWindow && !mainWindow.isDestroyed() && accumulatedText) {
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: accumulatedText });
        }
        return { success: true, data: accumulatedText || "" };
      }

      if (error.message === "Request aborted" || error.name === "AbortError") {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
            "Audio+screenshot response generation canceled."
          );
        }
        return { success: false, error: "Response generation canceled." };
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
          error.message || "Server error during audio+screenshot response generation."
        );
      }
      this.deps.setView("initial");
      return { success: false, error: error.message || "Unknown error" };
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    const MAX_RETRIES = 0;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      try {
        const imageDataList = screenshots.map((screenshot) => screenshot.data);
        const mainWindow = this.deps.getMainWindow();

        // Get configured provider and API key from environment
        const provider = process.env.API_PROVIDER || "gemini";
        const apiKey = process.env.API_KEY;

        // Get model directly from config store via deps
        const model = await this.deps.getConfiguredModel();

        if (!apiKey) {
          throw new Error(
            "API key not found. Please configure it in settings."
          );
        }

        const base64Images = imageDataList.map(
          (data) => data // Keep the base64 string as is
        );

        if (mainWindow) {
          // Generate response directly using images
          const responseResult = await this.generateResponseWithImages(
            signal,
            base64Images,
            apiKey,
            model
          );

          if (responseResult.success) {
            this.screenshotHelper.clearExtraScreenshotQueue();
            // Store the response for follow-up context
            this.previousResponse = responseResult.data ?? null;
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS,
              { response: responseResult.data }
            );
            return { success: true, data: responseResult.data };
          } else {
            throw new Error(
              responseResult.error || "Failed to generate response"
            );
          }
        }
      } catch (error: any) {
        console.error("Processing error details:", {
          message: error.message,
          code: error.code,
          response: error.response?.data,
          retryCount,
        });

        if (
          error.message === "Request aborted" ||
          error.name === "AbortError" ||
          retryCount >= MAX_RETRIES
        ) {
          return { success: false, error: error.message };
        }
        retryCount++;
      }
    }

    return {
      success: false,
      error: "Failed to process after multiple attempts. Please try again.",
    };
  }

  // ============================================================================
  // BUG FIX: Enhanced Error Handling and Resource Cleanup
  // ============================================================================
  private async generateResponseWithImages(
    signal: AbortSignal,
    base64Images: string[],
    apiKey: string,
    model: string
  ) {
    // Declare variables in function scope so catch block can access them
    let responseText = "";
    let chunksSent = false; // Track if any chunks were sent
    let accumulatedText = ""; // Accumulated text from chunks
    const provider = process.env.API_PROVIDER || "gemini";
    
    try {
      // Check if we should use two-step processing (vision -> text)
      const visionModel = await this.deps.getVisionModel();
      const textModel = await this.deps.getTextModel();
      const useTwoStepProcessing = provider === "groq" && 
                                    visionModel && textModel && 
                                    visionModel !== textModel;

      if (useTwoStepProcessing) {
        // TWO-STEP PROCESSING: Vision model analyzes, text model generates response
        console.log(`[TwoStep] Using vision model: ${visionModel}, text model: ${textModel}`);
        
        const mainWindow = this.deps.getMainWindow();
        
        // Step 1: Analyze screenshots with vision model
        let userPrompt: string | null = null;
        try {
          userPrompt = this.deps.getUserPrompt?.();
          if (userPrompt && userPrompt.trim().length > 0) {
            this.deps.clearUserPrompt?.();
          }
        } catch {}

        const screenshotDescription = await this.analyzeScreenshotsWithVision(
          base64Images,
          apiKey,
          visionModel,
          signal,
          userPrompt || undefined
        );

        if (signal.aborted) throw new Error("Request aborted");

        // Step 2: Generate response with text model using the description
        console.log(`[TwoStep] Generating response with text model`);

        // Build prompt for text model
        let customPrompt: string | null = null;
        try {
          customPrompt = await this.deps.getSystemPrompt();
        } catch (e) {
          console.warn("Failed to get custom system prompt:", e);
        }

        let promptLines: string[];
        if (customPrompt && customPrompt.trim().length > 0) {
          promptLines = customPrompt.split('\n');
        } else {
          promptLines = this.getDefaultPromptLines();
        }

        // Add screenshot analysis to the prompt
        promptLines.push(
          "",
          "## Screenshot Analysis",
          "The following is a description of screenshot(s) that were captured:",
          "",
          screenshotDescription,
          ""
        );

        const finalPrompt = promptLines.join("\n");

        const abortHandler = () => {};
        signal.addEventListener("abort", abortHandler);

        try {
          accumulatedText = "";
          let pendingBuffer = "";
          let lastSentLength = 0;
          const FLUSH_INTERVAL = 80;
          let lastFlushTime = Date.now();
          
          const isWordBoundary = (char: string): boolean => {
            return /[\s\n.,!?;:)\]}>"`']/.test(char);
          };
          
          const flushToUI = (force: boolean = false) => {
            const now = Date.now();
            const timeSinceLastFlush = now - lastFlushTime;
            
            if (pendingBuffer.length > 0 && (force || timeSinceLastFlush >= FLUSH_INTERVAL)) {
              let flushUpTo = pendingBuffer.length;
              
              if (!force) {
                for (let i = pendingBuffer.length - 1; i >= 0; i--) {
                  if (isWordBoundary(pendingBuffer[i])) {
                    flushUpTo = i + 1;
                    break;
                  }
                }
                if (flushUpTo === pendingBuffer.length && pendingBuffer.length < 20) {
                  return;
                }
              }
              
              const toFlush = pendingBuffer.slice(0, flushUpTo);
              accumulatedText += toFlush;
              pendingBuffer = pendingBuffer.slice(flushUpTo);
              
              if (mainWindow && !mainWindow.isDestroyed() && accumulatedText.length > lastSentLength) {
                chunksSent = true;
                mainWindow.webContents.send(
                  this.deps.PROCESSING_EVENTS.RESPONSE_CHUNK,
                  { response: accumulatedText }
                );
                lastSentLength = accumulatedText.length;
                lastFlushTime = now;
              }
            }
          };

          // Call text model without images
          await this.callGroqAPI(finalPrompt, apiKey, textModel, signal, (chunk) => {
            pendingBuffer += chunk;
            flushToUI(false);
          });
          
          flushToUI(true);
          responseText = accumulatedText;

          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              const main = require("./main");
              main.saveResponseToHistory?.(responseText);
            } catch {}
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: responseText });
          }

          return { success: true, data: responseText };
        } finally {
          try {
            signal.removeEventListener("abort", abortHandler);
          } catch (e) {}
        }
      }

      // Check if using Groq with a non-vision model (without two-step)
      if (provider === "groq" && !(await this.isGroqVisionModel(model))) {
        throw new Error(`Groq model ${model} does not support image analysis. Please use a vision model or enable two-step processing with separate vision/text models.`);
      }

      if (provider === "groq") {
        // Use Groq API for vision
        console.log(`[Groq] Processing screenshots with vision model: ${model}`);
        console.log(`[PROCESSING] Images to be sent: ${base64Images.length}`);

        // Try to get custom system prompt from settings
        let customPrompt: string | null = null;
        try {
          customPrompt = await this.deps.getSystemPrompt();
        } catch (e) {
          console.warn("Failed to get custom system prompt:", e);
        }

        // Use custom prompt if available, otherwise use default
        let promptLines: string[];
        if (customPrompt && customPrompt.trim().length > 0) {
          console.log("[PROCESSING] Using custom system prompt from settings");
          promptLines = customPrompt.split('\n');
        } else {
          console.log("[PROCESSING] Using default system prompt");
          promptLines = this.getDefaultPromptLines();
        }

        // Include optional user prompt (normal mode typing)
        try {
          const typed = this.deps.getUserPrompt?.();
          if (typed && typed.trim().length > 0) {
            promptLines.push(`## User Prompt`, "", typed.trim(), "");
            // Clear after consuming to avoid reuse
            this.deps.clearUserPrompt?.();
          }
        } catch {}

        const prompt = promptLines.join("\n");
        const mainWindow = this.deps.getMainWindow();

        if (signal.aborted) throw new Error("Request aborted");

        const abortHandler = () => {};
        signal.addEventListener("abort", abortHandler);

        try {
          accumulatedText = "";
          let pendingBuffer = "";
          let lastSentLength = 0;
          const FLUSH_INTERVAL = 80;
          let lastFlushTime = Date.now();
          
          const isWordBoundary = (char: string): boolean => {
            return /[\s\n.,!?;:)\]}>"`']/.test(char);
          };
          
          const flushToUI = (force: boolean = false) => {
            const now = Date.now();
            const timeSinceLastFlush = now - lastFlushTime;
            
            if (pendingBuffer.length > 0 && (force || timeSinceLastFlush >= FLUSH_INTERVAL)) {
              let flushUpTo = pendingBuffer.length;
              
              if (!force) {
                for (let i = pendingBuffer.length - 1; i >= 0; i--) {
                  if (isWordBoundary(pendingBuffer[i])) {
                    flushUpTo = i + 1;
                    break;
                  }
                }
                if (flushUpTo === pendingBuffer.length && pendingBuffer.length < 20) {
                  return;
                }
              }
              
              const toFlush = pendingBuffer.slice(0, flushUpTo);
              accumulatedText += toFlush;
              pendingBuffer = pendingBuffer.slice(flushUpTo);
              
              if (mainWindow && !mainWindow.isDestroyed() && accumulatedText.length > lastSentLength) {
                chunksSent = true;
                mainWindow.webContents.send(
                  this.deps.PROCESSING_EVENTS.RESPONSE_CHUNK,
                  { response: accumulatedText }
                );
                lastSentLength = accumulatedText.length;
                lastFlushTime = now;
              }
            }
          };

          await this.callGroqAPI(prompt, apiKey, model, signal, (chunk) => {
            pendingBuffer += chunk;
            flushToUI(false);
          }, base64Images);
          
          flushToUI(true);
          responseText = accumulatedText;

          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              const main = require("./main");
              main.saveResponseToHistory?.(responseText);
            } catch {}
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: responseText });
          }

          return { success: true, data: responseText };
        } finally {
          try {
            signal.removeEventListener("abort", abortHandler);
          } catch (e) {}
        }
      }

      // Gemini processing
      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModelId = model.startsWith("gemini-")
        ? `models/${model}`
        : model;
      const geminiModel = genAI.getGenerativeModel({ model: geminiModelId });

      const imageParts = base64Images.map((data) => ({
        inlineData: {
          mimeType: "image/png",
          data: data,
        },
      }));

      // Prepare content parts array starting with images
      const contentParts = [...imageParts];
      console.log(
        `[PROCESSING] Images added to contentParts: ${imageParts.length}`
      );

      // Try to get custom system prompt from settings
      let customPrompt: string | null = null;
      try {
        customPrompt = await this.deps.getSystemPrompt();
      } catch (e) {
        console.warn("Failed to get custom system prompt:", e);
      }

      // Use custom prompt if available, otherwise use default
      let promptLines: string[];
      if (customPrompt && customPrompt.trim().length > 0) {
        console.log("[PROCESSING] Using custom system prompt from settings");
        promptLines = customPrompt.split('\n');
      } else {
        console.log("[PROCESSING] Using default system prompt");
        promptLines = this.getDefaultPromptLines();
      }

      // Include optional user prompt (normal mode typing)
      try {
        const typed = this.deps.getUserPrompt?.();
        if (typed && typed.trim().length > 0) {
          promptLines.push(`## User Prompt`, "", typed.trim(), "");
          // Clear after consuming to avoid reuse
          this.deps.clearUserPrompt?.();
        }
      } catch {}

      const prompt = promptLines.join("\n");

      if (signal.aborted) throw new Error("Request aborted");
      
      // Enhanced abort handling - don't throw, just mark as aborted
      const abortHandler = () => {
        // Don't throw here - let the fetch request handle the abort naturally
        // The error will be caught in the catch block below
      };
      signal.addEventListener("abort", abortHandler);

      const mainWindow = this.deps.getMainWindow();

      try {
        // Stream the response with word-buffering for smoother display
        const result = await geminiModel.generateContentStream([
          prompt,
          ...contentParts,
        ]);

        accumulatedText = "";
        let pendingBuffer = ""; // Buffer for incomplete words
        let lastSentLength = 0; // Track what we've already sent
        const FLUSH_INTERVAL = 80; // Flush every 80ms minimum
        let lastFlushTime = Date.now();
        
        // Helper to check if we're at a word boundary
        const isWordBoundary = (char: string): boolean => {
          return /[\s\n.,!?;:)\]}>"`']/.test(char);
        };
        
        // Helper to flush buffered content to UI
        const flushToUI = (force: boolean = false) => {
          const now = Date.now();
          const timeSinceLastFlush = now - lastFlushTime;
          
          // Only flush if we have new content and enough time has passed (or forced)
          if (pendingBuffer.length > 0 && (force || timeSinceLastFlush >= FLUSH_INTERVAL)) {
            // Find the last word boundary in the pending buffer
            let flushUpTo = pendingBuffer.length;
            
            if (!force) {
              // Look for the last word boundary to avoid cutting words
              for (let i = pendingBuffer.length - 1; i >= 0; i--) {
                if (isWordBoundary(pendingBuffer[i])) {
                  flushUpTo = i + 1;
                  break;
                }
              }
              // If no boundary found and buffer is small, wait for more
              if (flushUpTo === pendingBuffer.length && pendingBuffer.length < 20) {
                return;
              }
            }
            
            // Move flushed content to accumulated
            const toFlush = pendingBuffer.slice(0, flushUpTo);
            accumulatedText += toFlush;
            pendingBuffer = pendingBuffer.slice(flushUpTo);
            
            // Send to UI
            if (mainWindow && !mainWindow.isDestroyed() && accumulatedText.length > lastSentLength) {
              chunksSent = true;
              mainWindow.webContents.send(
                this.deps.PROCESSING_EVENTS.RESPONSE_CHUNK,
                { response: accumulatedText }
              );
              lastSentLength = accumulatedText.length;
              lastFlushTime = now;
            }
          }
        };

        for await (const chunk of result.stream) {
          // Check for abort between chunks
          if (signal.aborted) {
            throw new Error("Request aborted");
          }
          
          const chunkText = chunk.text();
          pendingBuffer += chunkText;
          
          // Try to flush complete words
          flushToUI(false);
        }
        
        // Flush any remaining content
        flushToUI(true);

        responseText = accumulatedText;

        // Send final success message
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            const main = require("./main");
            main.saveResponseToHistory?.(responseText);
          } catch {}
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: responseText });
        }

        return { success: true, data: responseText };
      } finally {
        try {
          signal.removeEventListener("abort", abortHandler);
        } catch (e) {
          // Ignore if removeEventListener fails - signal may already be cleaned up
        }
      }
      
    } catch (error: any) {
      const mainWindow = this.deps.getMainWindow();
      console.error("Response generation error:", {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        chunksSent,
      });

      // If we already sent chunks, don't reset the view - the UI already has partial content
      if (chunksSent) {
        console.log("Chunks were already sent - not resetting view, allowing partial response to display");
        // Send final chunk with whatever we have
        if (mainWindow && !mainWindow.isDestroyed() && accumulatedText) {
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: accumulatedText });
        }
        return { success: true, data: accumulatedText || "" };
      }

      if (error.message === "Request aborted" || error.name === "AbortError") {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
            "Response generation canceled."
          );
        }
        return { success: false, error: "Response generation canceled." };
      }

      if (error.code === "ETIMEDOUT" || error.response?.status === 504) {
        this.cancelOngoingRequests();
        this.deps.clearQueues();
        this.deps.setView("initial");
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("reset-view");
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
            "Request timed out. The server took too long to respond. Please try again."
          );
        }
        return {
          success: false,
          error: "Request timed out. Please try again.",
        };
      }

      if (
        error.response?.data?.error?.includes(
          "Please close this window and re-enter a valid Open AI API key."
        ) ||
        error.response?.data?.error?.includes("API key not found")
      ) {
        if (mainWindow) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.API_KEY_INVALID
          );
        }
        return { success: false, error: error.response.data.error };
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
          error.message ||
            "Server error during response generation. Please try again."
        );
      }
      console.log("Resetting view to queue due to response generation error (no chunks sent)");
      this.deps.setView("initial");
      return {
        success: false,
        error: error.message || "Unknown error during response generation",
      };
    }
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal,
    userPrompt?: string
  ) {
    try {
      const imageDataList = screenshots.map((screenshot) => screenshot.data);
      const mainWindow = this.deps.getMainWindow();

      // Get configured provider and API key from environment
      const provider = process.env.API_PROVIDER || "gemini";
      const apiKey = process.env.API_KEY;

      // Get model directly from config store via deps
      const model = await this.deps.getConfiguredModel();

      if (!apiKey) {
        throw new Error("API key not found. Please configure it in settings.");
      }

      const base64Images = imageDataList.map(
        (data) => data // Keep the base64 string as is
      );

      // Validate base64 data before sending to API
      const validBase64Images = base64Images.filter((data, index) => {
        if (!data || typeof data !== 'string') {
          return false;
        }
        
        // Check if it's a valid base64 string
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
          return false;
        }
        
        // Check minimum length (base64 should be reasonably long)
        if (data.length < 100) {
          return false;
        }
        
        return true;
      });

      if (validBase64Images.length === 0) {
        throw new Error("No valid screenshot data available for follow-up processing. Please try taking a new screenshot.");
      }

      // Check if we should use two-step processing (vision -> text)
      const visionModel = await this.deps.getVisionModel();
      const textModel = await this.deps.getTextModel();
      const useTwoStepProcessing = provider === "groq" && 
                                    visionModel && textModel && 
                                    visionModel !== textModel;

      if (useTwoStepProcessing) {
        // TWO-STEP PROCESSING for follow-up
        console.log(`[Followup-TwoStep] Using vision: ${visionModel}, text: ${textModel}`);

        // Step 1: Analyze screenshots with vision model
        const screenshotDescription = await this.analyzeScreenshotsWithVision(
          validBase64Images,
          apiKey,
          visionModel,
          signal,
          userPrompt
        );

        if (signal.aborted) throw new Error("Request aborted");

        // Step 2: Generate response with text model
        // Try to get custom system prompt from settings
        let customPrompt: string | null = null;
        try {
          customPrompt = await this.deps.getSystemPrompt();
        } catch (e) {
          console.warn("Failed to get custom system prompt for follow-up:", e);
        }

        let promptLines: string[];
        if (customPrompt && customPrompt.trim().length > 0) {
          promptLines = customPrompt.split('\n');
          promptLines.push(
            ``,
            `## Previous Response Context`,
            `This is a follow-up to a previous response. Please consider the context and build upon it appropriately.`,
            ``
          );
        } else {
          promptLines = this.getDefaultFollowUpPromptLines();
        }

        // Add screenshot analysis
        promptLines.push(
          "",
          "## Screenshot Analysis",
          "The following describes what was visible in the screenshot(s):",
          "",
          screenshotDescription,
          ""
        );

        const finalPrompt = promptLines.join("\n");

        // Stream response from text model
        return await this.streamFollowupResponse(
          finalPrompt,
          apiKey,
          textModel,
        signal
      );
      }

      // Check if using Groq with a non-vision model (without two-step)
      if (provider === "groq" && !(await this.isGroqVisionModel(model))) {
        throw new Error(`Groq model ${model} does not support image analysis. Please use a vision model or enable two-step processing with separate vision/text models.`);
      }

      if (provider === "groq") {
        // Use Groq API for vision follow-up
        console.log(`[Groq] Processing follow-up screenshots with vision model: ${model}`);        // Try to get custom system prompt from settings
        let customPrompt: string | null = null;
        try {
          customPrompt = await this.deps.getSystemPrompt();
        } catch (e) {
          console.warn("Failed to get custom system prompt for follow-up:", e);
        }

        // Use custom prompt if available, otherwise use default follow-up prompt
        let promptLines: string[];
        if (customPrompt && customPrompt.trim().length > 0) {
          console.log("[FOLLOW-UP] Using custom system prompt from settings");
          promptLines = customPrompt.split('\n');
          promptLines.push(
            ``,
            `## Previous Response Context`,
            `This is a follow-up to a previous response. Please consider the context and build upon it appropriately.`,
            ``
          );
        } else {
          console.log("[FOLLOW-UP] Using default system prompt");
          promptLines = this.getDefaultFollowUpPromptLines();
        }

        // Include user's typed follow-up text if available
        if (userPrompt && userPrompt.trim().length > 0) {
          promptLines.push(`## Additional User Question`, "", userPrompt.trim(), "");
        }

        // Add context about the previous response if available
        try {
          const previousResponse = this.deps.getPreviousResponse?.();
          if (previousResponse && previousResponse.trim().length > 0) {
            promptLines.push(`## Previous Response`, "", previousResponse.trim(), "");
          }
        } catch {}

        const prompt = promptLines.join("\n");

        if (signal.aborted) throw new Error("Request aborted");

        const abortHandler = () => {};
        signal.addEventListener("abort", abortHandler);

        try {
          let accumulatedText = "";
          let pendingBuffer = "";
          let lastSentLength = 0;
          const FLUSH_INTERVAL = 80;
          let lastFlushTime = Date.now();
          
          const isWordBoundary = (char: string): boolean => {
            return /[\s\n.,!?;:)\]}>"`']/.test(char);
          };
          
          const flushToUI = (force: boolean = false) => {
            const now = Date.now();
            const timeSinceLastFlush = now - lastFlushTime;
            
            if (pendingBuffer.length > 0 && (force || timeSinceLastFlush >= FLUSH_INTERVAL)) {
              let flushUpTo = pendingBuffer.length;
              
              if (!force) {
                for (let i = pendingBuffer.length - 1; i >= 0; i--) {
                  if (isWordBoundary(pendingBuffer[i])) {
                    flushUpTo = i + 1;
                    break;
                  }
                }
                if (flushUpTo === pendingBuffer.length && pendingBuffer.length < 20) {
                  return;
                }
              }
              
              const toFlush = pendingBuffer.slice(0, flushUpTo);
              accumulatedText += toFlush;
              pendingBuffer = pendingBuffer.slice(flushUpTo);
              
              if (mainWindow && !mainWindow.isDestroyed() && accumulatedText.length > lastSentLength) {
                mainWindow.webContents.send(
                  this.deps.PROCESSING_EVENTS.RESPONSE_CHUNK,
                  { response: accumulatedText }
                );
                lastSentLength = accumulatedText.length;
                lastFlushTime = now;
              }
            }
          };

          await this.callGroqAPI(prompt, apiKey, model, signal, (chunk) => {
            pendingBuffer += chunk;
            flushToUI(false);
          }, validBase64Images);
          
          flushToUI(true);

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS,
              { response: accumulatedText }
            );
          }

          return { success: true, data: accumulatedText };
        } finally {
          try {
            signal.removeEventListener("abort", abortHandler);
          } catch (e) {}
        }
      }

      // Gemini processing - For follow-up, use the same approach as the initial response
      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModelId = model.startsWith("gemini-")
        ? `models/${model}`
        : model;
      const geminiModel = genAI.getGenerativeModel({ model: geminiModelId });

      const imageParts = validBase64Images.map((data) => ({
        inlineData: {
          mimeType: "image/png",
          data: data,
        },
      }));

      // Prepare content parts array starting with images
      const contentParts = [...imageParts];

      // Try to get custom system prompt from settings
      let customPrompt: string | null = null;
      try {
        customPrompt = await this.deps.getSystemPrompt();
      } catch (e) {
        console.warn("Failed to get custom system prompt for follow-up:", e);
      }

      // Use custom prompt if available, otherwise use default follow-up prompt
      let promptLines: string[];
      if (customPrompt && customPrompt.trim().length > 0) {
        console.log("[FOLLOW-UP] Using custom system prompt from settings");
        promptLines = customPrompt.split('\n');
        // Add follow-up context to custom prompt
        promptLines.push(
          ``,
          `## Previous Response Context`,
          `This is a follow-up to a previous response. Please consider the context and build upon it appropriately.`,
          ``
        );
      } else {
        console.log("[FOLLOW-UP] Using default system prompt");
        promptLines = this.getDefaultFollowUpPromptLines();
      }

      // Include user's typed follow-up text if available
      if (userPrompt && userPrompt.trim().length > 0) {
        promptLines.push(`## Additional User Question`, "", userPrompt.trim(), "");
      }

      // Add context about the previous response if available
      try {
        const previousResponse = this.deps.getPreviousResponse?.();
        if (previousResponse && previousResponse.trim().length > 0) {
          promptLines.push(`## Previous Response`, "", previousResponse.trim(), "");
        }
      } catch {}

      const prompt = promptLines.join("\n");

      if (signal.aborted) throw new Error("Request aborted");
      
      // Enhanced abort handling - don't throw, just mark as aborted
      const abortHandler = () => {
        // Don't throw here - let the fetch request handle the abort naturally
        // The error will be caught in the catch block below
      };
      signal.addEventListener("abort", abortHandler);

      let followUpResponse = "";

      try {
        // Stream the follow-up response with word-buffering for smoother display
        const result = await geminiModel.generateContentStream([
          prompt,
          ...contentParts,
        ]);

        let accumulatedText = "";
        let pendingBuffer = "";
        let lastSentLength = 0;
        const FLUSH_INTERVAL = 80;
        let lastFlushTime = Date.now();
        
        const isWordBoundary = (char: string): boolean => {
          return /[\s\n.,!?;:)\]}>"`']/.test(char);
        };
        
        const flushToUI = (force: boolean = false) => {
          const now = Date.now();
          const timeSinceLastFlush = now - lastFlushTime;
          
          if (pendingBuffer.length > 0 && (force || timeSinceLastFlush >= FLUSH_INTERVAL)) {
            let flushUpTo = pendingBuffer.length;
            
            if (!force) {
              for (let i = pendingBuffer.length - 1; i >= 0; i--) {
                if (isWordBoundary(pendingBuffer[i])) {
                  flushUpTo = i + 1;
                  break;
                }
              }
              if (flushUpTo === pendingBuffer.length && pendingBuffer.length < 20) {
                return;
              }
            }
            
            const toFlush = pendingBuffer.slice(0, flushUpTo);
            accumulatedText += toFlush;
            pendingBuffer = pendingBuffer.slice(flushUpTo);
            
            if (mainWindow && !mainWindow.isDestroyed() && accumulatedText.length > lastSentLength) {
              mainWindow.webContents.send(
                this.deps.PROCESSING_EVENTS.FOLLOW_UP_CHUNK,
                { response: accumulatedText }
              );
              lastSentLength = accumulatedText.length;
              lastFlushTime = now;
            }
          }
        };

        for await (const chunk of result.stream) {
          // Check for abort between chunks
          if (signal.aborted) {
            throw new Error("Request aborted");
          }
          
          const chunkText = chunk.text();
          pendingBuffer += chunkText;
          flushToUI(false);
        }
        
        flushToUI(true);

        followUpResponse = accumulatedText;

        // Send final success message
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            const main = require("./main");
            main.saveResponseToHistory?.(followUpResponse);
          } catch {}
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.FOLLOW_UP_SUCCESS, { response: followUpResponse });
        }

      } finally {
        try {
          signal.removeEventListener("abort", abortHandler);
        } catch (e) {
          // Ignore if removeEventListener fails - signal may already be cleaned up
        }
      }

      return { success: true, data: followUpResponse };
      
    } catch (error: any) {
      console.error("Follow-up processing error details:", {
        message: error.message,
        code: error.code,
        response: error.response?.data,
      });

      if (error.message === "Request aborted" || error.name === "AbortError") {
        return { success: false, error: "Follow-up processing canceled." };
      }

      // Special handling for image validation errors
      if (error.message.includes("No valid screenshot data") || 
          error.message.includes("Provided image is not valid")) {
        return {
          success: false,
          error: "Screenshot data is invalid. Please try pressing Ctrl+Enter again to take a fresh screenshot.",
        };
      }

      if (error.code === "ETIMEDOUT" || error.response?.status === 504) {
        this.cancelOngoingRequests();
        this.deps.clearQueues();
        return {
          success: false,
          error: "Request timed out. Please try again.",
        };
      }

      return {
        success: false,
        error: error.message || "Unknown error during follow-up processing",
      };
    }
  }

  // ============================================================================
  // BUG FIX: Enhanced Request Cancellation with Comprehensive Cleanup
  // ============================================================================
  public cancelOngoingRequests(): void {
    let wasCancelled = false;

    // Safely abort all controllers with better error handling
    [this.currentProcessingAbortController, this.currentExtraProcessingAbortController]
      .filter(Boolean)
      .forEach(controller => {
        try {
          if (controller && !controller.signal.aborted) {
            // Use the safe abort method which handles errors better
            this.safeAbortController(controller);
            wasCancelled = true;
          }
        } catch (error) {
          // Silently handle abort errors - they're expected when canceling
          console.warn("Error aborting request controller (this is usually safe to ignore):", error);
        }
      });

    // Clear controller references
    this.currentProcessingAbortController = null;
    this.currentExtraProcessingAbortController = null;

    // Clear all timeouts
    this.clearProcessingTimeouts();

    // Reset processing state
    this.isCurrentlyProcessing = false;
    this.deps.setHasFollowedUp(false);

    const mainWindow = this.deps.getMainWindow();

    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESET);
    }
  }

  public cancelProcessing(): void {
    console.log("Canceling processing...");
    this.cancelOngoingRequests();
  }

  public isProcessing(): boolean {
    return this.isCurrentlyProcessing;
  }

  public getPreviousResponse(): string | null {
    return this.previousResponse;
  }

  // ============================================================================
  // NEW: Follow-up Processing Method
  // ============================================================================
  public async processFollowUp(): Promise<void> {
    if (this.isCurrentlyProcessing) {
      console.log("Processing already in progress. Skipping follow-up call.");
      return;
    }

    this.isCurrentlyProcessing = true;
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow) {
      this.isCurrentlyProcessing = false;
      return;
    }

    try {
      // Set view to follow-up
      this.deps.setView("followup");
      
      // Notify that follow-up processing has started
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.FOLLOW_UP_START);
      
      // Get current screenshots for context
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue();
      const extraScreenshotQueue = this.screenshotHelper.getExtraScreenshotQueue();
      
      if (screenshotQueue.length === 0 && extraScreenshotQueue.length === 0) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.FOLLOW_UP_ERROR, "No screenshots available");
        this.isCurrentlyProcessing = false;
        return;
      }

      // Capture user prompt before processing
      const userPrompt = this.deps.getUserPrompt?.() || "";

      // Clear the user prompt immediately to prevent reuse
      if (userPrompt) {
        this.deps.clearUserPrompt?.();
      }

      // Process follow-up with existing screenshots and user prompt
      const result = await this.processExtraScreenshotsHelper(
        await Promise.all(
          [...screenshotQueue, ...extraScreenshotQueue].map(async (path) => ({
            path,
            data: fs.readFileSync(path).toString("base64"),
          }))
        ),
        new AbortController().signal,
        userPrompt // Pass user prompt to follow-up processing
      );

      if (result.success && 'data' in result && result.data) {
        // Send follow-up response
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.FOLLOW_UP_SUCCESS, {
          response: result.data,
          isFollowUp: true
        });
        
        // Update the main response with follow-up content
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, {
          response: result.data,
          isFollowUp: true
        });
        
        // Store the follow-up response for future context
        this.previousResponse = result.data;
        
        // Mark that we've followed up
        this.deps.setHasFollowedUp(true);
      } else {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.FOLLOW_UP_ERROR, result.error || "Follow-up processing failed");
      }
      
    } catch (error: any) {
      console.error("Error in processFollowUp:", error);
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.FOLLOW_UP_ERROR, error.message || "Unknown error");
    } finally {
      this.isCurrentlyProcessing = false;
    }
  }

  /**
   * Helper to stream response from text model (no images)
   */
  private async streamFollowupResponse(
    prompt: string,
    apiKey: string,
    model: string,
    signal: AbortSignal
  ): Promise<{ success: boolean; data?: string; error?: string }> {
    const mainWindow = this.deps.getMainWindow();
    let accumulatedText = "";
    let chunksSent = false;

    try {
      const abortHandler = () => {};
      signal.addEventListener("abort", abortHandler);

      try {
        let pendingBuffer = "";
        let lastSentLength = 0;
        const FLUSH_INTERVAL = 80;
        let lastFlushTime = Date.now();
        
        const isWordBoundary = (char: string): boolean => {
          return /[\s\n.,!?;:)\]}>"`']/.test(char);
        };
        
        const flushToUI = (force: boolean = false) => {
          const now = Date.now();
          const timeSinceLastFlush = now - lastFlushTime;
          
          if (pendingBuffer.length > 0 && (force || timeSinceLastFlush >= FLUSH_INTERVAL)) {
            let flushUpTo = pendingBuffer.length;
            
            if (!force) {
              for (let i = pendingBuffer.length - 1; i >= 0; i--) {
                if (isWordBoundary(pendingBuffer[i])) {
                  flushUpTo = i + 1;
                  break;
                }
              }
              if (flushUpTo === pendingBuffer.length && pendingBuffer.length < 20) {
                return;
              }
            }
            
            const toFlush = pendingBuffer.slice(0, flushUpTo);
            accumulatedText += toFlush;
            pendingBuffer = pendingBuffer.slice(flushUpTo);
            
            if (mainWindow && !mainWindow.isDestroyed() && accumulatedText.length > lastSentLength) {
              chunksSent = true;
              mainWindow.webContents.send(
                this.deps.PROCESSING_EVENTS.RESPONSE_CHUNK,
                { response: accumulatedText }
              );
              lastSentLength = accumulatedText.length;
              lastFlushTime = now;
            }
          }
        };

        await this.callGroqAPI(prompt, apiKey, model, signal, (chunk) => {
          pendingBuffer += chunk;
          flushToUI(false);
        });
        
        flushToUI(true);

        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            const main = require("./main");
            main.saveResponseToHistory?.(accumulatedText);
          } catch {}
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.RESPONSE_SUCCESS, { response: accumulatedText });
        }

        return { success: true, data: accumulatedText };
      } finally {
        try {
          signal.removeEventListener("abort", abortHandler);
        } catch (e) {}
      }
    } catch (error: any) {
      console.error("Follow-up response error:", error);
      
      if (chunksSent && accumulatedText) {
        return { success: true, data: accumulatedText };
      }

      if (error.message === "Request aborted" || error.name === "AbortError") {
        return { success: false, error: "Follow-up canceled." };
      }

      return { success: false, error: error.message || "Unknown error" };
    }
  }

  // ============================================================================
  // Default System Prompt
  // ============================================================================
  private getDefaultPromptLines(): string[] {
    return [
      `You are an expert assistant tasked with solving the task shown in the images.`,
      ``,
      `## Interview Context`,
      `You are interviewing for a software engineer position. When solving coding problems, follow these rules:`,
      `• Do not include code comments.`,
      `• Provide two or three unit tests.`,
      `• Include time and space complexity.`,
      ``,
      `When solving system design problems, follow this structure:`,
      `• Ask clarifying questions before beginning the solution, such as expected daily active users, read and write throughput, expected storage size per user and in total, latency requirements, data retention policies, and anticipated traffic growth.`,
      `• Define the functional requirements.`,
      `• Define the non functional requirements.`,
      `• List constraints and assumptions.`,
      `• Identify core entities and APIs.`,
      `• Present a high level architecture, including an ASCII diagram., including an ASCII diagram`,
      `• Describe key components and how they interact.`,
      `• Address scalability, reliability, and fault tolerance.`,
      `• Provide deep dives into selected components when appropriate.`,
      ``,
      `---`,
      `Your response MUST follow this structure, using Markdown headings:`,
      ``,
      `# Analysis`,
      `If audio is provided, briefly reference what you hear and how it relates to the visual content. Keep this extremely brief and focus on your solution approach. One or two sentences maximum.`,
      ``,
      `# Solution`,
      `Provide the direct solution based on both visual and audio content. Use standard Markdown. If code is necessary, use appropriate code blocks. Do not describe the task itself.`,
      `IMPORTANT: When adding code blocks, use triple backticks WITH the language specifier. Use \`\`\`language\\ncode here\\n\`\`\`.`,
      ``,
      `# Summary`,
      `Provide only 1-2 sentences focusing on implementation details. Mention if audio context influenced the solution. No conclusions or verbose explanations.`,
      ``,
      `---`,
      `Remember: If audio is provided, reference it naturally in your response. Focus on the solution itself.`,
      `CODE FORMATTING: Use ONLY \`\`\` WITH the language specifier for all code blocks.`,
    ];
  }

  public getDefaultSystemPrompt(): string {
    return this.getDefaultPromptLines().join('\n');
  }

  private getDefaultFollowUpPromptLines(): string[] {
    return [
      `You are an expert assistant tasked with solving the follow-up issue shown in the images.`,
      ``,
      `## Interview Context`,
      `You are interviewing for a software engineer position. When solving coding problems, follow these rules:`,
      `• Do not include code comments.`,
      `• Provide two or three unit tests.`,
      `• Include time and space complexity.`,
      ``,
      `When solving system design problems, follow this structure:`,
      `• Ask clarifying questions before beginning the solution, such as expected daily active users, read and write throughput, expected storage size per user and in total, latency requirements, data retention policies, and anticipated traffic growth.`,
      `• Define the functional requirements.`,
      `• Define the non functional requirements.`,
      `• List constraints and assumptions.`,
      `• Identify core entities and APIs.`,
      `• Present a high level architecture, including an ASCII diagram..`,
      `• Describe key components and how they interact.`,
      `• Address scalability, reliability, and fault tolerance.`,
      `• Provide deep dives into selected components when appropriate.`,
      ``,
      `## Previous Response Context`,
      `This is a follow-up to a previous response. Please consider the context and build upon it appropriately.`,
      ``,
      `---`,
      `Your response MUST follow this structure, using Markdown headings:`,
      ``,
      `# Context`,
      `If audio is provided, briefly reference what you hear and how it relates to the visual content. Keep this extremely brief and focus on your solution approach. One or two sentences maximum.`,
      ``,
      `# What's the question?`,
      `Briefly summarize based on the visual and audio content. This helps set context for the analysis.`,
      ``,
      `# Analysis`,
      `If audio is provided, briefly reference what you hear and how it relates to the visual content. Keep this extremely brief and focus on your solution approach. One or two sentences maximum.`,
      ``,
      `# Solution`,
      `Provide the direct solution based on both visual and audio content. Use standard Markdown. If code is necessary, use appropriate code blocks. Do not describe the task itself.`,
      `IMPORTANT: When adding code blocks, use triple backticks WITH the language specifier. Use \`\`\`language\\ncode here\\n\`\`\`.`,
      ``,
      `# Approach`,
      `Describe the approach taken to solve the issue. Focus on implementation details and any specific techniques used. Make sure to keep it concise and relevant to the visual/audio content.`,
      ``,
      `# Summary`,
      `Provide only 1-2 sentences focusing on implementation details. Mention if audio context influenced the solution. No conclusions or verbose explanations.`,
      ``,
      `---`,
      `Remember: If audio is provided, reference it naturally in your response. Focus on the solution itself.`,
      `CODE FORMATTING: Use ONLY \`\`\` WITH the language specifier for all code blocks.`,
    ];
  }

  // ============================================================================
  // BUG FIX: Cleanup on Destruction
  // ============================================================================
  public cleanup(): void {
    this.cancelOngoingRequests();
    this.clearProcessingTimeouts();
    this.isCurrentlyProcessing = false;
  }
}
