@echo off
REM Build script for phantom-audio on Windows

echo ====================================
echo Building phantom-audio for Windows
echo ====================================

REM Check for whisper.cpp
if not exist "whisper.cpp" (
    echo Cloning whisper.cpp...
    git clone https://github.com/ggerganov/whisper.cpp.git
    if errorlevel 1 (
        echo Failed to clone whisper.cpp
        exit /b 1
    )
)

REM Create build directory
if not exist "build" mkdir build
cd build

REM Configure with CMake
echo Configuring with CMake...
cmake .. -G "Visual Studio 17 2022" -A x64
if errorlevel 1 (
    echo CMake configuration failed
    cd ..
    exit /b 1
)

REM Build Release
echo Building Release...
cmake --build . --config Release
if errorlevel 1 (
    echo Build failed
    cd ..
    exit /b 1
)

cd ..

echo ====================================
echo Build complete!
echo Executable: build\bin\Release\phantom-audio.exe
echo ====================================

REM Check if model exists
if not exist "..\..\resources\models\whisper\ggml-small.en.q5_1.bin" (
    echo.
    echo WARNING: Whisper model not found!
    echo Download it from:
    echo https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin
    echo.
    echo Place it at: resources\models\whisper\ggml-small.en.q5_1.bin
)
