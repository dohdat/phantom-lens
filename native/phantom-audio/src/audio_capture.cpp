#include "audio_capture.h"
#include "audio_resampler.h"
#include <iostream>
#include <cstring>

namespace phantom {

// Helper macro for COM error handling
#define RETURN_ON_ERROR(hr, msg) \
    if (FAILED(hr)) { \
        m_lastError = msg; \
        m_lastError += " (HRESULT: " + std::to_string(hr) + ")"; \
        cleanup(); \
        return false; \
    }

AudioCapture::AudioCapture() {
    // Initialize COM for this thread
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
        m_lastError = "Failed to initialize COM";
    }
}

AudioCapture::~AudioCapture() {
    stop();
    cleanup();
    CoUninitialize();
}

bool AudioCapture::initialize() {
    std::lock_guard<std::mutex> lock(m_mutex);
    
    if (m_initialized) {
        return true;
    }

    HRESULT hr;

    // Create device enumerator
    hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator),
        nullptr,
        CLSCTX_ALL,
        __uuidof(IMMDeviceEnumerator),
        (void**)&m_enumerator
    );
    RETURN_ON_ERROR(hr, "Failed to create device enumerator");

    // Get default audio output device (for loopback capture)
    hr = m_enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &m_device);
    RETURN_ON_ERROR(hr, "Failed to get default audio endpoint");

    // Activate audio client
    hr = m_device->Activate(
        __uuidof(IAudioClient),
        CLSCTX_ALL,
        nullptr,
        (void**)&m_audioClient
    );
    RETURN_ON_ERROR(hr, "Failed to activate audio client");

    // Get device format
    hr = m_audioClient->GetMixFormat(&m_captureFormat);
    RETURN_ON_ERROR(hr, "Failed to get mix format");

    std::cout << "[AudioCapture] Device format: " 
              << m_captureFormat->nSamplesPerSec << " Hz, "
              << m_captureFormat->nChannels << " channels, "
              << m_captureFormat->wBitsPerSample << " bits" << std::endl;

    // Initialize audio client in loopback mode
    // Buffer duration: 100ms (in 100-nanosecond units)
    REFERENCE_TIME bufferDuration = 1000000;  // 100ms
    
    hr = m_audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        bufferDuration,
        0,
        m_captureFormat,
        nullptr
    );
    RETURN_ON_ERROR(hr, "Failed to initialize audio client in loopback mode");

    // Get capture client
    hr = m_audioClient->GetService(
        __uuidof(IAudioCaptureClient),
        (void**)&m_captureClient
    );
    RETURN_ON_ERROR(hr, "Failed to get capture client");

    m_initialized = true;
    std::cout << "[AudioCapture] Initialized successfully" << std::endl;
    
    return true;
}

bool AudioCapture::start(AudioChunkCallback callback) {
    if (!m_initialized) {
        m_lastError = "Audio capture not initialized";
        return false;
    }

    if (m_capturing.load()) {
        return true;  // Already capturing
    }

    m_callback = std::move(callback);
    m_shouldStop.store(false);

    // Start the audio client
    HRESULT hr = m_audioClient->Start();
    if (FAILED(hr)) {
        m_lastError = "Failed to start audio client";
        return false;
    }

    m_capturing.store(true);

    // Start capture thread
    m_captureThread = std::thread(&AudioCapture::captureLoop, this);

    std::cout << "[AudioCapture] Started capturing" << std::endl;
    return true;
}

void AudioCapture::stop() {
    if (!m_capturing.load()) {
        return;
    }

    m_shouldStop.store(true);

    if (m_captureThread.joinable()) {
        m_captureThread.join();
    }

    if (m_audioClient) {
        m_audioClient->Stop();
    }

    m_capturing.store(false);
    std::cout << "[AudioCapture] Stopped capturing" << std::endl;
}

