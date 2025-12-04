#include "audio_resampler.h"
#include <cmath>
#include <algorithm>

namespace phantom {

AudioResampler::AudioResampler(uint32_t inputSampleRate, uint16_t inputChannels, uint32_t outputSampleRate)
    : m_inputSampleRate(inputSampleRate)
    , m_inputChannels(inputChannels)
    , m_outputSampleRate(outputSampleRate)
    , m_ratio(static_cast<double>(inputSampleRate) / outputSampleRate)
    , m_lastSample(0.0f)
    , m_fractionalPosition(0.0)
{
}

std::vector<float> AudioResampler::process(const float* input, size_t numFrames) {
    if (numFrames == 0 || input == nullptr) {
        return {};
    }

    // First, convert to mono by averaging channels
    std::vector<float> mono(numFrames);
    if (m_inputChannels == 1) {
        std::copy(input, input + numFrames, mono.begin());
    } else {
        for (size_t i = 0; i < numFrames; ++i) {
            float sum = 0.0f;
            for (uint16_t ch = 0; ch < m_inputChannels; ++ch) {
                sum += input[i * m_inputChannels + ch];
            }
            mono[i] = sum / m_inputChannels;
        }
    }

    // If sample rates match, just return mono
    if (m_inputSampleRate == m_outputSampleRate) {
        return mono;
    }

    // Calculate output size
    size_t outputFrames = static_cast<size_t>(std::ceil(numFrames / m_ratio));
    std::vector<float> output;
    output.reserve(outputFrames);

    // Linear interpolation resampling
    double position = m_fractionalPosition;
    float prevSample = m_lastSample;

    while (position < numFrames) {
        size_t index = static_cast<size_t>(position);
        double frac = position - index;

        float currentSample = mono[index];
        float nextSample = (index + 1 < numFrames) ? mono[index + 1] : currentSample;

        // Linear interpolation
        float interpolated = static_cast<float>(currentSample * (1.0 - frac) + nextSample * frac);
        output.push_back(interpolated);

        position += m_ratio;
    }

    // Save state for next call
    if (numFrames > 0) {
        m_lastSample = mono[numFrames - 1];
    }
    m_fractionalPosition = position - numFrames;

    return output;
}

void AudioResampler::reset() {
    m_lastSample = 0.0f;
    m_fractionalPosition = 0.0;
}

} // namespace phantom
