/**
 * MeetingAssistantIndicator - A minimal indicator showing meeting assistant status
 * 
 * Shows when audio capture is active, live transcript, and processing status.
 * Styled to match the Response page design.
 * 
 * Keyboard shortcuts:
 * - Ctrl+Shift+A: Toggle recording (sends audio transcript only when stopping)
 * - Ctrl+Shift+S: Toggle recording (sends audio transcript + screenshot when stopping)
 * - Ctrl+Enter: Screenshot only (no audio)
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import phantomlensLogo from "../../../assets/icons/phantomlens_logo.svg";

// Hook to track transparency mode
function useTransparencyMode() {
  const [isTransparent, setIsTransparent] = useState(false);

  useEffect(() => {
    const checkTransparency = () => {
      setIsTransparent(document.body.classList.contains('transparent-mode'));
    };

    checkTransparency();

    const observer = new MutationObserver(checkTransparency);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  return isTransparent;
}

interface MeetingAssistantIndicatorProps {
  className?: string;
}

interface TranscriptMessage {
  type: "partial" | "final";
  text: string;
}

const DEFAULT_AUDIO_PROMPT = `You are a senior software engineer participating in a technical meeting. Based on the conversation transcript below:

Summary: Provide a concise summary in clear key points that capture the main topics discussed.

Clarifying Questions: Ask a set of simple English questions that show strong technical understanding. Focus on:
- Architecture decisions and tradeoffs
- Scalability concerns
- Edge cases and error handling
- Security considerations
- Requirements, dependencies, and constraints

Keep your response concise and professional.

Conversation transcript:
"{{TRANSCRIPT}}"

Your response:`;

export function MeetingAssistantIndicator({ className = "" }: MeetingAssistantIndicatorProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNotification, setShowNotification] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [currentPartial, setCurrentPartial] = useState("");
  const [audioPrompt, setAudioPrompt] = useState(DEFAULT_AUDIO_PROMPT);
  // Track which mode is being used for display
  const [captureMode, setCaptureMode] = useState<"audio-only" | "audio-screenshot">("audio-only");
  const [screenshotCount, setScreenshotCount] = useState(0);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  
  // Ref to access current transcript in keyboard handler
  const transcriptRef = useRef("");
  const currentPartialRef = useRef("");
  const audioPromptRef = useRef(DEFAULT_AUDIO_PROMPT);
  const wasCapturingRef = useRef(false);
  const isCapturingRef = useRef(false);
  const recordingStartRef = useRef<number | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track which mode was used to start recording: "audio-only" or "audio-screenshot"
  const captureModeRef = useRef<"audio-only" | "audio-screenshot">("audio-only");

  // Keep refs in sync
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { currentPartialRef.current = currentPartial; }, [currentPartial]);
  useEffect(() => { audioPromptRef.current = audioPrompt; }, [audioPrompt]);
  useEffect(() => { isCapturingRef.current = isCapturing; }, [isCapturing]);

  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  const startDurationTimer = useCallback(() => {
    stopDurationTimer();
    recordingStartRef.current = Date.now();
    setRecordingDurationMs(0);
    durationTimerRef.current = setInterval(() => {
      if (recordingStartRef.current) {
        setRecordingDurationMs(Date.now() - recordingStartRef.current);
      }
    }, 1000);
  }, [stopDurationTimer]);

  useEffect(() => {
    return () => {
      stopDurationTimer();
    };
  }, [stopDurationTimer]);

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

  // Listen for toggle events from keyboard shortcuts (Ctrl+Shift+A or Ctrl+Shift+S)
  useEffect(() => {
    const handleToggle = async (data: { isCapturing: boolean; mode?: "audio-only" | "audio-screenshot" }) => {
      // If stopping and we were capturing, send based on the mode used to start
      if (!data.isCapturing && wasCapturingRef.current) {
        // Capture transcript values and mode BEFORE clearing state
        const capturedTranscript = transcriptRef.current;
        const capturedPartial = currentPartialRef.current;
        const capturedPrompt = audioPromptRef.current;
        const capturedMode = captureModeRef.current;
        isCapturingRef.current = false;
        
        // Hide indicator immediately
        setIsCapturing(false);
        setShowNotification(false);
        setTranscript("");
        setCurrentPartial("");
        
        // Send transcript in background with captured values
        const fullText = capturedTranscript + (capturedPartial ? " " + capturedPartial : "");
        
        if (fullText.length >= 10) {
          try {
            const finalPrompt = capturedPrompt.replace('{{TRANSCRIPT}}', fullText);
            
            if (capturedMode === "audio-screenshot") {
              // Audio + Screenshot mode: use audio prompt with screenshot
              console.log("[MeetingAssistant] Sending audio + screenshot (using audio prompt)");
              const result = await (window as any).electronAPI?.processAudioWithScreenshot?.(finalPrompt);
              
              // Fallback if processing fails
              if (!result?.success) {
                console.log("[MeetingAssistant] Fallback: using setUserPrompt + triggerProcessScreenshots");
                await (window as any).electronAPI?.setUserPrompt(finalPrompt);
                await (window as any).electronAPI?.triggerProcessScreenshots();
              }
            } else {
              // Audio only mode: process transcript without screenshot
              console.log("[MeetingAssistant] Sending audio only");
              const result = await (window as any).electronAPI?.processAudioTranscript?.(finalPrompt);
              
              // Fallback to screenshot if audio-only processing fails
              if (!result?.success) {
                await (window as any).electronAPI?.setUserPrompt(finalPrompt);
                await (window as any).electronAPI?.triggerProcessScreenshots();
              }
            }
          } catch (err: any) {
            console.error('Failed to send transcript:', err);
          }
        } else if (capturedMode === "audio-screenshot") {
          // No meaningful transcript but in screenshot mode - just send screenshot
          console.log("[MeetingAssistant] No transcript, sending screenshot only");
          await (window as any).electronAPI?.triggerProcessScreenshots();
        }

        stopDurationTimer();
        recordingStartRef.current = null;
        setRecordingDurationMs(0);
        setScreenshotCount(0);
      }
      
      wasCapturingRef.current = data.isCapturing;
      
      if (data.isCapturing) {
        // Store the mode used to start this recording
        const mode = data.mode || "audio-only";
        captureModeRef.current = mode;
        setCaptureMode(mode);
        isCapturingRef.current = true;
        
        try {
          const response = await (window as any).electronAPI?.getAudioPrompt?.();
          if (response?.success && response.data?.prompt) {
            setAudioPrompt(response.data.prompt);
          }
        } catch (e) {
          console.warn("Failed to load audio prompt:", e);
        }
        
        setIsCapturing(true);
        setShowNotification(true);
        setError(null);
        setTranscript("");
        setCurrentPartial("");
        setScreenshotCount(0);
        startDurationTimer();
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
        // Only keep the last sentence for display, but accumulate for sending
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
  }, [startDurationTimer, stopDurationTimer]);

  useEffect(() => {
    const cleanup = (window as any).electronAPI?.onScreenshotTaken?.(() => {
      if (isCapturingRef.current) {
        setScreenshotCount((prev) => prev + 1);
      }
    });

    return () => {
      cleanup?.();
    };
  }, []);

  const fullText = transcript + (currentPartial ? " " + currentPartial : "");
  const isTransparent = useTransparencyMode();

  // Only show when actively capturing - hide immediately when stopped
  const shouldShow = isCapturing || (showNotification && error);

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`;
    }

    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // Get just the last part of the transcript for display (last ~100 chars)
  const displayText = currentPartial || (transcript.length > 100 
    ? "..." + transcript.slice(-100) 
    : transcript);
  const formattedDuration = formatDuration(recordingDurationMs);

  if (!shouldShow) {
    return null;
  }

  return (
    <div 
      className={`fixed top-16 flex flex-col gap-2 z-50 ${className}`}
      style={{ 
        right: 'calc(0.5rem + 470px)',
        width: '320px'
      }}
    >
      {/* Main card container - matches Response page style */}
      <div 
        className="flex flex-col w-full rounded-3xl overflow-hidden"
        style={{
          background: isTransparent
            ? 'transparent'
            : 'rgba(10, 10, 12, 0.78)',
          backdropFilter: isTransparent
            ? 'none'
            : 'blur(10px)',
          borderRadius: '24px',
          border: isTransparent
            ? 'none'
            : '1px solid rgba(255, 255, 255, 0.14)',
        }}
      >
        {/* Header - matches Response page header */}
        <div className="flex justify-between items-center px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">
              <img
                src={phantomlensLogo}
                alt="PhantomLens"
                className="w-6 h-6"
                style={{
                  opacity: isTransparent ? 0.4 : 1,
                  transition: 'opacity 0.3s ease'
                }}
              />
            </div>
            <span className="text-sm font-medium whitespace-nowrap" style={{ color: 'rgba(255, 255, 255, 0.9)' }}>
              {error
                ? "Recording Error"
                : captureMode === "audio-screenshot" 
                  ? "Audio + Screenshot" 
                  : "Audio Only"}
            </span>
          </div>

          {/* Status Badge - like Initial/Follow-up */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {error ? (
              <span 
                className="text-xs font-medium px-2 py-1 rounded-full"
                style={{
                  background: 'rgba(239, 68, 68, 0.2)',
                  color: 'rgba(252, 165, 165, 0.9)',
                  border: '1px solid rgba(239, 68, 68, 0.3)'
                }}
              >
                Error
              </span>
            ) : (
              <span 
                className="text-xs font-medium px-2 py-1 rounded-full flex items-center gap-1.5"
                style={{
                  background: 'rgba(239, 68, 68, 0.2)',
                  color: 'rgba(252, 165, 165, 0.9)',
                  border: '1px solid rgba(239, 68, 68, 0.3)'
                }}
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-400"></span>
                </span>
                Live
              </span>
            )}
          </div>
        </div>

        {/* Content area - matches Response page content area */}
        <div 
          className="overflow-y-auto text-sm leading-relaxed max-h-24 select-text"
          style={{ 
            background: 'transparent',
            padding: '0 16px 16px 48px',
            color: 'white'
          }}
        >
          {isCapturing && (
            <div className="text-white/60 text-[11px] mb-2 flex justify-between">
              <span>Audio {formattedDuration}</span>
              <span>
                {screenshotCount} screenshot{Math.abs(screenshotCount) === 1 ? "" : "s"}
              </span>
            </div>
          )}
          {error ? (
            <div className="text-red-300/80 text-xs">
              {error}
            </div>
          ) : isCapturing && displayText ? (
            <div>
              <div className="text-white/50 text-[10px] mb-2 flex justify-between">
                <span>{fullText.length} chars</span>
                <span className="text-purple-400">
                  {captureMode === "audio-screenshot" ? "Ctrl+Shift+S" : "Ctrl+Shift+A"} to send
                </span>
              </div>
              <div className="text-white/90 text-xs leading-relaxed">
                {currentPartial ? (
                  <span className="text-yellow-300/80">{currentPartial}</span>
                ) : (
                  <span>{displayText}</span>
                )}
              </div>
            </div>
          ) : isCapturing ? (
            <div className="flex items-center gap-1.5 py-2">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" 
                   style={{ 
                     background: 'rgba(255, 255, 255, 0.6)',
                     animationDelay: '0s',
                     animationDuration: '1.5s'
                   }}></div>
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" 
                   style={{ 
                     background: 'rgba(255, 255, 255, 0.6)',
                     animationDelay: '0.2s',
                     animationDuration: '1.5s'
                   }}></div>
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" 
                   style={{ 
                     background: 'rgba(255, 255, 255, 0.6)',
                     animationDelay: '0.4s',
                     animationDuration: '1.5s'
                   }}></div>
              <span className="text-white/50 text-xs ml-2">Listening...</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default MeetingAssistantIndicator;
