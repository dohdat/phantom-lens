#include "json_protocol.h"
#include <iostream>
#include <sstream>
#include <iomanip>
#include <algorithm>

namespace phantom {

// Simple JSON string extraction (no external dependencies)
static std::string extractJsonString(const std::string& json, const std::string& key) {
    std::string searchKey = "\"" + key + "\"";
    size_t keyPos = json.find(searchKey);
    if (keyPos == std::string::npos) {
        return "";
    }

    // Find the colon after the key
    size_t colonPos = json.find(':', keyPos + searchKey.length());
    if (colonPos == std::string::npos) {
        return "";
    }

    // Skip whitespace
    size_t valueStart = json.find_first_not_of(" \t\n\r", colonPos + 1);
    if (valueStart == std::string::npos) {
        return "";
    }

    // Check if it's a string value
    if (json[valueStart] == '"') {
        size_t valueEnd = json.find('"', valueStart + 1);
        if (valueEnd != std::string::npos) {
            return json.substr(valueStart + 1, valueEnd - valueStart - 1);
        }
    }

    return "";
}

Command parseCommand(const std::string& json) {
    Command cmd;
    
    std::string cmdValue = extractJsonString(json, "cmd");
    
    // Convert to lowercase for comparison
    std::string lowerCmd = cmdValue;
    std::transform(lowerCmd.begin(), lowerCmd.end(), lowerCmd.begin(), ::tolower);

    if (lowerCmd == "start") {
        cmd.type = CommandType::Start;
    } else if (lowerCmd == "stop") {
        cmd.type = CommandType::Stop;
    } else if (lowerCmd == "exit") {
        cmd.type = CommandType::Exit;
    } else {
        cmd.type = CommandType::Unknown;
    }

    return cmd;
}

std::string escapeJson(const std::string& str) {
    std::ostringstream ss;
    for (char c : str) {
        switch (c) {
            case '"':  ss << "\\\""; break;
            case '\\': ss << "\\\\"; break;
            case '\b': ss << "\\b"; break;
            case '\f': ss << "\\f"; break;
            case '\n': ss << "\\n"; break;
            case '\r': ss << "\\r"; break;
            case '\t': ss << "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    // Control character - use unicode escape
                    ss << "\\u" << std::hex << std::setfill('0') << std::setw(4) 
                       << static_cast<int>(static_cast<unsigned char>(c));
                } else {
                    ss << c;
                }
        }
    }
    return ss.str();
}

void sendReady() {
    std::cout << "{\"type\":\"ready\"}" << std::endl;
    std::cout.flush();
}

void sendStarted() {
    std::cout << "{\"type\":\"started\"}" << std::endl;
    std::cout.flush();
}

void sendStopped() {
    std::cout << "{\"type\":\"stopped\"}" << std::endl;
    std::cout.flush();
}

void sendPartial(const std::string& text) {
    std::cout << "{\"type\":\"partial\",\"text\":\"" << escapeJson(text) << "\"}" << std::endl;
    std::cout.flush();
}

void sendFinal(const std::string& text) {
    std::cout << "{\"type\":\"final\",\"text\":\"" << escapeJson(text) << "\"}" << std::endl;
    std::cout.flush();
}

void sendError(const std::string& message) {
    std::cout << "{\"type\":\"error\",\"message\":\"" << escapeJson(message) << "\"}" << std::endl;
    std::cout.flush();
}

} // namespace phantom
