# Whisper Models Directory

This directory contains the whisper.cpp GGML models for speech-to-text.

## Required Model

For PhantomLens system audio transcription, download the quantized small English model:

```bash
curl -L -o ggml-small.en.q5_1.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin
```

## Available Models

| Model | Size | Quality | Speed |
|-------|------|---------|-------|
| ggml-tiny.en.bin | ~75 MB | Low | Fastest |
| ggml-base.en.bin | ~142 MB | Medium | Fast |
| ggml-small.en.bin | ~466 MB | Good | Medium |
| ggml-small.en.q5_1.bin | ~181 MB | Good (quantized) | Medium |
| ggml-medium.en.bin | ~1.5 GB | Great | Slow |

## Recommended

For the best balance of quality and performance, we use `ggml-small.en.q5_1.bin`:
- Quantized to 5-bit precision for smaller size
- English-only for better accuracy on English content
- Good transcription quality for meetings and calls
- Reasonable CPU usage

## Download Links

- [ggml-small.en.q5_1.bin](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin)
- [ggml-base.en.q5_1.bin](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin)
