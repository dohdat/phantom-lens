#pragma once

#include <string>
#include <vector>
#include <functional>
#include <mutex>
#include <atomic>
#include <thread>
#include <condition_variable>
#include <queue>

// Forward declare whisper types
struct whisper_context;

namespace phantom {

/**
 * Callback for transcription results
 * @param text Transcribed text
 * @param isFinal Whether this is a final result (vs partial)
 */
using TranscriptionCallback = std::function<void(const std::string& text, bool isFinal)>;

/**
 * Wrapper around whisper.cpp for speech-to-text
 */
class WhisperWrapper {
public:
    WhisperWrapper();
    ~WhisperWrapper();

    /**
     * Load a Whisper model
     * @param modelPath Path to the GGML model file
     * @return true if model loaded successfully
     */
    bool loadModel(const std::string& modelPath);

    /**
     * Start transcription with the given callback
     * Audio chunks should be fed via addAudioChunk()
     */
    void start(TranscriptionCallback callback);

    /**
     * Stop transcription
     */
    void stop();

    /**
     * Add audio samples to process
     * @param samples 16kHz mono float samples
     * @param numSamples Number of samples
     */
    void addAudioChunk(const float* samples, size_t numSamples);

    /**
     * Check if model is loaded
     */
    bool isModelLoaded() const { return m_context != nullptr; }

    /**
     * Get last error message
     */
    const std::string& getLastError() const { return m_lastError; }

    /**
     * Set the chunk duration for processing (in seconds)
     */
    void setChunkDuration(float seconds) { m_chunkDuration = seconds; }

private:
    void processLoop();
    std::string transcribe(const std::vector<float>& samples);
    void trimSilence(std::vector<float>& samples);

    whisper_context* m_context = nullptr;
    std::string m_lastError;

    // Processing state
    std::atomic<bool> m_running{false};
    std::thread m_processThread;
    std::mutex m_mutex;
    std::condition_variable m_cv;

    // Audio buffer
    std::vector<float> m_audioBuffer;
    float m_chunkDuration = 2.0f;  // Process in 2-second chunks
    static constexpr size_t SAMPLE_RATE = 16000;

    // Callback
    TranscriptionCallback m_callback;
};

} // namespace phantom