void AudioCapture::captureLoop() {
    // Create resampler for converting to 16kHz mono
    AudioResampler resampler(
        m_captureFormat->nSamplesPerSec,
        m_captureFormat->nChannels,
        m_outputFormat.sampleRate
    );

    UINT32 packetLength = 0;
    BYTE* data = nullptr;
    UINT32 numFramesAvailable = 0;
    DWORD flags = 0;

    while (!m_shouldStop.load()) {
        // Check for available packets
        HRESULT hr = m_captureClient->GetNextPacketSize(&packetLength);
        if (FAILED(hr)) {
            std::cerr << "[AudioCapture] Failed to get packet size" << std::endl;
            break;
        }

        while (packetLength != 0) {
            // Get the buffer
            hr = m_captureClient->GetBuffer(
                &data,
                &numFramesAvailable,
                &flags,
                nullptr,
                nullptr
            );

            if (FAILED(hr)) {
                std::cerr << "[AudioCapture] Failed to get buffer" << std::endl;
                break;
            }

            if (numFramesAvailable > 0) {
                // Convert to float if needed and resample to 16kHz mono
                std::vector<float> inputSamples;
                
                if (m_captureFormat->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
                    (m_captureFormat->wFormatTag == WAVE_FORMAT_EXTENSIBLE)) {
                    // Already float format
                    const float* floatData = reinterpret_cast<const float*>(data);
                    size_t numSamples = numFramesAvailable * m_captureFormat->nChannels;
                    inputSamples.assign(floatData, floatData + numSamples);
                } else if (m_captureFormat->wBitsPerSample == 16) {
                    // Convert from 16-bit PCM to float
                    const int16_t* pcmData = reinterpret_cast<const int16_t*>(data);
                    size_t numSamples = numFramesAvailable * m_captureFormat->nChannels;
                    inputSamples.resize(numSamples);
                    for (size_t i = 0; i < numSamples; ++i) {
                        inputSamples[i] = static_cast<float>(pcmData[i]) / 32768.0f;
                    }
                } else if (m_captureFormat->wBitsPerSample == 32) {
                    // 32-bit PCM to float
                    const int32_t* pcmData = reinterpret_cast<const int32_t*>(data);
                    size_t numSamples = numFramesAvailable * m_captureFormat->nChannels;
                    inputSamples.resize(numSamples);
                    for (size_t i = 0; i < numSamples; ++i) {
                        inputSamples[i] = static_cast<float>(pcmData[i]) / 2147483648.0f;
                    }
                }

                if (!inputSamples.empty()) {
                    // Resample to 16kHz mono
                    std::vector<float> outputSamples = resampler.process(
                        inputSamples.data(),
                        numFramesAvailable
                    );

                    // Send to callback
                    if (m_callback && !outputSamples.empty()) {
                        m_callback(outputSamples.data(), outputSamples.size());
                    }
                }
            }

            // Release buffer
            hr = m_captureClient->ReleaseBuffer(numFramesAvailable);
            if (FAILED(hr)) {
                std::cerr << "[AudioCapture] Failed to release buffer" << std::endl;
                break;
            }

            // Get next packet size
            hr = m_captureClient->GetNextPacketSize(&packetLength);
            if (FAILED(hr)) {
                break;
            }
        }

        // Sleep briefly to avoid busy-waiting
        Sleep(10);
    }
}

void AudioCapture::cleanup() {
    if (m_captureClient) {
        m_captureClient->Release();
        m_captureClient = nullptr;
    }
    if (m_audioClient) {
        m_audioClient->Release();
        m_audioClient = nullptr;
    }
    if (m_device) {
        m_device->Release();
        m_device = nullptr;
    }
    if (m_enumerator) {
        m_enumerator->Release();
        m_enumerator = nullptr;
    }
    if (m_captureFormat) {
        CoTaskMemFree(m_captureFormat);
        m_captureFormat = nullptr;
    }
    m_initialized = false;
}

} // namespace phantom
