#pragma once

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <functiondiscoverykeys_devpkey.h>
#include <vector>
#include <functional>
#include <atomic>
#include <thread>
#include <mutex>

namespace phantom {

// Audio format for processing (16kHz mono float32, as required by Whisper)
struct AudioFormat {
    uint32_t sampleRate = 16000;
    uint16_t channels = 1;
    uint16_t bitsPerSample = 32;  // float32
};

// Callback type for audio chunks
using AudioChunkCallback = std::function<void(const float* samples, size_t numSamples)>;

class AudioCapture {
public:
    AudioCapture();
    ~AudioCapture();

    // Initialize WASAPI loopback on default output device
    bool initialize();

    // Start capturing audio
    bool start(AudioChunkCallback callback);

    // Stop capturing
    void stop();

    // Check if capturing
    bool isCapturing() const { return m_capturing.load(); }

    // Get last error message
    const std::string& getLastError() const { return m_lastError; }

    // Get current audio format
    const AudioFormat& getFormat() const { return m_outputFormat; }

private:
    void captureLoop();
    void cleanup();

    // COM interfaces
    IMMDeviceEnumerator* m_enumerator = nullptr;
    IMMDevice* m_device = nullptr;
    IAudioClient* m_audioClient = nullptr;
    IAudioCaptureClient* m_captureClient = nullptr;

    // Capture format from device
    WAVEFORMATEX* m_captureFormat = nullptr;
    
    // Output format (for Whisper)
    AudioFormat m_outputFormat;

    // Capture state
    std::atomic<bool> m_capturing{false};
    std::atomic<bool> m_shouldStop{false};
    std::thread m_captureThread;
    std::mutex m_mutex;

    // Callback for audio data
    AudioChunkCallback m_callback;

    // Error handling
    std::string m_lastError;
    bool m_initialized = false;

    // Resampling buffer
    std::vector<float> m_resampleBuffer;
};

} // namespace phantom
