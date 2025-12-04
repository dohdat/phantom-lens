/**
 * MeetingAssistantIndicator - A minimal indicator showing meeting assistant status
 * 
 * Shows when audio capture is active, live transcript, and processing status.
 */

import React, { useState, useEffect, useRef } from "react";

interface MeetingAssistantIndicatorProps {
  className?: string;
}

interface TranscriptMessage {
  type: "partial" | "final";
  text: string;
}

export function MeetingAssistantIndicator({ className = "" }: MeetingAssistantIndicatorProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNotification, setShowNotification] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [currentPartial, setCurrentPartial] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Silence detection for auto-send
  const silenceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedLength = useRef(0);

  // Listen for toggle events from keyboard shortcut
  useEffect(() => {
    const handleToggle = (data: { isCapturing: boolean }) => {
      console.log("[MeetingAssistant] Toggled:", data.isCapturing);
      setIsCapturing(data.isCapturing);
      setError(null);
      setShowNotification(true);
      
      if (!data.isCapturing) {
        // Stopped - clear transcript after delay
        setTimeout(() => {
          setShowNotification(false);
          setTranscript("");
          setCurrentPartial("");
        }, 3000);
      } else {
        // Started - reset transcript
        setTranscript("");
        setCurrentPartial("");
        lastProcessedLength.current = 0;
      }
    };

    const handleError = (data: { message: string }) => {
      console.error("[MeetingAssistant] Error:", data.message);
      setError(data.message);
      setShowNotification(true);
      setTimeout(() => {
        setShowNotification(false);
        setError(null);
      }, 5000);
    };

    const handleTranscript = (msg: TranscriptMessage) => {
      console.log("[MeetingAssistant] Transcript:", msg.type, msg.text);
      if (msg.type === "partial") {
        setCurrentPartial(msg.text);
      } else if (msg.type === "final") {
        setTranscript((prev) => prev + (prev ? " " : "") + msg.text);
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
  }, []);

  // Silence detection - send to Gemini after 2 seconds of no new transcript
  useEffect(() => {
    const fullText = transcript + (currentPartial ? " " + currentPartial : "");
    
    if (isCapturing && fullText.length > lastProcessedLength.current && fullText.length >= 30) {
      // Clear existing timer
      if (silenceTimer.current) {
        clearTimeout(silenceTimer.current);
      }

      // Set new timer for silence detection
      silenceTimer.current = setTimeout(async () => {
        const newContent = fullText.slice(lastProcessedLength.current).trim();
        if (newContent.length >= 30) {
          console.log("[MeetingAssistant] Silence detected, sending to Gemini...");
          setIsProcessing(true);
          lastProcessedLength.current = fullText.length;

          try {
            // Create meeting assistant prompt
            const meetingPrompt = `You are an AI assistant helping an engineer during a meeting. Based on the conversation transcript below, suggest 2-3 smart, clarifying questions the engineer could ask.

Guidelines:
- Questions should be relevant to what was just discussed
- Focus on technical clarification, requirements, or next steps
- Keep questions concise and professional

Conversation transcript:
"${fullText}"

Suggest questions:`;

            await (window as any).electronAPI?.setUserPrompt(meetingPrompt);
            await (window as any).electronAPI?.triggerScreenshot();
            await (window as any).electronAPI?.triggerProcessScreenshots();
          } catch (err) {
            console.error("[MeetingAssistant] Failed to send to Gemini:", err);
          } finally {
            setIsProcessing(false);
          }
        }
      }, 2000);
    }

    return () => {
      if (silenceTimer.current) {
        clearTimeout(silenceTimer.current);
      }
    };
  }, [transcript, currentPartial, isCapturing]);

  // Don't show anything if no notification needed
  if (!showNotification && !isCapturing) {
    return null;
  }

  const fullText = transcript + (currentPartial ? " " + currentPartial : "");

  return (
    <div className={`fixed top-2 left-2 right-2 flex flex-col gap-2 z-50 ${className}`}>
      {/* Status bar */}
      <div className="flex items-center gap-2">
        {/* Error indicator */}
        {error && (
          <div className="flex items-center gap-1.5 bg-red-600/95 text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg">
            <span>⚠️</span>
            <span className="max-w-[300px] truncate">{error}</span>
          </div>
        )}
        
        {/* Recording indicator */}
        {isCapturing && !error && (
          <div className="flex items-center gap-1.5 bg-red-500/95 text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            <span>🎤 Meeting Assistant</span>
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
            <span>🎤 Meeting Assistant Stopped</span>
          </div>
        )}
      </div>

      {/* Live transcript */}
      {isCapturing && fullText && (
        <div className="bg-black/80 text-white/90 px-3 py-2 rounded-lg text-xs shadow-lg max-h-24 overflow-y-auto">
          <div className="text-white/50 text-[10px] mb-1">Live Transcript:</div>
          <div>{transcript}<span className="text-white/50">{currentPartial}</span></div>
        </div>
      )}
    </div>
  );
}

export default MeetingAssistantIndicator;
