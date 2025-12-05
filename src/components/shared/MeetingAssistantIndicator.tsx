/**
 * MeetingAssistantIndicator - A minimal indicator showing meeting assistant status
 * 
 * Shows when audio capture is active, live transcript, and processing status.
 * 
 * Keyboard shortcuts:
 * - Ctrl+Shift+A: Toggle recording (sends transcript when stopping)
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

interface MeetingAssistantIndicatorProps {
  className?: string;
}

interface TranscriptMessage {
  type: "partial" | "final";
  text: string;
}

const DEFAULT_AUDIO_PROMPT = `You are an AI assistant helping a senior software engineer during a technical meeting. Based on the conversation transcript below, suggest 2-3 smart, clarifying questions that a senior engineer would ask.

Guidelines:
- Focus on architecture decisions, trade-offs, and scalability
- Ask about edge cases, error handling, and security implications
- Clarify requirements, dependencies, and technical constraints
- Questions should demonstrate deep technical understanding
- Keep questions concise and professional

Conversation transcript:
"{{TRANSCRIPT}}"

Suggest questions:`;

export function MeetingAssistantIndicator({ className = "" }: MeetingAssistantIndicatorProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNotification, setShowNotification] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [currentPartial, setCurrentPartial] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioPrompt, setAudioPrompt] = useState(DEFAULT_AUDIO_PROMPT);
  
  // Ref to access current transcript in keyboard handler
  const transcriptRef = useRef("");
  const currentPartialRef = useRef("");
  const audioPromptRef = useRef(DEFAULT_AUDIO_PROMPT);
  const wasCapturingRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { currentPartialRef.current = currentPartial; }, [currentPartial]);
  useEffect(() => { audioPromptRef.current = audioPrompt; }, [audioPrompt]);

  // Load audio prompt from settings on mount
  useEffect(() => {
    const loadAudioPrompt = async () => {
      try {
        const response = await (window as any).electronAPI?.getAudioPrompt?.();
        if (response?.success && response.data?.prompt) {
          setAudioPrompt(response.data.prompt);
        }
      } catch (e) {
        console.warn("Failed to load audio prompt from settings:", e);
      }
    };
    loadAudioPrompt();
  }, []);

  // Send transcript to Gemini
  const sendTranscriptToGemini = useCallback(async () => {
    const fullText = transcriptRef.current + (currentPartialRef.current ? " " + currentPartialRef.current : "");
    
    if (fullText.length < 10) {
      return;
    }

    setIsProcessing(true);

    try {
      const finalPrompt = audioPromptRef.current.replace('{{TRANSCRIPT}}', fullText);

      const result = await (window as any).electronAPI?.processAudioTranscript?.(finalPrompt);
      
      if (!result?.success) {
        await (window as any).electronAPI?.setUserPrompt(finalPrompt);
        await (window as any).electronAPI?.triggerProcessScreenshots();
      }
    } catch (err: any) {
      console.error('Failed to send transcript:', err);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // Listen for toggle events from keyboard shortcut (Ctrl+Shift+A)
  useEffect(() => {
    const handleToggle = async (data: { isCapturing: boolean }) => {
      // If stopping and we were capturing, send the transcript
      if (!data.isCapturing && wasCapturingRef.current) {
        await sendTranscriptToGemini();
      }
      
      wasCapturingRef.current = data.isCapturing;
      setIsCapturing(data.isCapturing);
      setError(null);
      setShowNotification(true);
      
      if (!data.isCapturing) {
        setTimeout(() => {
          setShowNotification(false);
          setTranscript("");
          setCurrentPartial("");
        }, 5000);
      } else {
        setTranscript("");
        setCurrentPartial("");
      }
    };

    const handleError = (data: { message: string }) => {
      setError(data.message);
      setShowNotification(true);
      setTimeout(() => {
        setShowNotification(false);
        setError(null);
      }, 5000);
    };

    const handleTranscript = (msg: TranscriptMessage) => {
      const text = msg.text?.trim() || "";
      
      if (!text) return;
      
      // Filter out Whisper's special tokens
      const isNonSpeech = 
        text === "[Blank_Audio]" || text === "[BLANK_AUDIO]" ||
        text.toLowerCase().includes("blank audio") ||
        text === "[Music]" || text === "[MUSIC]" ||
        (text.toLowerCase().includes("music") && text.length < 20) ||
        text === "[Silence]" || text === "[SILENCE]" ||
        text === "..." || 
        (text.startsWith("[") && text.endsWith("]") && text.length < 30) ||
        (text.startsWith("(") && text.endsWith(")") && text.length < 30);
      
      if (isNonSpeech) {
        return;
      }

      if (msg.type === "partial") {
        setCurrentPartial(text);
      } else if (msg.type === "final" && text.length > 0) {
        setTranscript((prev) => prev + (prev ? " " : "") + text);
        setCurrentPartial("");
      }
    };

    const cleanupToggle = (window as any).systemAudio?.onToggled?.(handleToggle);
    const cleanupError = (window as any).systemAudio?.onError?.(handleError);
    const cleanupTranscript = (window as any).systemAudio?.onTranscript?.(handleTranscript);
    
    return () => {
      cleanupToggle?.();
      cleanupError?.();
      cleanupTranscript?.();
    };
  }, [sendTranscriptToGemini]);

  const fullText = transcript + (currentPartial ? " " + currentPartial : "");

  return (
    <>
      {/* Main status area - positioned on the RIGHT */}
      <div className={`fixed top-2 right-2 flex flex-col gap-2 z-50 max-w-md ${className}`}>
        {/* Status bar */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Error indicator */}
          {error && (
            <div className="flex items-center gap-1.5 bg-red-600/95 text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg">
              <span>⚠️ {error}</span>
            </div>
          )}
          
          {/* Recording indicator */}
          {isCapturing && !error && (
            <div className="flex items-center gap-1.5 bg-red-500/95 text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              <span>🎤 Recording</span>
            </div>
          )}

          {/* Processing indicator */}
          {isProcessing && (
            <div className="flex items-center gap-1.5 bg-blue-500/95 text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Asking Gemini...</span>
            </div>
          )}

          {/* Stopped notification */}
          {!isCapturing && !error && showNotification && (
            <div className="flex items-center gap-1.5 bg-gray-700/95 text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg">
              <span>🎤 Stopped</span>
            </div>
          )}
        </div>

        {/* Live transcript */}
        {isCapturing && fullText && (
          <div className="bg-black/80 text-white/90 px-3 py-2 rounded-lg text-xs shadow-lg max-h-20 overflow-y-auto">
            <div className="flex justify-between text-white/50 text-[10px] mb-1">
              <span>Live Transcript ({fullText.length} chars)</span>
              <span className="text-purple-400">Stop recording to send</span>
            </div>
            <div>{transcript}<span className="text-yellow-300">{currentPartial}</span></div>
          </div>
        )}
      </div>
    </>
  );
}

export default MeetingAssistantIndicator;
