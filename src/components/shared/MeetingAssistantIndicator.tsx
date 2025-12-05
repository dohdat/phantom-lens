/**
 * MeetingAssistantIndicator - A minimal indicator showing meeting assistant status
 * 
 * Shows when audio capture is active, live transcript, and processing status.
 * Includes a debug log panel for troubleshooting.
 * 
 * Keyboard shortcuts:
 * - Ctrl+D: Toggle debug panel
 * - Ctrl+Shift+C: Copy debug logs to clipboard
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
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(true);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [audioPrompt, setAudioPrompt] = useState(DEFAULT_AUDIO_PROMPT);
  
  // Silence detection for auto-send
  const silenceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedLength = useRef(0);

  // Debug logger
  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString();
    setDebugLogs(prev => [...prev.slice(-15), `[${time}] ${msg}`]);
  }, []);

  // Copy debug logs to clipboard
  const copyDebugLogs = useCallback(() => {
    const logsText = debugLogs.join('\n');
    navigator.clipboard.writeText(logsText).then(() => {
      addLog("📋 Debug logs copied to clipboard!");
    }).catch((err) => {
      addLog(`Failed to copy: ${err.message}`);
    });
  }, [debugLogs, addLog]);

  // Keyboard shortcuts for debug panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+D: Toggle debug panel
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        setShowDebug(prev => !prev);
      }
      // Ctrl+Shift+C: Copy debug logs
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        copyDebugLogs();
      }
      // Ctrl+P: Toggle prompt editor
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        setShowPromptEditor(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copyDebugLogs]);

  // Listen for toggle events from keyboard shortcut
  useEffect(() => {
    const handleToggle = (data: { isCapturing: boolean }) => {
      addLog(`Toggle: isCapturing=${data.isCapturing}`);
      setIsCapturing(data.isCapturing);
      setError(null);
      setShowNotification(true);
      
      if (!data.isCapturing) {
        addLog("Stopping - will clear in 5s");
        setTimeout(() => {
          setShowNotification(false);
          setTranscript("");
          setCurrentPartial("");
        }, 5000);
      } else {
        addLog("Starting - reset transcript");
        setTranscript("");
        setCurrentPartial("");
        lastProcessedLength.current = 0;
      }
    };

    const handleError = (data: { message: string }) => {
      addLog(`ERROR: ${data.message}`);
      setError(data.message);
      setShowNotification(true);
      setTimeout(() => {
        setShowNotification(false);
        setError(null);
      }, 5000);
    };

    const handleTranscript = (msg: TranscriptMessage) => {
      const text = msg.text?.trim() || "";
      addLog(`Transcript (${msg.type}): "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"`);
      
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
        addLog(`Filtered: "${text}"`);
        return;
      }

      if (msg.type === "partial") {
        setCurrentPartial(text);
      } else if (msg.type === "final" && text.length > 0) {
        setTranscript((prev) => prev + (prev ? " " : "") + text);
        setCurrentPartial("");
        addLog(`Added to transcript, total len: ${transcript.length + text.length}`);
      }
    };

    addLog("Initializing listeners...");
    const hasSystemAudio = !!(window as any).systemAudio;
    addLog(`systemAudio API: ${hasSystemAudio ? 'available' : 'NOT FOUND'}`);
    
    const cleanupToggle = (window as any).systemAudio?.onToggled?.(handleToggle);
    const cleanupError = (window as any).systemAudio?.onError?.(handleError);
    const cleanupTranscript = (window as any).systemAudio?.onTranscript?.(handleTranscript);
    
    addLog(`Listeners: toggle=${!!cleanupToggle}, error=${!!cleanupError}, transcript=${!!cleanupTranscript}`);
    
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
      if (silenceTimer.current) {
        clearTimeout(silenceTimer.current);
      }

      silenceTimer.current = setTimeout(async () => {
        const newContent = fullText.slice(lastProcessedLength.current).trim();
        if (newContent.length >= 30) {
          addLog(`Silence detected! Sending ${fullText.length} chars to Gemini (audio-only)...`);
          setIsProcessing(true);
          lastProcessedLength.current = fullText.length;

          try {
            // Use the custom audio prompt with transcript placeholder replaced
            const finalPrompt = audioPrompt.replace('{{TRANSCRIPT}}', fullText);

            addLog("Calling processAudioTranscript (no screenshots)...");
            const result = await (window as any).electronAPI?.processAudioTranscript?.(finalPrompt);
            addLog(`processAudioTranscript: ${JSON.stringify(result)}`);
            
            if (!result?.success) {
              // Fallback to old method if new API not available
              addLog("Fallback: Using setUserPrompt + triggerProcessScreenshots...");
              await (window as any).electronAPI?.setUserPrompt(finalPrompt);
              await (window as any).electronAPI?.triggerProcessScreenshots();
            }
            
            addLog("Done sending to Gemini!");
          } catch (err: any) {
            addLog(`FAILED: ${err?.message || err}`);
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
  }, [transcript, currentPartial, isCapturing, audioPrompt]);

  const fullText = transcript + (currentPartial ? " " + currentPartial : "");

  return (
    <>
      {/* Debug log panel - positioned on the LEFT side */}
      {showDebug && debugLogs.length > 0 && (
        <div className="fixed left-2 top-2 z-40 w-72">
          <div className="bg-gray-900/95 text-green-400 px-3 py-2 rounded-lg text-[10px] font-mono shadow-lg max-h-48 overflow-y-auto">
            <div className="flex justify-between items-center mb-1">
              <span className="text-white/50">Debug Log (Ctrl+D to hide)</span>
              <button 
                onClick={copyDebugLogs}
                className="text-white/50 hover:text-white text-[9px] px-1"
                title="Copy logs (Ctrl+Shift+C)"
              >
                📋
              </button>
            </div>
            {debugLogs.map((log, i) => (
              <div key={i} className="text-green-400/80">{log}</div>
            ))}
          </div>
        </div>
      )}

      {/* Audio Prompt Editor - positioned below debug */}
      {showPromptEditor && (
        <div className="fixed left-2 top-56 z-40 w-80">
          <div className="bg-gray-900/95 text-white px-3 py-2 rounded-lg text-[10px] shadow-lg">
            <div className="flex justify-between items-center mb-2">
              <span className="text-white/70 font-medium">Audio Prompt (Ctrl+P)</span>
              <button 
                onClick={() => setAudioPrompt(DEFAULT_AUDIO_PROMPT)}
                className="text-blue-400 hover:text-blue-300 text-[9px] px-1"
                title="Reset to default"
              >
                Reset
              </button>
            </div>
            <textarea
              value={audioPrompt}
              onChange={(e) => setAudioPrompt(e.target.value)}
              className="w-full h-40 bg-gray-800 text-white/90 text-[10px] p-2 rounded border border-gray-700 focus:border-blue-500 focus:outline-none resize-none"
              placeholder="Use {{TRANSCRIPT}} as placeholder for the transcript"
            />
            <div className="text-white/40 mt-1 text-[9px]">
              Use {"{{TRANSCRIPT}}"} as placeholder
            </div>
          </div>
        </div>
      )}

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

          {/* Control buttons */}
          <div className="flex gap-1">
            <button 
              onClick={() => setShowDebug(!showDebug)}
              className={`px-2 py-1 rounded text-[10px] ${showDebug ? 'bg-green-700/90 text-white' : 'bg-gray-800/90 text-white/70'} hover:bg-gray-700`}
              title="Ctrl+D"
            >
              {showDebug ? "🐛" : "🐛"}
            </button>
            <button 
              onClick={() => setShowPromptEditor(!showPromptEditor)}
              className={`px-2 py-1 rounded text-[10px] ${showPromptEditor ? 'bg-blue-700/90 text-white' : 'bg-gray-800/90 text-white/70'} hover:bg-gray-700`}
              title="Ctrl+P - Edit Audio Prompt"
            >
              ✏️
            </button>
          </div>
        </div>

        {/* Live transcript */}
        {isCapturing && fullText && (
          <div className="bg-black/80 text-white/90 px-3 py-2 rounded-lg text-xs shadow-lg max-h-20 overflow-y-auto">
            <div className="text-white/50 text-[10px] mb-1">Live Transcript ({fullText.length} chars):</div>
            <div>{transcript}<span className="text-yellow-300">{currentPartial}</span></div>
          </div>
        )}
      </div>
    </>
  );
}

export default MeetingAssistantIndicator;
