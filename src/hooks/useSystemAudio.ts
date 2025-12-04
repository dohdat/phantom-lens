/**
 * useSystemAudio - React hook for system audio capture and transcription
 * 
 * This hook provides an interface to the Windows WASAPI loopback capture
 * and whisper.cpp transcription system.
 */

import { useState, useEffect, useCallback, useRef } from "react";

interface TranscriptMessage {
  type: "partial" | "final";
  text: string;
}

interface TranscriptItem {
  id: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
}

interface SystemAudioState {
  isAvailable: boolean;
  isCapturing: boolean;
  isReady: boolean;
  error: string | null;
}

interface UseSystemAudioReturn {
  state: SystemAudioState;
  transcript: TranscriptItem[];
  currentPartial: string;
  fullTranscript: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
}

// Declare the systemAudio API on window
declare global {
  interface Window {
    systemAudio?: {
      start: () => Promise<{ success: boolean; error?: string }>;
      stop: () => Promise<{ success: boolean; error?: string }>;
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
    };
    platform?: string;
  }
}

export function useSystemAudio(): UseSystemAudioReturn {
  const [state, setState] = useState<SystemAudioState>({
    isAvailable: false,
    isCapturing: false,
    isReady: false,
    error: null,
  });

  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [currentPartial, setCurrentPartial] = useState<string>("");
  const idCounter = useRef(0);

  // Check availability on mount
  useEffect(() => {
    const checkAvailability = async () => {
      // Only available on Windows
      if (window.platform !== "win32") {
        setState((prev) => ({
          ...prev,
          isAvailable: false,
          error: "System audio capture is only available on Windows",
        }));
        return;
      }

      if (!window.systemAudio) {
        setState((prev) => ({
          ...prev,
          isAvailable: false,
          error: "System audio API not available",
        }));
        return;
      }

      try {
        const result = await window.systemAudio.checkAvailability();
        setState((prev) => ({
          ...prev,
          isAvailable: result.available,
          error: result.error || null,
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isAvailable: false,
          error: "Failed to check system audio availability",
        }));
      }
    };

    checkAvailability();
  }, []);

  // Subscribe to system audio events
  useEffect(() => {
    if (!window.systemAudio) return;

    const cleanupFns: (() => void)[] = [];

    // Handle transcripts
    cleanupFns.push(
      window.systemAudio.onTranscript((msg) => {
        if (msg.type === "partial") {
          setCurrentPartial(msg.text);
        } else if (msg.type === "final") {
          setCurrentPartial("");
          if (msg.text.trim()) {
            setTranscript((prev) => [
              ...prev,
              {
                id: `transcript-${++idCounter.current}`,
                text: msg.text.trim(),
                timestamp: Date.now(),
                isFinal: true,
              },
            ]);
          }
        }
      })
    );

    // Handle started event
    cleanupFns.push(
      window.systemAudio.onStarted(() => {
        setState((prev) => ({
          ...prev,
          isCapturing: true,
          error: null,
        }));
      })
    );

    // Handle stopped event
    cleanupFns.push(
      window.systemAudio.onStopped(() => {
        setState((prev) => ({
          ...prev,
          isCapturing: false,
        }));
      })
    );

    // Handle ready event
    cleanupFns.push(
      window.systemAudio.onReady(() => {
        setState((prev) => ({
          ...prev,
          isReady: true,
        }));
      })
    );

    // Handle errors
    cleanupFns.push(
      window.systemAudio.onError((error) => {
        setState((prev) => ({
          ...prev,
          error: error.message,
          isCapturing: false,
        }));
      })
    );

    return () => {
      cleanupFns.forEach((cleanup) => cleanup());
    };
  }, []);

  // Start capturing
  const start = useCallback(async () => {
    if (!window.systemAudio) {
      setState((prev) => ({ ...prev, error: "System audio not available" }));
      return;
    }

    try {
      setState((prev) => ({ ...prev, error: null }));
      const result = await window.systemAudio.start();
      if (!result.success) {
        setState((prev) => ({ ...prev, error: result.error || "Failed to start" }));
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : "Failed to start capture",
      }));
    }
  }, []);

  // Stop capturing
  const stop = useCallback(async () => {
    if (!window.systemAudio) return;

    try {
      await window.systemAudio.stop();
    } catch (err) {
      console.error("Failed to stop system audio:", err);
    }
  }, []);

  // Clear transcript
  const clear = useCallback(() => {
    setTranscript([]);
    setCurrentPartial("");
  }, []);

  // Compute full transcript text
  const fullTranscript = transcript.map((t) => t.text).join(" ");

  return {
    state,
    transcript,
    currentPartial,
    fullTranscript,
    start,
    stop,
    clear,
  };
}
