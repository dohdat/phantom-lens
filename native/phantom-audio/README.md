# phantom-audio Build Instructions

## Prerequisites

1. **Visual Studio 2019 or 2022** with C++ desktop development workload
2. **CMake 3.16+** (https://cmake.org/download/)
3. **Git** for cloning whisper.cpp

## Setup

1. Clone whisper.cpp inside this directory:
   ```bash
   cd native/phantom-audio
   git clone https://github.com/ggerganov/whisper.cpp.git
   ```

2. Download the Whisper model:
   ```bash
   # Create models directory
   mkdir -p ../../resources/models/whisper
   
   # Download the quantized small English model
   curl -L -o ../../resources/models/whisper/ggml-small.en.q5_1.bin \
     https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin
   ```

## Building

### Using CMake (recommended)

```bash
cd native/phantom-audio
mkdir build
cd build

# Configure (Release build)
cmake .. -G "Visual Studio 17 2022" -A x64

# Build
cmake --build . --config Release

# The executable will be at: build/bin/Release/phantom-audio.exe
```

### Using Visual Studio

1. Open the folder in Visual Studio
2. CMake should automatically configure
3. Build > Build All

## Testing

Run the executable with a test model:

```bash
./build/bin/Release/phantom-audio.exe --model ../../resources/models/whisper/ggml-small.en.q5_1.bin
```

Then send commands via stdin:
```json
{"cmd":"start"}
{"cmd":"stop"}
{"cmd":"exit"}
```

## Integration with PhantomLens

After building, the executable should be at:
- Development: `native/phantom-audio/build/bin/Release/phantom-audio.exe`
- Production: Bundled in the app's resources folder

The model should be at:
- Development: `resources/models/whisper/ggml-small.en.q5_1.bin`
- Production: `resources/models/whisper/ggml-small.en.q5_1.bin` in app resources

## Troubleshooting

### WASAPI errors
- Ensure an audio output device is configured as default
- The app requires audio to be playing to capture (it captures loopback audio)

### Whisper errors
- Verify the model file exists and is not corrupted
- Check that the model format is compatible (GGML format)

### Performance
- The small.en model is optimized for English and provides good accuracy
- For faster processing, try `ggml-base.en.q5_1.bin` (smaller but less accurate)
- CPU usage will be higher during active transcription
