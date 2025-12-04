# System Audio Capture Implementation Summary

This document summarizes the implementation of system audio capture and transcription for PhantomLens on Windows.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     PhantomLens Electron App                      │
│  ┌─────────────────┐    ┌────────────────────┐                   │
│  │   React UI      │◄───│   SystemAudioPanel │                   │
│  │                 │    │   useSystemAudio   │                   │
│  └─────────────────┘    └────────────────────┘                   │
│           │                       │                               │
│           │              IPC (preload.ts)                         │
│           ▼                       ▼                               │
│  ┌────────────────────────────────────────────┐                  │
│  │           SystemAudioHelper.ts              │                  │
│  │    - Spawns phantom-audio.exe              │                  │
│  │    - JSON protocol over stdin/stdout       │                  │
│  │    - Forwards transcripts to renderer      │                  │
│  └────────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
           │ spawn
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    phantom-audio.exe (Native C++)                 │
│  ┌─────────────────┐    ┌──────────────────┐                     │
│  │  AudioCapture   │───►│  WhisperWrapper  │                     │
│  │  (WASAPI)       │    │  (whisper.cpp)   │                     │
│  └─────────────────┘    └──────────────────┘                     │
│           │                       │                               │
│    16kHz mono PCM              Transcribed text                   │
│           ▼                       ▼                               │
│  ┌────────────────────────────────────────────┐                  │
│  │           JSON Protocol (stdout)            │                  │
│  │  {"type":"partial","text":"..."}            │                  │
│  │  {"type":"final","text":"..."}              │                  │
│  └────────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

## Files Created

### Native C++ (phantom-audio)
- `native/phantom-audio/CMakeLists.txt` - CMake build configuration
- `native/phantom-audio/src/main.cpp` - Entry point and command processing
- `native/phantom-audio/src/audio_capture.h/cpp` - WASAPI loopback capture
- `native/phantom-audio/src/audio_resampler.h/cpp` - Resampling to 16kHz mono
- `native/phantom-audio/src/whisper_wrapper.h/cpp` - whisper.cpp integration
- `native/phantom-audio/src/json_protocol.h/cpp` - stdin/stdout JSON protocol
- `native/phantom-audio/README.md` - Build instructions
- `native/phantom-audio/build.bat` - Windows build script

### Electron
- `electron/SystemAudioHelper.ts` - Manages phantom-audio process

### React
- `src/hooks/useSystemAudio.ts` - React hook for system audio
- `src/components/shared/SystemAudioPanel.tsx` - UI component
- `src/types/systemAudio.d.ts` - TypeScript declarations

### Configuration
- `resources/models/whisper/README.md` - Model documentation
- `scripts/download-whisper-model.bat` - Model download script
- Updated `package.json` - Build scripts and extraResources

## JSON Protocol

### Commands (stdin → phantom-audio)
```json
{"cmd":"start"}   // Start audio capture and transcription
{"cmd":"stop"}    // Stop capture (pause)
{"cmd":"exit"}    // Clean shutdown
```

### Events (phantom-audio → stdout)
```json
{"type":"ready"}                           // Process initialized
{"type":"started"}                         // Capture started
{"type":"stopped"}                         // Capture stopped
{"type":"partial","text":"..."}            // Partial transcription
{"type":"final","text":"..."}              // Final transcription
{"type":"error","message":"..."}           // Error occurred
```

## Usage

### In React Components

```tsx
import { useSystemAudio } from "@/hooks/useSystemAudio";

function MeetingCapture() {
  const { state, transcript, currentPartial, start, stop, clear } = useSystemAudio();

  return (
    <div>
      <button onClick={state.isCapturing ? stop : start}>
        {state.isCapturing ? "Stop" : "Start"} Capture
      </button>
      
      {transcript.map(item => (
        <div key={item.id}>{item.text}</div>
      ))}
      
      {currentPartial && <div className="partial">{currentPartial}</div>}
    </div>
  );
}
```

### Using the Panel Component

```tsx
import { SystemAudioPanel } from "@/components/shared/SystemAudioPanel";

function App() {
  return (
    <SystemAudioPanel 
      onTranscriptChange={(text) => console.log("Full transcript:", text)}
    />
  );
}
```

## Building

### Prerequisites
1. Visual Studio 2019/2022 with C++ workload
2. CMake 3.16+
3. Git

### Steps

1. Download the Whisper model:
   ```bash
   scripts/download-whisper-model.bat
   ```

2. Build phantom-audio:
   ```bash
   cd native/phantom-audio
   build.bat
   ```

3. Build PhantomLens:
   ```bash
   npm run build:win
   ```

## Future Enhancements

1. **Voice Activity Detection (VAD)** - Only transcribe when speech is detected
2. **Speaker Diarization** - Distinguish between different speakers
3. **Microphone Mixing** - Capture both system audio and microphone
4. **GPU Acceleration** - Use CUDA/DirectML for faster transcription
5. **Language Selection** - Support for non-English languages
6. **Real-time Streaming** - True streaming transcription vs. chunked

## Model Options

| Model | Size | Quality | CPU Usage |
|-------|------|---------|-----------|
| tiny.en | 75 MB | Low | Very Low |
| base.en | 142 MB | Medium | Low |
| small.en (quantized) | 181 MB | Good | Medium |
| small.en | 466 MB | Good | Medium |
| medium.en | 1.5 GB | Great | High |

Default: `ggml-small.en.q5_1.bin` (quantized small English model)
