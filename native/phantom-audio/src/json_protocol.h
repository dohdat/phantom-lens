#pragma once

#include <string>
#include <cstddef>

namespace phantom {

/**
 * JSON protocol for communicating with Electron main process.
 * 
 * Input commands (stdin):
 *   {"cmd":"start"}     - Start audio capture and transcription
 *   {"cmd":"stop"}      - Stop capture (pause)
 *   {"cmd":"exit"}      - Clean shutdown
 * 
 * Output events (stdout):
 *   {"type":"ready"}                           - Process initialized and ready
 *   {"type":"started"}                         - Capture started
 *   {"type":"stopped"}                         - Capture stopped
 *   {"type":"partial","text":"..."}            - Partial transcription result
 *   {"type":"final","text":"..."}              - Final transcription result
 *   {"type":"audio","data":"<base64 pcm>"}     - Raw audio chunk (float32 mono)
 *   {"type":"error","message":"..."}           - Error occurred
 */

enum class CommandType {
    Unknown,
    Start,
    Stop,
    Exit
};

struct Command {
    CommandType type = CommandType::Unknown;
};

// Parse a JSON command from stdin
Command parseCommand(const std::string& json);

// Output JSON messages to stdout
void sendReady();
void sendStarted();
void sendStopped();
void sendPartial(const std::string& text);
void sendFinal(const std::string& text);
void sendAudioChunk(const float* samples, size_t numSamples);
void sendError(const std::string& message);

// Utility to escape JSON strings
std::string escapeJson(const std::string& str);

} // namespace phantom
