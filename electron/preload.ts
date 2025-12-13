console.log("Preload script starting...");

import { contextBridge, ipcRenderer } from "electron";

// Types for system audio transcript messages
interface TranscriptMessage {
  type: "partial" | "final";
  text: string;
}

// Types for the exposed Electron API
interface ElectronAPI {
  updateContentDimensions: (dimensions: {
    width?: number | string;  // Made optional to fix TypeScript error
    height: number;
  }) => Promise<void>;
  setFixedResponseWidth: () => Promise<{ success: boolean; data?: { fixedWidth: number }; error?: string }>;
  clearStore: () => Promise<{ success: boolean; error?: string }>;
  // process
  getScreenshots: () => Promise<{
    success: boolean;
    previews?: Array<{ path: string; preview: string }> | null;
    error?: string;
  }>;
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void;
  onResetView: (callback: () => void) => () => void;
  onResponseStart: (callback: () => void) => () => void;
  onFollowUpStart: (callback: () => void) => () => void;
  onFollowUpSuccess: (callback: (data: any) => void) => () => void;
  onResponseError: (callback: (error: string) => void) => () => void;
  onResponseSuccess: (callback: (data: any) => void) => () => void;
  onFollowUpError: (callback: (error: string) => void) => () => void;
  onResponseChunk: (callback: (chunk: string) => void) => () => void;
  onFollowUpChunk: (callback: (data: { response: string }) => void) => () => void;
  // shortcuts
  toggleMainWindow: () => Promise<{ success: boolean; error?: string }>;
  triggerScreenshot: () => Promise<{ success: boolean; error?: string }>;
  triggerReset: () => Promise<{ success: boolean; error?: string }>;
  // processing
  processScreenshots: () => Promise<{ success: boolean; error?: string }>;
  triggerProcessScreenshots: () => Promise<{ success: boolean; error?: string }>;
  processFollowUp: () => Promise<{ success: boolean; error?: string }>;
  processAudioTranscript: (prompt: string) => Promise<{ success: boolean; error?: string }>;
  processAudioWithScreenshot: (prompt: string) => Promise<{ success: boolean; error?: string }>;
  getScreenshotIntervalSeconds: () => Promise<{
    success: boolean;
    data?: { intervalSeconds: number };
    error?: string;
  }>;
  setScreenshotIntervalSeconds: (intervalSeconds: number) => Promise<{
    success: boolean;
    data?: { intervalSeconds: number };
    error?: string;
  }>;
  // movement
  triggerMoveLeft: () => Promise<{ success: boolean; error?: string }>;
  triggerMoveRight: () => Promise<{ success: boolean; error?: string }>;
  triggerMoveUp: () => Promise<{ success: boolean; error?: string }>;
  triggerMoveDown: () => Promise<{ success: boolean; error?: string }>;
  // helper
  getPlatform: () => string;
  getStoreValue: (key: string) => Promise<any>;
  setStoreValue: (key: string, value: any) => Promise<void>;
  setApiConfig: (config: {
    apiKey: string;
    model: string;
  }) => Promise<{ success: boolean; error?: string }>;
  getApiConfig: () => Promise<{
    success: boolean;
    data?: {
      apiKey: string;
      model: string;
      provider: string;
    };
    error?: string;
  }>;
  onApiKeyUpdated: (callback: () => void) => () => void;
  onApiKeyMissing: (callback: () => void) => () => void;
  onFocusPromptInput: (callback: () => void) => () => void;
  setIgnoreMouseEvents: () => Promise<{ success: boolean; error?: string }>;
  setInteractiveMouseEvents: () => Promise<{
    success: boolean;
    error?: string;
  }>;
  // NEW: Safe mouse event alternatives
  enableSafeClickThrough: () => Promise<{ success: boolean; error?: string }>;
  restoreInteractiveMode: () => Promise<{ success: boolean; error?: string }>;
  emergencyMouseRecovery: () => Promise<{ success: boolean; error?: string }>;

