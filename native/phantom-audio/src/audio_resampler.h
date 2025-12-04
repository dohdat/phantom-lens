#pragma once

#include <vector>
#include <cstdint>

namespace phantom {

/**
 * Simple audio resampler that converts multi-channel audio at any sample rate
 * to 16kHz mono as required by Whisper.
 * 
 * Uses linear interpolation for simplicity. For production, consider using
 * a higher quality resampler like libsamplerate.
 */
class AudioResampler {
public:
    /**
     * Create a resampler
     * @param inputSampleRate Source sample rate (e.g., 48000)
     * @param inputChannels Number of input channels (e.g., 2 for stereo)
     * @param outputSampleRate Target sample rate (default: 16000 for Whisper)
     */
    AudioResampler(uint32_t inputSampleRate, uint16_t inputChannels, uint32_t outputSampleRate = 16000);

    /**
     * Process audio samples
     * @param input Input samples (interleaved if multi-channel)
     * @param numFrames Number of frames (samples per channel)
     * @return Resampled mono samples at target rate
     */
    std::vector<float> process(const float* input, size_t numFrames);

    /**
     * Reset the resampler state
     */
    void reset();

private:
    uint32_t m_inputSampleRate;
    uint16_t m_inputChannels;
    uint32_t m_outputSampleRate;
    double m_ratio;
    
    // For interpolation
    float m_lastSample = 0.0f;
    double m_fractionalPosition = 0.0;
};

} // namespace phantom
