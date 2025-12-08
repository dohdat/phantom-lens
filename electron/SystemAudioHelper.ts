/**
 * SystemAudioHelper - Manages the phantom-audio native process for system audio capture
 * and speech-to-text transcription.
 */

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { BrowserWindow, ipcMain, app } from "electron";
import path from "path";
import fs from "fs";
import https from "https";

interface TranscriptMessage {
  type: "ready" | "started" | "stopped" | "partial" | "final" | "error";
  text?: string;
  message?: string;
}

interface SystemAudioState {
  isCapturing: boolean;
  isReady: boolean;
  lastError: string | null;
}

export class SystemAudioHelper {
  private audioProcess: ChildProcessWithoutNullStreams | null = null;
  private mainWindow: BrowserWindow | null = null;
  private state: SystemAudioState = {
    isCapturing: false,
    isReady: false,
    lastError: null,
  };
  private dataBuffer: string = "";
  private idleTimer: NodeJS.Timeout | null = null;
  private lastStopTime: number | null = null;
  private static readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

  constructor() {}

  /**
   * Check if currently capturing
   */
  isCapturing(): boolean {
    return this.state.isCapturing;
  }

  /**
   * Toggle audio capture on/off
   * Returns the new capturing state
   */
  async toggle(): Promise<boolean> {
    const wasCapturing = this.state.isCapturing;
    console.log(`[SystemAudio] Toggle called, wasCapturing: ${wasCapturing}`);
    
    if (wasCapturing) {
      await this.stop();
      // Wait a bit for state to update
      await new Promise(resolve => setTimeout(resolve, 100));
      return false;
    } else {
      await this.start();
      // Wait for the started message to arrive
      await new Promise(resolve => setTimeout(resolve, 500));
      return this.state.isCapturing;
    }
  }

  /**
   * Initialize the system audio helper with a window reference
   */
  initialize(window: BrowserWindow): void {
    this.mainWindow = window;
    this.registerIpcHandlers();
  }

  /**
   * Get the path to the phantom-audio executable
   */
  private getExecutablePath(): string {
    const isDev = process.env.NODE_ENV === "development";
    
    if (isDev) {
      // In development, look for it in the native build directory
      return path.join(
        app.getAppPath(),
        "native",
        "phantom-audio",
        "build",
        "bin",
        "phantom-audio.exe"
      );
    } else {
      // In production, it's in the resources folder
      return path.join(process.resourcesPath, "phantom-audio.exe");
    }
  }

  /**
   * Get the path to the Whisper model
   */
  private getModelPath(): string {
    const isDev = process.env.NODE_ENV === "development";
    const modelName = "ggml-small.en.q5_1.bin";
    
    if (isDev) {
      // In development, look in a local models directory
      return path.join(app.getAppPath(), "resources", "models", "whisper", modelName);
    } else {
      // In production, it's in the resources folder
      return path.join(process.resourcesPath, "models", "whisper", modelName);
    }
  }

  /**
   * Download the Whisper model if missing
   */
  private async downloadModel(modelPath: string): Promise<void> {
    const modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin";
    const modelDir = path.dirname(modelPath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }

    console.log(`[SystemAudio] Downloading Whisper model from ${modelUrl}...`);

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(modelPath);
      
      https.get(modelUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error("Redirect without location header"));
            return;
          }