  // GitHub Update Check methods
  checkGitHubUpdate: () => Promise<{
    success: boolean;
    data?: {
      updateAvailable: boolean;
      currentVersion: string;
      latestVersion: string;
      releaseUrl?: string;
      releaseName?: string;
      publishedAt?: string;
      error?: string;
    };
    error?: string;
  }>;
  // GitHub Update event listeners
  onDownloadUpdate: (callback: (url?: string) => void) => () => void;
  // Application control
  quitApplication: () => Promise<{ success: boolean; error?: string }>;
  // Mode & history
  getMode: () => Promise<{ success: boolean; data?: { mode: "normal"|"stealth" }; error?: string }>;
  setMode: (mode: "normal"|"stealth") => Promise<{ success: boolean; error?: string }>;
  onModeChanged: (cb: (data: { mode: "normal"|"stealth" }) => void) => () => void;
  onHistoryLoad: (cb: (data: { content: string }) => void) => () => void;
  onResponseScroll: (cb: (data: { delta: number }) => void) => () => void;
  // Prompt
  setUserPrompt: (prompt: string) => Promise<{ success: boolean; error?: string }>;
  getUserPrompt: () => Promise<{ success: boolean; data?: { prompt: string }; error?: string }>;
  // Settings
  onOpenSettings: (callback: () => void) => () => void;
  onSettingsUnlock: (callback: () => void) => () => void;
  onToggleTransparency: (callback: () => void) => () => void;
  // System Prompt
  getSystemPrompt: () => Promise<{
    success: boolean;
    data?: { prompt: string | null };
    error?: string;
  }>;
  setSystemPrompt: (prompt: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  getDefaultSystemPrompt: () => Promise<{
    success: boolean;
    data?: { prompt: string };
    error?: string;
  }>;
  // Audio Prompt (for Meeting Assistant)
  getAudioPrompt: () => Promise<{
    success: boolean;
    data?: { prompt: string | null };
    error?: string;
  }>;
  getAudioPromptVersion: () => Promise<{
    success: boolean;
    data?: { version: string };
    error?: string;
  }>;
  setAudioPromptVersion: (version: string) => Promise<{
    success: boolean;
    data?: { version: string };
    error?: string;
  }>;
  getDefaultAudioPrompt: (version?: string) => Promise<{
    success: boolean;
    data?: { prompt: string; version?: string };
    error?: string;
  }>;
  setAudioPrompt: (prompt: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  // Audio Route Models
  getAudioOnlyModel: () => Promise<{
    success: boolean;
    data?: { model: string };
    error?: string;
  }>;
  setAudioOnlyModel: (model: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  getAudioScreenshotModel: () => Promise<{
    success: boolean;
    data?: { model: string };
    error?: string;
  }>;
  setAudioScreenshotModel: (model: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  getVisionModel: () => Promise<{
    success: boolean;
    data?: { model: string };
    error?: string;
  }>;
  setVisionModel: (model: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  getTextModel: () => Promise<{
    success: boolean;
    data?: { model: string };
    error?: string;
  }>;
  setTextModel: (model: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  // Whisper Configuration
  getWhisperConfig: () => Promise<{
    success: boolean;
    data?: { mode: "local" | "cloud"; modelPath: string | null; groqModel: string };
    error?: string;
  }>;
  setWhisperConfig: (config: { mode?: "local" | "cloud"; modelPath?: string; groqModel?: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;
  // Whisper Model
  getWhisperModelPath: () => Promise<{
    success: boolean;
    data?: { modelPath: string | null };
    error?: string;
  }>;
  setWhisperModelPath: (modelPath: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  getDefaultWhisperModelPath: () => Promise<{
    success: boolean;
    data?: { modelPath: string };
    error?: string;
  }>;
  // Groq API Parameters
  getMaxCompletionTokens: () => Promise<{
    success: boolean;
    data?: { maxCompletionTokens: number };
    error?: string;
  }>;
  setMaxCompletionTokens: (maxTokens: number) => Promise<{
    success: boolean;
    error?: string;
  }>;
  getReasoningEffort: () => Promise<{
    success: boolean;
    data?: { reasoningEffort: string };
    error?: string;
  }>;
  setReasoningEffort: (effort: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  // Usage Counter
  getAppOpenCount: () => Promise<{
    success: boolean;
    data?: { count: number };
    error?: string;
  }>;
  setStatsServerEndpoint: (endpoint: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  getStatsServerEndpoint: () => Promise<{
    success: boolean;
    data?: { endpoint: string | null };
    error?: string;
  }>;
  resetAppOpenCount: () => Promise<{
    success: boolean;
    error?: string;
  }>;
  // Auto Update
  checkForAutoUpdate: () => Promise<{ success: boolean; error?: string }>;
  downloadAutoUpdate: () => Promise<{ success: boolean; error?: string }>;
  installAutoUpdate: () => Promise<{ success: boolean; error?: string }>;
  getAutoUpdateStatus: () => Promise<{
    success: boolean;
    data?: {
      status: "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
      version?: string;
      error?: string;
    };
    error?: string;
  }>;
  onAutoUpdateProgress: (callback: (progress: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  }) => void) => () => void;
  onAutoUpdateDownloaded: (callback: (info: {
    version: string;
    releaseNotes?: string;
    releaseName?: string;
    releaseDate?: string;
  }) => void) => () => void;
  onAutoUpdateError: (callback: (error: { message: string }) => void) => () => void;
}

// System Audio API interface (exposed separately)
interface SystemAudioAPI {
  start: () => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean; error?: string }>;
  toggle: () => Promise<{ success: boolean; isCapturing?: boolean; error?: string }>;
  shutdown: () => Promise<{ success: boolean; error?: string }>;
  getState: () => Promise<{
    success: boolean;
    data?: { isCapturing: boolean; isReady: boolean; lastError: string | null };
    error?: string;
  }>;
  checkAvailability: () => Promise<{
    success: boolean;
    available: boolean;
    error?: string;
  }>;
  onTranscript: (callback: (msg: TranscriptMessage) => void) => () => void;
  onStarted: (callback: () => void) => () => void;
  onStopped: (callback: () => void) => () => void;
  onReady: (callback: () => void) => () => void;
  onError: (callback: (error: { message: string }) => void) => () => void;
  onToggled: (callback: (data: { isCapturing: boolean; mode?: "audio-only" | "audio-screenshot" }) => void) => () => void;
}

export const PROCESSING_EVENTS = {
  // states for generating the initial solution
  INITIAL_START: "initial-start",
  RESPONSE_SUCCESS: "response-success",
  INITIAL_RESPONSE_ERROR: "response-error",
  RESET: "reset",
  RESPONSE_CHUNK: "response-chunk",

  // states for processing the debugging
  FOLLOW_UP_START: "follow-up-start",
  FOLLOW_UP_SUCCESS: "follow-up-success",
  FOLLOW_UP_ERROR: "follow-up-error",
  FOLLOW_UP_CHUNK: "follow-up-chunk",
} as const;

console.log("Preload script is running");

const electronAPI = {
  updateContentDimensions: (dimensions: { width?: number | string; height: number }) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  setFixedResponseWidth: () => ipcRenderer.invoke("set-fixed-response-width"),
  clearFixedResponseWidth: () => ipcRenderer.invoke("clear-fixed-response-width"),
  clearStore: () => ipcRenderer.invoke("clear-store"),
  getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
  toggleMainWindow: async () => {
    console.log("toggleMainWindow called from preload");
    try {
      const result = await ipcRenderer.invoke("toggle-window");
      console.log("toggle-window result:", result);
      return result;
    } catch (error) {
      console.error("Error in toggleMainWindow:", error);
      throw error;
    }
  },
  // Event listeners
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data);
    ipcRenderer.on("screenshot-taken", subscription);
    return () => {
      ipcRenderer.removeListener("screenshot-taken", subscription);
    };
  },
  onResetView: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("reset-view", subscription);
    return () => {
      ipcRenderer.removeListener("reset-view", subscription);
    };
  },
  onResponseStart: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription);
    };
  },
  onFollowUpStart: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.FOLLOW_UP_START, subscription);
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.FOLLOW_UP_START,
        subscription
      );
    };
  },
  onFollowUpSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on(PROCESSING_EVENTS.FOLLOW_UP_SUCCESS, subscription);
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.FOLLOW_UP_SUCCESS,
        subscription
      );
    };
  },
  onFollowUpError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error);
    ipcRenderer.on(PROCESSING_EVENTS.FOLLOW_UP_ERROR, subscription);
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.FOLLOW_UP_ERROR,
        subscription
      );
    };
  },
  onFollowUpChunk: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on(PROCESSING_EVENTS.FOLLOW_UP_CHUNK, subscription);
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.FOLLOW_UP_CHUNK,
        subscription
      );
    };
  },
  onResponseError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error);
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR, subscription);
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.INITIAL_RESPONSE_ERROR,
        subscription
      );
    };
  },
  onResponseSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on(PROCESSING_EVENTS.RESPONSE_SUCCESS, subscription);
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.RESPONSE_SUCCESS,
        subscription
      );
    };
  },
  triggerScreenshot: () => ipcRenderer.invoke("trigger-screenshot"),
  triggerReset: () => ipcRenderer.invoke("trigger-reset"),
  processScreenshots: () => ipcRenderer.invoke("process-screenshots"),
  triggerProcessScreenshots: () => ipcRenderer.invoke("trigger-process-screenshots"),
  processFollowUp: () => ipcRenderer.invoke("process-follow-up"),
  processAudioTranscript: (prompt: string) => ipcRenderer.invoke("process-audio-transcript", prompt),
  processAudioWithScreenshot: (prompt: string) => ipcRenderer.invoke("process-audio-with-screenshot", prompt),
  getScreenshotIntervalSeconds: () => ipcRenderer.invoke("get-screenshot-interval-seconds"),
  setScreenshotIntervalSeconds: (intervalSeconds: number) => ipcRenderer.invoke("set-screenshot-interval-seconds", intervalSeconds),
  triggerMoveLeft: () => ipcRenderer.invoke("trigger-move-left"),
  triggerMoveRight: () => ipcRenderer.invoke("trigger-move-right"),
  triggerMoveUp: () => ipcRenderer.invoke("trigger-move-up"),
  triggerMoveDown: () => ipcRenderer.invoke("trigger-move-down"),
  getPlatform: () => process.platform,
  getStoreValue: (key: string) => ipcRenderer.invoke("get-store-value", key),
  setStoreValue: (key: string, value: any) =>
    ipcRenderer.invoke("set-store-value", key, value),
  setApiConfig: (config: { apiKey: string; model: string }) =>
    ipcRenderer.invoke("set-api-config", config),
  getApiConfig: () => ipcRenderer.invoke("get-api-config"),
  onApiKeyUpdated: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("api-key-updated", subscription);
    return () => {
      ipcRenderer.removeListener("api-key-updated", subscription);
    };
  },
  onApiKeyMissing: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("api-key-missing", subscription);
    return () => ipcRenderer.removeListener("api-key-missing", subscription);
  },
  onFocusPromptInput: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("focus-prompt-input", subscription);
    return () => {
      ipcRenderer.removeListener("focus-prompt-input", subscription);
    };
  },
  setIgnoreMouseEvents: () => ipcRenderer.invoke("set-ignore-mouse-events"),
  setInteractiveMouseEvents: () =>
    ipcRenderer.invoke("set-interactive-mouse-events"),
  // NEW: Safe mouse event alternatives  
  enableSafeClickThrough: () => ipcRenderer.invoke("enable-safe-click-through"),
  restoreInteractiveMode: () => ipcRenderer.invoke("restore-interactive-mode"),
  emergencyMouseRecovery: () => ipcRenderer.invoke("emergency-mouse-recovery"),

  // GitHub Update Check methods
  checkGitHubUpdate: () => ipcRenderer.invoke("check-github-update"),
  openUpdateDownload: (url?: string) => ipcRenderer.invoke("open-update-download", url),
  onDownloadUpdate: (callback: (url?: string) => void) => {
    const subscription = (_: any, url?: string) => callback(url);
    ipcRenderer.on("download-update", subscription);
    return () => {
      ipcRenderer.removeListener("download-update", subscription);
    };
  },
  
  quitApplication: () => ipcRenderer.invoke("quit-application"),
  // Mode & history
  getMode: () => ipcRenderer.invoke("get-mode"),
  setMode: (mode: "normal"|"stealth") => ipcRenderer.invoke("set-mode", mode),
  onModeChanged: (callback: (data: { mode: "normal"|"stealth" }) => void) => {
    const sub = (_: any, data: { mode: "normal"|"stealth" }) => callback(data);
    ipcRenderer.on("mode-changed", sub);
    return () => ipcRenderer.removeListener("mode-changed", sub);
  },
  onResponseScroll: (callback: (data: { delta: number }) => void) => {
    const sub = (_: any, data: { delta: number }) => callback(data);
    ipcRenderer.on("response-scroll", sub);
    return () => ipcRenderer.removeListener("response-scroll", sub);
  },
  onCodeBlockScroll: (callback: (data: { delta: number }) => void) => {
    const sub = (_: any, data: { delta: number }) => callback(data);
    ipcRenderer.on("code-block-scroll", sub);
    return () => ipcRenderer.removeListener("code-block-scroll", sub);
  },
  onHistoryLoad: (callback: (data: { content: string }) => void) => {
    const sub = (_: any, data: { content: string }) => callback(data);
    ipcRenderer.on("history-load", sub);
    return () => ipcRenderer.removeListener("history-load", sub);
  },
  setUserPrompt: (prompt: string) => ipcRenderer.invoke("set-user-prompt", prompt),
  getUserPrompt: () => ipcRenderer.invoke("get-user-prompt"),
  onResponseChunk: (callback: (chunk: string) => void) => {
    const subscription = (_: any, chunk: string) => callback(chunk);
    ipcRenderer.on(PROCESSING_EVENTS.RESPONSE_CHUNK, subscription);
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.RESPONSE_CHUNK,
        subscription
      );
    };
  },
  onOpenSettings: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("open-settings", subscription);
    return () => {
      ipcRenderer.removeListener("open-settings", subscription);
    };
  },
  onSettingsUnlock: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("settings-unlock", subscription);
    return () => {
      ipcRenderer.removeListener("settings-unlock", subscription);
    };
  },
  onToggleTransparency: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("toggle-transparency", subscription);
    return () => {
      ipcRenderer.removeListener("toggle-transparency", subscription);
    };
  },
  // System Prompt
  getSystemPrompt: () => ipcRenderer.invoke("get-system-prompt"),
  setSystemPrompt: (prompt: string) => ipcRenderer.invoke("set-system-prompt", prompt),
  getDefaultSystemPrompt: () => ipcRenderer.invoke("get-default-system-prompt"),
  // Audio Prompt (for Meeting Assistant)
  getAudioPrompt: () => ipcRenderer.invoke("get-audio-prompt"),
  getAudioPromptVersion: () => ipcRenderer.invoke("get-audio-prompt-version"),
  setAudioPromptVersion: (version: string) => ipcRenderer.invoke("set-audio-prompt-version", version),
  getAudioPromptNames: () => ipcRenderer.invoke("get-audio-prompt-names"),
  setAudioPromptName: (version: string, name: string) => ipcRenderer.invoke("set-audio-prompt-name", version, name),
  getDefaultAudioPrompt: (version?: string) => ipcRenderer.invoke("get-default-audio-prompt", version),
  setAudioPrompt: (prompt: string) => ipcRenderer.invoke("set-audio-prompt", prompt),
  // Audio Route Models
  getAudioOnlyModel: () => ipcRenderer.invoke("get-audio-only-model"),
  setAudioOnlyModel: (model: string) => ipcRenderer.invoke("set-audio-only-model", model),
  getAudioScreenshotModel: () => ipcRenderer.invoke("get-audio-screenshot-model"),
  setAudioScreenshotModel: (model: string) => ipcRenderer.invoke("set-audio-screenshot-model", model),
  // Vision and Text Models (for two-step processing)
  getVisionModel: () => ipcRenderer.invoke("get-vision-model"),
  setVisionModel: (model: string) => ipcRenderer.invoke("set-vision-model", model),
  getTextModel: () => ipcRenderer.invoke("get-text-model"),
  setTextModel: (model: string) => ipcRenderer.invoke("set-text-model", model),
  // Whisper Configuration
  getWhisperConfig: () => ipcRenderer.invoke("get-whisper-config"),
  setWhisperConfig: (config: { mode?: "local" | "cloud"; modelPath?: string; groqModel?: string }) =>
    ipcRenderer.invoke("set-whisper-config", config),
  // Whisper Model
  getWhisperModelPath: () => ipcRenderer.invoke("get-whisper-model-path"),
  setWhisperModelPath: (modelPath: string) => ipcRenderer.invoke("set-whisper-model-path", modelPath),
  getDefaultWhisperModelPath: () => ipcRenderer.invoke("get-default-whisper-model-path"),
  // Groq API Parameters
  getMaxCompletionTokens: () => ipcRenderer.invoke("get-max-completion-tokens"),
  setMaxCompletionTokens: (maxTokens: number) => ipcRenderer.invoke("set-max-completion-tokens", maxTokens),
  getReasoningEffort: () => ipcRenderer.invoke("get-reasoning-effort"),
  setReasoningEffort: (effort: string) => ipcRenderer.invoke("set-reasoning-effort", effort),
  // Auto Update
  checkForAutoUpdate: () => ipcRenderer.invoke("check-for-auto-update"),
  downloadAutoUpdate: () => ipcRenderer.invoke("download-auto-update"),
  installAutoUpdate: () => ipcRenderer.invoke("install-auto-update"),
  getAutoUpdateStatus: () => ipcRenderer.invoke("get-auto-update-status"),
  onAutoUpdateProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => {
    const subscription = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on("auto-update-progress", subscription);
    return () => {
      ipcRenderer.removeListener("auto-update-progress", subscription);
    };
  },
  onAutoUpdateDownloaded: (callback: (info: { version: string; releaseNotes?: string; releaseName?: string; releaseDate?: string }) => void) => {
    const subscription = (_event: any, info: any) => callback(info);
    ipcRenderer.on("auto-update-downloaded", subscription);
    return () => {
      ipcRenderer.removeListener("auto-update-downloaded", subscription);
    };
  },
  onAutoUpdateError: (callback: (error: { message: string }) => void) => {
    const subscription = (_event: any, error: any) => callback(error);
    ipcRenderer.on("auto-update-error", subscription);
    return () => {
      ipcRenderer.removeListener("auto-update-error", subscription);
    };
  },
  // Usage Counter
  getAppOpenCount: () => ipcRenderer.invoke("get-app-open-count"),
  setStatsServerEndpoint: (endpoint: string) =>
    ipcRenderer.invoke("set-stats-server-endpoint", endpoint),
  getStatsServerEndpoint: () => ipcRenderer.invoke("get-stats-server-endpoint"),
  resetAppOpenCount: () => ipcRenderer.invoke("reset-app-open-count"),
} as ElectronAPI;

