/**
 * SystemAudioPanel - UI component for system audio capture and transcription
 * 
 * Displays a toggle button and live transcript of system audio (meetings, calls, etc.)
 */

import React, { useRef, useEffect } from "react";
import { useSystemAudio } from "@/hooks/useSystemAudio";
import { Mic, MicOff, Trash2, AlertCircle, Loader2 } from "lucide-react";

interface SystemAudioPanelProps {
  className?: string;
  onTranscriptChange?: (text: string) => void;
  /** Compact mode shows just the toggle button */
  compact?: boolean;
}

export const SystemAudioPanel: React.FC<SystemAudioPanelProps> = ({
  className = "",
  onTranscriptChange,
  compact = false,
}) => {
  const {
    state,
    transcript,
    currentPartial,
    fullTranscript,
    start,
    stop,
    clear,
  } = useSystemAudio();

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new transcript arrives
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, currentPartial]);

  // Notify parent of transcript changes
  useEffect(() => {
    onTranscriptChange?.(fullTranscript);
  }, [fullTranscript, onTranscriptChange]);

  const handleToggle = async () => {
    if (state.isCapturing) {
      await stop();
    } else {
      await start();
    }
  };

  // Not available (non-Windows)
  if (!state.isAvailable && state.error) {
    if (compact) {
      return (
        <button
          disabled
          className={`p-2 rounded-lg bg-white/5 text-white/30 cursor-not-allowed ${className}`}
          title="System audio not available"
        >
          <MicOff className="w-4 h-4" />
        </button>
      );
    }

    return (
      <div className={`p-4 rounded-xl bg-red-500/10 border border-red-500/20 ${className}`}>
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{state.error}</span>
        </div>
      </div>
    );
  }

  // Compact mode - just the toggle button
  if (compact) {
    return (
      <button
        onClick={handleToggle}
        disabled={!state.isAvailable}
        className={`
          p-2 rounded-lg transition-all duration-200
          ${state.isCapturing
            ? "bg-red-500 text-white hover:bg-red-600 animate-pulse"
            : "bg-white/10 text-white hover:bg-white/20"
          }
          ${!state.isAvailable ? "opacity-50 cursor-not-allowed" : ""}
          ${className}
        `}
        title={state.isCapturing ? "Stop system audio capture" : "Start system audio capture"}
      >
        {state.isCapturing ? (
          <Mic className="w-4 h-4" />
        ) : (
          <MicOff className="w-4 h-4" />
        )}
      </button>
    );
  }

  // Full panel mode
  return (
    <div className={`flex flex-col rounded-xl bg-black/40 backdrop-blur-sm border border-white/10 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${state.isCapturing ? "bg-red-500 animate-pulse" : "bg-white/30"}`} />
          <span className="text-sm font-medium text-white">
            {state.isCapturing ? "Capturing System Audio" : "System Audio"}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Clear button */}
          {transcript.length > 0 && (
            <button
              onClick={clear}
              className="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              title="Clear transcript"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          
          {/* Toggle button */}
          <button
            onClick={handleToggle}
            disabled={!state.isAvailable}
            className={`
              px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200
              flex items-center gap-2
              ${state.isCapturing
                ? "bg-red-500 text-white hover:bg-red-600"
                : "bg-blue-500 text-white hover:bg-blue-600"
              }
              ${!state.isAvailable ? "opacity-50 cursor-not-allowed" : ""}
            `}
          >
            {state.isCapturing ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Mic className="w-3 h-3" />
                <span>Start</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Transcript area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 min-h-[120px] max-h-[300px] space-y-2"
      >
        {transcript.length === 0 && !currentPartial && !state.isCapturing && (
          <div className="text-center py-6 text-white/40 text-sm">
            Click Start to capture system audio
          </div>
        )}

        {transcript.length === 0 && !currentPartial && state.isCapturing && (
          <div className="text-center py-6 text-white/40 text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Listening for audio...</span>
          </div>
        )}

        {/* Final transcripts */}
        {transcript.map((item) => (
          <div
            key={item.id}
            className="px-3 py-2 rounded-lg bg-white/5 text-white text-sm leading-relaxed"
          >
            {item.text}
          </div>
        ))}

        {/* Current partial */}
        {currentPartial && (
          <div className="px-3 py-2 rounded-lg bg-blue-500/20 text-blue-200 text-sm leading-relaxed border border-blue-500/30 animate-pulse">
            {currentPartial}
          </div>
        )}
      </div>

      {/* Error display */}
      {state.error && (
        <div className="px-4 py-2 border-t border-red-500/20 bg-red-500/10">
          <div className="flex items-center gap-2 text-red-400 text-xs">
            <AlertCircle className="w-3 h-3" />
            <span>{state.error}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemAudioPanel;
