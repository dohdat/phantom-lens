/**
 * Type declarations for System Audio API
 * 
 * This file declares the global window.systemAudio interface
 * that is exposed from the preload script.
 */

interface TranscriptMessage {
  type: "partial" | "final";
  text: string;
}

interface SystemAudioState {
  isCapturing: boolean;
  isReady: boolean;
  lastError: string | null;
}

interface SystemAudioAPI {
  /** Start system audio capture and transcription */
  start: () => Promise<{ success: boolean; error?: string }>;
  
  /** Stop capture (but keep process running) */
  stop: () => Promise<{ success: boolean; error?: string }>;
  
  /** Toggle capture on/off */
  toggle: () => Promise<{ success: boolean; isCapturing?: boolean; error?: string }>;
  
  /** Shutdown the audio process completely */
  shutdown: () => Promise<{ success: boolean; error?: string }>;
  
  /** Get current state */
  getState: () => Promise<{
    success: boolean;
    data?: SystemAudioState;
    error?: string;
  }>;
  
  /** Check if system audio is available on this platform */
  checkAvailability: () => Promise<{
    success: boolean;
    available: boolean;
    error?: string;
  }>;
  
  /** Subscribe to transcript events */
  onTranscript: (callback: (msg: TranscriptMessage) => void) => () => void;
  
  /** Subscribe to started event */
  onStarted: (callback: () => void) => () => void;
  
  /** Subscribe to stopped event */
  onStopped: (callback: () => void) => () => void;
  
  /** Subscribe to ready event */
  onReady: (callback: () => void) => () => void;
  
  /** Subscribe to error events */
  onError: (callback: (error: { message: string }) => void) => () => void;
  
  /** Subscribe to toggle events (from keyboard shortcuts) */
  onToggled: (callback: (data: { isCapturing: boolean }) => void) => () => void;
}

declare global {
  interface Window {
    /**
     * System Audio API for Windows system audio capture and transcription.
     * Only available on Windows platform.
     */
    systemAudio?: SystemAudioAPI;
    
    /**
     * Current platform (darwin, win32, linux)
     */
    platform?: string;
  }
}

export {};