// System Audio API - for Windows system audio capture and transcription
const systemAudioAPI: SystemAudioAPI = {
  start: () => ipcRenderer.invoke("system-audio:start"),
  stop: () => ipcRenderer.invoke("system-audio:stop"),
  toggle: () => ipcRenderer.invoke("system-audio:toggle"),
  shutdown: () => ipcRenderer.invoke("system-audio:shutdown"),
  getState: () => ipcRenderer.invoke("system-audio:get-state"),
  checkAvailability: () => ipcRenderer.invoke("system-audio:check-availability"),
  onTranscript: (callback: (msg: TranscriptMessage) => void) => {
    const subscription = (_event: any, msg: TranscriptMessage) => callback(msg);
    ipcRenderer.on("system-audio:transcript", subscription);
    return () => {
      ipcRenderer.removeListener("system-audio:transcript", subscription);
    };
  },
  onStarted: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("system-audio:started", subscription);
    return () => {
      ipcRenderer.removeListener("system-audio:started", subscription);
    };
  },
  onStopped: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("system-audio:stopped", subscription);
    return () => {
      ipcRenderer.removeListener("system-audio:stopped", subscription);
    };
  },
  onReady: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("system-audio:ready", subscription);
    return () => {
      ipcRenderer.removeListener("system-audio:ready", subscription);
    };
  },
  onError: (callback: (error: { message: string }) => void) => {
    const subscription = (_event: any, error: { message: string }) => callback(error);
    ipcRenderer.on("system-audio:error", subscription);
    return () => {
      ipcRenderer.removeListener("system-audio:error", subscription);
    };
  },
  onToggled: (callback: (data: { isCapturing: boolean; mode?: "audio-only" | "audio-screenshot" }) => void) => {
    const subscription = (_event: any, data: { isCapturing: boolean; mode?: "audio-only" | "audio-screenshot" }) => callback(data);
    ipcRenderer.on("system-audio:toggled", subscription);
    return () => {
      ipcRenderer.removeListener("system-audio:toggled", subscription);
    };
  },
};

// Before exposing the API
console.log(
  "About to expose electronAPI with methods:",
  Object.keys(electronAPI)
);

// Add this focus restoration handler
window.addEventListener("focus", () => {
  console.log("Window focused");
});

// Expose the API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Expose System Audio API (Windows only)
contextBridge.exposeInMainWorld("systemAudio", systemAudioAPI);

// Expose platform info
contextBridge.exposeInMainWorld("platform", process.platform);

// Log that preload is complete
console.log("Preload script completed");