          https.get(redirectUrl, (redirectResponse) => {
            const totalBytes = parseInt(redirectResponse.headers['content-length'] || '0', 10);
            let downloadedBytes = 0;
            let lastLoggedPercent = 0;

            redirectResponse.on('data', (chunk) => {
              downloadedBytes += chunk.length;
              const percent = Math.floor((downloadedBytes / totalBytes) * 100);
              if (percent >= lastLoggedPercent + 10) {
                console.log(`[SystemAudio] Download progress: ${percent}%`);
                lastLoggedPercent = percent;
              }
            });

            redirectResponse.pipe(file);

            file.on('finish', () => {
              file.close();
              console.log(`[SystemAudio] Model downloaded successfully to ${modelPath}`);
              resolve();
            });
          }).on('error', (err) => {
            fs.unlink(modelPath, () => {}); // Delete partial file
            reject(err);
          });
        } else {
          const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
          let downloadedBytes = 0;
          let lastLoggedPercent = 0;

          response.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            const percent = Math.floor((downloadedBytes / totalBytes) * 100);
            if (percent >= lastLoggedPercent + 10) {
              console.log(`[SystemAudio] Download progress: ${percent}%`);
              lastLoggedPercent = percent;
            }
          });

          response.pipe(file);

          file.on('finish', () => {
            file.close();
            console.log(`[SystemAudio] Model downloaded successfully to ${modelPath}`);
            resolve();
          });
        }
      }).on('error', (err) => {
        fs.unlink(modelPath, () => {}); // Delete partial file
        reject(err);
      });

      file.on('error', (err) => {
        fs.unlink(modelPath, () => {});
        reject(err);
      });
    });
  }

  /**
   * Check if required files exist, download model if missing
   */
  private async checkRequirements(): Promise<{ valid: boolean; error?: string }> {
    const execPath = this.getExecutablePath();
    const modelPath = this.getModelPath();

    if (!fs.existsSync(execPath)) {
      return {
        valid: false,
        error: `phantom-audio executable not found at: ${execPath}`,
      };
    }

    // Check if model exists, download if missing
    if (!fs.existsSync(modelPath)) {
      console.log(`[SystemAudio] Whisper model not found at: ${modelPath}. Downloading...`);
      try {
        await this.downloadModel(modelPath);
      } catch (error: any) {
        return {
          valid: false,
          error: `Failed to download Whisper model: ${error.message || String(error)}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Register IPC handlers for system audio
   */
  private registerIpcHandlers(): void {
    // Start system audio capture
    ipcMain.handle("system-audio:start", async () => {
      try {
        await this.start();
        return { success: true };
      } catch (error: any) {
        console.error("[SystemAudio] Start error:", error);
        return { success: false, error: error.message || String(error) };
      }
    });

    // Stop system audio capture
    ipcMain.handle("system-audio:stop", async () => {
      try {
        await this.stop();
        return { success: true };
      } catch (error: any) {
        console.error("[SystemAudio] Stop error:", error);
        return { success: false, error: error.message || String(error) };
      }
    });

    // Toggle system audio capture
    ipcMain.handle("system-audio:toggle", async () => {
      try {
        const isCapturing = await this.toggle();
        // Emit toggled event to notify the renderer
        this.sendToRenderer("system-audio:toggled", { isCapturing });
        return { success: true, isCapturing };
      } catch (error: any) {
        console.error("[SystemAudio] Toggle error:", error);
        return { success: false, error: error.message || String(error) };
      }
    });

    // Shutdown the audio process completely
    ipcMain.handle("system-audio:shutdown", async () => {
      try {
        await this.shutdown();
        return { success: true };
      } catch (error: any) {
        console.error("[SystemAudio] Shutdown error:", error);
        return { success: false, error: error.message || String(error) };
      }
    });

    // Get current state
    ipcMain.handle("system-audio:get-state", () => {
      return { success: true, data: this.state };
    });

    // Check if system audio is available
    ipcMain.handle("system-audio:check-availability", async () => {
      const check = await this.checkRequirements();
      return {
        success: check.valid,
        available: check.valid,
        error: check.error,
      };
    });
  }

  /**
   * Start the audio capture process
   */
  async start(): Promise<void> {
    // Clear any pending idle timer since we're starting again
    this.clearIdleTimer();

    if (this.audioProcess) {
      if (this.state.isCapturing) {
        console.log("[SystemAudio] Already capturing");
        return;
      }
      // Process exists but not capturing, send start command
      this.sendCommand({ cmd: "start" });
      return;
    }

    const check = await this.checkRequirements();
    if (!check.valid) {
      throw new Error(check.error);
    }

    const execPath = this.getExecutablePath();
    const modelPath = this.getModelPath();

    console.log("[SystemAudio] Starting phantom-audio process");
    console.log("[SystemAudio] Executable:", execPath);
    console.log("[SystemAudio] Model:", modelPath);

    return new Promise((resolve, reject) => {
      try {
        this.audioProcess = spawn(execPath, ["--model", modelPath], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        this.dataBuffer = "";

        // Handle stdout (JSON messages)
        this.audioProcess.stdout.on("data", (data: Buffer) => {
          this.handleStdout(data);
        });

        // Handle stderr (debug logs)
        this.audioProcess.stderr.on("data", (data: Buffer) => {
          console.log("[phantom-audio]", data.toString().trim());
        });

        // Handle process exit
        this.audioProcess.on("exit", (code, signal) => {
          console.log(`[SystemAudio] Process exited with code ${code}, signal ${signal}`);
          this.audioProcess = null;
          this.state.isCapturing = false;
          this.state.isReady = false;
          this.sendToRenderer("system-audio:stopped", {});
        });

        // Handle errors
        this.audioProcess.on("error", (error) => {
          console.error("[SystemAudio] Process error:", error);
          this.state.lastError = error.message;
          this.sendToRenderer("system-audio:error", { message: error.message });
          reject(error);
        });

        // Wait for ready signal, then send start command
        const readyTimeout = setTimeout(() => {
          if (!this.state.isReady) {
            reject(new Error("Timeout waiting for phantom-audio to be ready"));
          }
        }, 10000);

        const checkReady = setInterval(() => {
          if (this.state.isReady) {
            clearInterval(checkReady);
            clearTimeout(readyTimeout);
            this.sendCommand({ cmd: "start" });
            resolve();
          }
        }, 100);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop audio capture (but keep process running for quick restart)
   * Starts an idle timer to shutdown after IDLE_TIMEOUT_MS if not restarted
   */
  async stop(): Promise<void> {
    if (!this.audioProcess) {
      return;
    }

    this.sendCommand({ cmd: "stop" });
    this.lastStopTime = Date.now();
    this.startIdleTimer();
  }

  /**
   * Start the idle timer to shutdown process after timeout
   */
  private startIdleTimer(): void {
    this.clearIdleTimer();
    
    console.log(`[SystemAudio] Starting idle timer (${SystemAudioHelper.IDLE_TIMEOUT_MS / 1000 / 60} minutes)`);
    
    this.idleTimer = setTimeout(async () => {
      if (!this.state.isCapturing && this.audioProcess) {
        console.log("[SystemAudio] Idle timeout reached, shutting down process to free memory");
        await this.shutdown();
      }
    }, SystemAudioHelper.IDLE_TIMEOUT_MS);
  }

  /**
   * Clear the idle timer
   */
  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Shutdown the audio process completely
   */
  async shutdown(): Promise<void> {
    this.clearIdleTimer();
    
    if (!this.audioProcess) {
      return;
    }

    this.sendCommand({ cmd: "exit" });

    // Give it a moment to exit gracefully
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Force kill if still running
    if (this.audioProcess) {
      this.audioProcess.kill("SIGTERM");
      this.audioProcess = null;
    }

    this.state.isCapturing = false;
    this.state.isReady = false;
  }

  /**
   * Send a command to the audio process
   */
  private sendCommand(cmd: object): void {
    if (!this.audioProcess || !this.audioProcess.stdin.writable) {
      console.warn("[SystemAudio] Cannot send command - process not running");
      return;
    }

    const json = JSON.stringify(cmd) + "\n";
    this.audioProcess.stdin.write(json);
  }

  /**
   * Handle stdout data from the audio process
   */
  private handleStdout(data: Buffer): void {
    this.dataBuffer += data.toString();

    // Process complete lines
    const lines = this.dataBuffer.split("\n");
    this.dataBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const msg: TranscriptMessage = JSON.parse(line);
        this.handleMessage(msg);
      } catch (error) {
        console.warn("[SystemAudio] Failed to parse message:", line);
      }
    }
  }

  /**
   * Handle a parsed message from the audio process
   */
  private handleMessage(msg: TranscriptMessage): void {
    console.log("[SystemAudio] Message:", msg.type, msg.text || msg.message || "");

    switch (msg.type) {
      case "ready":
        this.state.isReady = true;
        this.sendToRenderer("system-audio:ready", {});
        break;

      case "started":
        this.state.isCapturing = true;
        this.sendToRenderer("system-audio:started", {});
        break;

      case "stopped":
        this.state.isCapturing = false;
        this.sendToRenderer("system-audio:stopped", {});
        break;

      case "partial":
        this.sendToRenderer("system-audio:transcript", {
          type: "partial",
          text: msg.text || "",
        });
        break;

      case "final":
        this.sendToRenderer("system-audio:transcript", {
          type: "final",
          text: msg.text || "",
        });
        break;

      case "error":
        this.state.lastError = msg.message || "Unknown error";
        this.sendToRenderer("system-audio:error", {
          message: msg.message,
        });
        break;
    }
  }

  /**
   * Send an event to the renderer process
   */
  private sendToRenderer(channel: string, data: object): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Clean up when app is closing
   */
  cleanup(): void {
    this.shutdown();
  }
}

// Singleton instance
export const systemAudioHelper = new SystemAudioHelper();
