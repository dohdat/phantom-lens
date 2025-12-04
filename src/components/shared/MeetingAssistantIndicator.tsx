/**
 * MeetingAssistantIndicator - A minimal indicator showing meeting assistant status
 * 
 * Shows when audio capture is active and when processing transcript to Gemini.
 */

import React from "react";
import { useMeetingAssistant } from "../../hooks/useMeetingAssistant";

interface MeetingAssistantIndicatorProps {
  className?: string;
}

export function MeetingAssistantIndicator({ className = "" }: MeetingAssistantIndicatorProps) {
  const {
    isCapturing,
    isAvailable,
    isProcessing,
    transcript,
    currentPartial,
    error,
  } = useMeetingAssistant({
    silenceThreshold: 2000, // 2 seconds of silence
    minTranscriptLength: 50, // At least 50 chars before sending
  });

  // Don't show anything if not available or not capturing
  if (!isAvailable || !isCapturing) {
    return null;
  }

  return (
    <div className={`fixed top-2 right-2 flex items-center gap-2 ${className}`}>
      {/* Recording indicator */}
      <div className="flex items-center gap-1.5 bg-red-500/90 text-white px-2 py-1 rounded-full text-xs font-medium">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
        </span>
        <span>Meeting Assistant</span>
      </div>
      
      {/* Processing indicator */}
      {isProcessing && (
        <div className="flex items-center gap-1.5 bg-blue-500/90 text-white px-2 py-1 rounded-full text-xs font-medium">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Processing...</span>
        </div>
      )}
      
      {/* Error indicator */}
      {error && (
        <div className="bg-yellow-500/90 text-white px-2 py-1 rounded-full text-xs font-medium">
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}

export default MeetingAssistantIndicator;
