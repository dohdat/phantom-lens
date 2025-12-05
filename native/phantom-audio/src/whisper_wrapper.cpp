#include "whisper_wrapper.h"
#include "whisper.h"
#include <iostream>
#include <cmath>
#include <algorithm>
#include <chrono>
#include <thread>

namespace phantom {

WhisperWrapper::WhisperWrapper() = default;

WhisperWrapper::~WhisperWrapper() {
    stop();
    if (m_context) {
        whisper_free(m_context);
        m_context = nullptr;
    }
}

bool WhisperWrapper::loadModel(const std::string& modelPath) {
    if (m_context) {
        whisper_free(m_context);
        m_context = nullptr;
    }

    std::cout << "[Whisper] Loading model: " << modelPath << std::endl;

    // Initialize whisper context
    struct whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = true;  // Use GPU if available (CUDA/Metal)

    m_context = whisper_init_from_file_with_params(modelPath.c_str(), cparams);
    
    if (!m_context) {
        m_lastError = "Failed to load Whisper model from: " + modelPath;
        std::cerr << "[Whisper] " << m_lastError << std::endl;
        return false;
    }

    std::cout << "[Whisper] Model loaded successfully" << std::endl;
    return true;
}

void WhisperWrapper::start(TranscriptionCallback callback) {
    if (!m_context) {
        std::cerr << "[Whisper] Cannot start - no model loaded" << std::endl;
        return;
    }

    if (m_running.load()) {
        return;
    }

    m_callback = std::move(callback);
    m_running.store(true);

    // Clear any existing audio
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_audioBuffer.clear();
    }

    m_processThread = std::thread(&WhisperWrapper::processLoop, this);
    std::cout << "[Whisper] Started transcription" << std::endl;
}

void WhisperWrapper::stop() {
    if (!m_running.load()) {
        return;
    }

    m_running.store(false);
    m_cv.notify_all();

    if (m_processThread.joinable()) {
        m_processThread.join();
    }

    std::cout << "[Whisper] Stopped transcription" << std::endl;
}

void WhisperWrapper::addAudioChunk(const float* samples, size_t numSamples) {
    if (!m_running.load() || numSamples == 0) {
        return;
    }

    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_audioBuffer.insert(m_audioBuffer.end(), samples, samples + numSamples);
    }
    m_cv.notify_one();
}

void WhisperWrapper::processLoop() {
    const size_t chunkSamples = static_cast<size_t>(m_chunkDuration * SAMPLE_RATE);
    
    while (m_running.load()) {
        std::vector<float> chunk;

        {
            std::unique_lock<std::mutex> lock(m_mutex);
            
            // Wait until we have enough audio or should stop
            m_cv.wait_for(lock, std::chrono::milliseconds(100), [&] {
                return m_audioBuffer.size() >= chunkSamples || !m_running.load();
            });

            if (!m_running.load()) {
                // Process any remaining audio before exiting
                if (m_audioBuffer.size() > SAMPLE_RATE / 2) {  // At least 0.5s
                    chunk = std::move(m_audioBuffer);
                    m_audioBuffer.clear();
                } else {
                    break;
                }
            } else if (m_audioBuffer.size() >= chunkSamples) {
                // Take the chunk
                chunk.assign(m_audioBuffer.begin(), m_audioBuffer.begin() + chunkSamples);
                // Keep some overlap for context (0.5 seconds)
                size_t overlap = SAMPLE_RATE / 2;
                if (m_audioBuffer.size() > overlap) {
                    m_audioBuffer.erase(m_audioBuffer.begin(), 
                                       m_audioBuffer.begin() + chunkSamples - overlap);
                }
            } else {
                continue;
            }
        }

        if (!chunk.empty()) {
            // Trim silence from beginning and end
            trimSilence(chunk);

            if (chunk.size() > SAMPLE_RATE / 4) {  // At least 0.25s of audio
                std::string text = transcribe(chunk);
                
                if (!text.empty() && m_callback) {
                    // For now, all results are treated as final
                    // Could implement VAD for partial results
                    m_callback(text, true);
                }
            }
        }
    }
}

std::string WhisperWrapper::transcribe(const std::vector<float>& samples) {
    if (!m_context || samples.empty()) {
        return "";
    }

    // Set up whisper parameters
    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    
    params.print_realtime = false;
    params.print_progress = false;
    params.print_timestamps = false;
    params.print_special = false;
    params.translate = false;
    params.language = "en";
    params.n_threads = std::max(1u, std::thread::hardware_concurrency());  // Use all CPU cores
    params.offset_ms = 0;
    params.no_context = true;
    params.single_segment = true;
    
    // Suppress blank tokens
    params.suppress_blank = true;

    // Run inference
    auto start = std::chrono::high_resolution_clock::now();
    
    int result = whisper_full(m_context, params, samples.data(), static_cast<int>(samples.size()));
    
    auto end = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);

    if (result != 0) {
        std::cerr << "[Whisper] Transcription failed with code: " << result << std::endl;
        return "";
    }

    // Get transcription result
    std::string output;
    int numSegments = whisper_full_n_segments(m_context);
    
    for (int i = 0; i < numSegments; ++i) {
        const char* text = whisper_full_get_segment_text(m_context, i);
        if (text) {
            if (!output.empty()) {
                output += " ";
            }
            output += text;
        }
    }

    // Trim whitespace
    size_t start_pos = output.find_first_not_of(" \t\n\r");
    size_t end_pos = output.find_last_not_of(" \t\n\r");
    if (start_pos != std::string::npos && end_pos != std::string::npos) {
        output = output.substr(start_pos, end_pos - start_pos + 1);
    }

    if (!output.empty()) {
        std::cout << "[Whisper] Transcribed in " << duration.count() << "ms: " << output << std::endl;
    }

    return output;
}

void WhisperWrapper::trimSilence(std::vector<float>& samples) {
    if (samples.empty()) return;

    const float threshold = 0.01f;  // Silence threshold
    const size_t windowSize = SAMPLE_RATE / 20;  // 50ms window

    // Find first non-silent sample
    size_t start = 0;
    for (size_t i = 0; i < samples.size() - windowSize; i += windowSize / 2) {
        float energy = 0.0f;
        for (size_t j = i; j < i + windowSize && j < samples.size(); ++j) {
            energy += std::abs(samples[j]);
        }
        energy /= windowSize;
        
        if (energy > threshold) {
            start = (i >= windowSize / 2) ? i - windowSize / 2 : 0;
            break;
        }
    }

    // Find last non-silent sample
    size_t end = samples.size();
    for (size_t i = samples.size(); i > windowSize; i -= windowSize / 2) {
        float energy = 0.0f;
        size_t windowStart = i - windowSize;
        for (size_t j = windowStart; j < i; ++j) {
            energy += std::abs(samples[j]);
        }
        energy /= windowSize;
        
        if (energy > threshold) {
            end = std::min(i + windowSize / 2, samples.size());
            break;
        }
    }

    if (start < end && start > 0) {
        samples.erase(samples.begin(), samples.begin() + start);
        end -= start;
    }
    if (end < samples.size()) {
        samples.resize(end);
    }
}

} // namespace phantom
