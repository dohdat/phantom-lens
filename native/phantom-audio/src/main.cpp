/**
 * phantom-audio - System Audio Capture and Transcription
 * 
 * This is a native Windows process that captures system audio using WASAPI loopback
 * and transcribes it using whisper.cpp. It communicates with the Electron main process
 * via stdin/stdout using a JSON protocol.
 * 
 * Usage:
 *   phantom-audio.exe --model <path-to-whisper-model>
 * 
 * Commands (stdin JSON):
 *   {"cmd":"start"}  - Start audio capture and transcription
 *   {"cmd":"stop"}   - Stop capture
 *   {"cmd":"exit"}   - Clean shutdown
 * 
 * Events (stdout JSON):
 *   {"type":"ready"}
 *   {"type":"started"}
 *   {"type":"stopped"}
 *   {"type":"partial","text":"..."}
 *   {"type":"final","text":"..."}
 *   {"type":"error","message":"..."}
 */

#include <iostream>
#include <string>
#include <atomic>
#include <thread>
#include <csignal>

#include "audio_capture.h"
#include "whisper_wrapper.h"
#include "json_protocol.h"

namespace {
    std::atomic<bool> g_shouldExit{false};
    phantom::AudioCapture* g_audioCapture = nullptr;
    phantom::WhisperWrapper* g_whisper = nullptr;
}

void signalHandler(int signal) {
    std::cerr << "[Main] Received signal " << signal << ", shutting down..." << std::endl;
    g_shouldExit.store(true);
}

std::string parseModelPath(int argc, char* argv[]) {
    for (int i = 1; i < argc - 1; ++i) {
        std::string arg = argv[i];
        if (arg == "--model" || arg == "-m") {
            return argv[i + 1];
        }
    }
    return "";
}

void stdinLoop() {
    std::string line;
    
    while (!g_shouldExit.load() && std::getline(std::cin, line)) {
        if (line.empty()) continue;

        phantom::Command cmd = phantom::parseCommand(line);
        
        switch (cmd.type) {
            case phantom::CommandType::Start:
                std::cerr << "[Main] Received start command" << std::endl;
                if (g_audioCapture && g_whisper) {
                    // Start whisper first
                    g_whisper->start([](const std::string& text, bool isFinal) {
                        if (isFinal) {
                            phantom::sendFinal(text);
                        } else {
                            phantom::sendPartial(text);
                        }
                    });

                    // Start audio capture
                    bool started = g_audioCapture->start([](const float* samples, size_t numSamples) {
                        if (g_whisper) {
                            g_whisper->addAudioChunk(samples, numSamples);
                        }
                    });

                    if (started) {
                        phantom::sendStarted();
                    } else {
                        phantom::sendError(g_audioCapture->getLastError());
                    }
                } else {
                    phantom::sendError("Audio capture or Whisper not initialized");
                }
                break;

            case phantom::CommandType::Stop:
                std::cerr << "[Main] Received stop command" << std::endl;
                if (g_audioCapture) {
                    g_audioCapture->stop();
                }
                if (g_whisper) {
                    g_whisper->stop();
                }
                phantom::sendStopped();
                break;

            case phantom::CommandType::Exit:
                std::cerr << "[Main] Received exit command" << std::endl;
                g_shouldExit.store(true);
                break;

            default:
                std::cerr << "[Main] Unknown command: " << line << std::endl;
                break;
        }
    }
}

int main(int argc, char* argv[]) {
    // Set up signal handlers
    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);

    std::cerr << "[Main] phantom-audio starting..." << std::endl;

    // Parse command line arguments
    std::string modelPath = parseModelPath(argc, argv);
    if (modelPath.empty()) {
        phantom::sendError("No model path specified. Use --model <path>");
        return 1;
    }

    std::cerr << "[Main] Model path: " << modelPath << std::endl;

    // Initialize audio capture
    g_audioCapture = new phantom::AudioCapture();
    if (!g_audioCapture->initialize()) {
        phantom::sendError("Failed to initialize audio capture: " + g_audioCapture->getLastError());
        delete g_audioCapture;
        return 1;
    }

    // Initialize Whisper
    g_whisper = new phantom::WhisperWrapper();
    if (!g_whisper->loadModel(modelPath)) {
        phantom::sendError("Failed to load Whisper model: " + g_whisper->getLastError());
        delete g_audioCapture;
        delete g_whisper;
        return 1;
    }

    // Signal that we're ready
    phantom::sendReady();

    // Run the stdin command loop
    std::thread stdinThread(stdinLoop);

    // Wait for exit signal
    while (!g_shouldExit.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    std::cerr << "[Main] Shutting down..." << std::endl;

    // Stop capture if running
    if (g_audioCapture && g_audioCapture->isCapturing()) {
        g_audioCapture->stop();
    }
    if (g_whisper) {
        g_whisper->stop();
    }

    // Clean up
    delete g_whisper;
    g_whisper = nullptr;
    
    delete g_audioCapture;
    g_audioCapture = nullptr;

    // Wait for stdin thread
    if (stdinThread.joinable()) {
        stdinThread.detach();  // Don't wait for stdin, just exit
    }

    std::cerr << "[Main] Goodbye!" << std::endl;
    return 0;
}
