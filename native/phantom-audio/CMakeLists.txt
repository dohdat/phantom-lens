cmake_minimum_required(VERSION 3.16)
project(phantom-audio VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Build type
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# Windows-specific settings
if(WIN32)
    add_definitions(-DWIN32_LEAN_AND_MEAN -DNOMINMAX -D_CRT_SECURE_NO_WARNINGS)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

# Whisper.cpp integration
set(WHISPER_DIR "${CMAKE_CURRENT_SOURCE_DIR}/whisper.cpp")
if(EXISTS "${WHISPER_DIR}/CMakeLists.txt")
    # Build whisper.cpp as a static library
    set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
    add_subdirectory(${WHISPER_DIR})
else()
    message(FATAL_ERROR "whisper.cpp not found. Run: git clone https://github.com/ggerganov/whisper.cpp.git in the phantom-audio directory")
endif()

# Main executable
add_executable(phantom-audio
    src/main.cpp
    src/audio_capture.cpp
    src/audio_capture.h
    src/whisper_wrapper.cpp
    src/whisper_wrapper.h
    src/json_protocol.cpp
    src/json_protocol.h
    src/audio_resampler.cpp
    src/audio_resampler.h
)

# Include directories
target_include_directories(phantom-audio PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${WHISPER_DIR}/include
    ${WHISPER_DIR}
)

# Link libraries
if(WIN32)
    target_link_libraries(phantom-audio PRIVATE
        whisper
        ole32
        oleaut32
        uuid
        winmm
        ksuser
        mfplat
        mfuuid
    )
endif()

# Output settings
set_target_properties(phantom-audio PROPERTIES
    OUTPUT_NAME "phantom-audio"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)

# Install
install(TARGETS phantom-audio
    RUNTIME DESTINATION bin
)
