/**
 * MeetingAssistantIndicator - A minimal indicator showing meeting assistant status
 * 
 * Shows when audio capture is active and when processing transcript to Gemini.
 */

import React, { useState, useEffect } from "react";

interface MeetingAssistantIndicatorProps {
  className?: string;
}

export function MeetingAssistantIndicator({ className = "" }: MeetingAssistantIndicatorProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNotification, setShowNotification] = useState(false);

  // Listen for toggle events from keyboard shortcut
  useEffect(() => {
    const handleToggle = (data: { isCapturing: boolean }) => {
      console.log("[MeetingAssistant] Toggled:", data.isCapturing);
      setIsCapturing(data.isCapturing);
      setError(null);
      setShowNotification(true);
      // Auto-hide notification after 3 seconds if not capturing
      if (!data.isCapturing) {
        setTimeout(() => setShowNotification(false), 3000);
      }
    };

    const handleError = (data: { message: string }) => {
      console.error("[MeetingAssistant] Error:", data.message);
      setError(data.message);
      setShowNotification(true);
      // Auto-hide error after 5 seconds
      setTimeout(() => {
        setShowNotification(false);
        setError(null);
      }, 5000);
    };

    const cleanupToggle = (window as any).systemAudio?.onToggled?.(handleToggle);
    const cleanupError = (window as any).systemAudio?.onError?.(handleError);
    
    return () => {
      cleanupToggle?.();
      cleanupError?.();
    };
  }, []);

  // Don't show anything if no notification needed
  if (!showNotification && !isCapturing) {
    return null;
  }

  return (
    <div className={`fixed top-2 right-2 flex items-center gap-2 z-50 ${className}`}>
      {/* Error indicator */}
      {error && (
        <div className="flex items-center gap-1.5 bg-red-600/95 text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg">
          <span>⚠️</span>
          <span className="max-w-[200px] truncate">{error}</span>
        </div>
      )}
      
      {/* Recording indicator */}
      {isCapturing && !error && (
        <div className="flex items-center gap-1.5 bg-red-500/95 text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
          </span>
          <span>🎤 Meeting Assistant Active</span>
        </div>
      )}

      {/* Stopped notification */}
      {!isCapturing && !error && showNotification && (
        <div className="flex items-center gap-1.5 bg-gray-700/95 text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg">
          <span>🎤 Meeting Assistant Stopped</span>
        </div>
      )}
    </div>
  );
}

export default MeetingAssistantIndicator;
