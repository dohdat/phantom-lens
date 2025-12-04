/**
 * useMeetingAssistant - React hook for meeting audio capture with auto-send to Gemini
 * 
 * Features:
 * - Captures system audio and transcribes it
 * - Detects 2 seconds of silence and auto-sends transcript to Gemini
 * - Generates smart questions based on the conversation
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useSystemAudio } from "./useSystemAudio";

interface MeetingAssistantState {
  isActive: boolean;
  isProcessing: boolean;
  lastSentTranscript: string;
  suggestedQuestions: string[];
}

interface UseMeetingAssistantOptions {
  /** Silence duration in ms before sending to Gemini */
  silenceThreshold?: number;
  /** Minimum transcript length before sending */
  minTranscriptLength?: number;
  /** Callback when transcript is sent for processing */
  onProcessTranscript?: (transcript: string) => void;
}

interface UseMeetingAssistantReturn {
  // From useSystemAudio
  isCapturing: boolean;
  isAvailable: boolean;
  transcript: string;
  currentPartial: string;
  error: string | null;
  // Meeting assistant specific
  isProcessing: boolean;
  suggestedQuestions: string[];
  lastSentTranscript: string;
  // Actions
  start: () => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
}

// Meeting assistant system prompt
export const MEETING_ASSISTANT_PROMPT = `You are an AI assistant helping an engineer during a meeting. Based on the conversation transcript below, suggest 2-3 smart, clarifying questions the engineer could ask.

Guidelines:
- Questions should be relevant to what was just discussed
- Focus on technical clarification, requirements, or next steps
- Keep questions concise and professional
- If the transcript is unclear or too short, suggest general follow-up questions

Format your response as a numbered list of questions only, no explanations.`;

export function useMeetingAssistant(options: UseMeetingAssistantOptions = {}): UseMeetingAssistantReturn {
  const {
    silenceThreshold = 2000, // 2 seconds
    minTranscriptLength = 50, // At least 50 chars
    onProcessTranscript,
  } = options;

  const {
    state,
    transcript: transcriptItems,
    currentPartial,
    fullTranscript,
    start: startAudio,
    stop: stopAudio,
    clear: clearAudio,
  } = useSystemAudio();

  const [assistantState, setAssistantState] = useState<MeetingAssistantState>({
    isActive: false,
    isProcessing: false,
    lastSentTranscript: "",
    suggestedQuestions: [],
  });

  // Track the last transcript update time for silence detection
  const lastUpdateTime = useRef<number>(Date.now());
  const silenceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedLength = useRef<number>(0);

  // Update last update time when transcript changes
  useEffect(() => {
    if (fullTranscript.length > lastProcessedLength.current) {
      lastUpdateTime.current = Date.now();
      
      // Clear existing timer
      if (silenceTimer.current) {
        clearTimeout(silenceTimer.current);
      }

      // Set new timer for silence detection
      if (state.isCapturing && fullTranscript.length >= minTranscriptLength) {
        silenceTimer.current = setTimeout(() => {
          // Check if there's new content since last processing
          const newContent = fullTranscript.slice(lastProcessedLength.current).trim();
          if (newContent.length >= minTranscriptLength) {
            processTranscript(fullTranscript);
          }
        }, silenceThreshold);
      }
    }

    return () => {
      if (silenceTimer.current) {
        clearTimeout(silenceTimer.current);
      }
    };
  }, [fullTranscript, state.isCapturing, silenceThreshold, minTranscriptLength]);

  // Process transcript and send to Gemini
  const processTranscript = useCallback(async (transcript: string) => {
    if (assistantState.isProcessing) return;
    
    setAssistantState((prev) => ({
      ...prev,
      isProcessing: true,
      lastSentTranscript: transcript,
    }));

    lastProcessedLength.current = transcript.length;

    // Call the callback if provided
    onProcessTranscript?.(transcript);

    // Send to Gemini via the existing processing infrastructure
    try {
      // Set the user prompt with meeting context
      const meetingPrompt = `${MEETING_ASSISTANT_PROMPT}\n\nConversation transcript:\n"${transcript}"\n\nSuggest questions:`;
      
      await window.electronAPI?.setUserPrompt(meetingPrompt);
      
      // Trigger screenshot + process (the screenshot provides visual context)
      await window.electronAPI?.triggerScreenshot();
      await window.electronAPI?.triggerProcessScreenshots();

      setAssistantState((prev) => ({
        ...prev,
        isProcessing: false,
      }));
    } catch (error) {
      console.error("[MeetingAssistant] Failed to process transcript:", error);
      setAssistantState((prev) => ({
        ...prev,
        isProcessing: false,
      }));
    }
  }, [assistantState.isProcessing, onProcessTranscript]);

  // Start meeting assistant
  const start = useCallback(async () => {
    setAssistantState((prev) => ({
      ...prev,
      isActive: true,
      suggestedQuestions: [],
      lastSentTranscript: "",
    }));
    lastProcessedLength.current = 0;
    await startAudio();
  }, [startAudio]);

  // Stop meeting assistant
  const stop = useCallback(async () => {
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
    }
    setAssistantState((prev) => ({
      ...prev,
      isActive: false,
    }));
    await stopAudio();
  }, [stopAudio]);

  // Clear everything
  const clear = useCallback(() => {
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
    }
    lastProcessedLength.current = 0;
    setAssistantState({
      isActive: false,
      isProcessing: false,
      lastSentTranscript: "",
      suggestedQuestions: [],
    });
    clearAudio();
  }, [clearAudio]);

  // Listen for toggle events from keyboard shortcut
  useEffect(() => {
    const handleToggle = (data: { isCapturing: boolean }) => {
      if (data.isCapturing) {
        setAssistantState((prev) => ({
          ...prev,
          isActive: true,
          suggestedQuestions: [],
        }));
        lastProcessedLength.current = 0;
      } else {
        if (silenceTimer.current) {
          clearTimeout(silenceTimer.current);
        }
        setAssistantState((prev) => ({
          ...prev,
          isActive: false,
        }));
      }
    };

    // Listen for the toggle event from keyboard shortcut (via systemAudio API)
    const cleanup = (window as any).systemAudio?.onToggled?.(handleToggle);
    return () => cleanup?.();
  }, []);

  return {
    isCapturing: state.isCapturing,
    isAvailable: state.isAvailable,
    transcript: fullTranscript,
    currentPartial,
    error: state.error,
    isProcessing: assistantState.isProcessing,
    suggestedQuestions: assistantState.suggestedQuestions,
    lastSentTranscript: assistantState.lastSentTranscript,
    start,
    stop,
    clear,
  };
}
