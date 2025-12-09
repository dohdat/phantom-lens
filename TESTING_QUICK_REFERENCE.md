# PhantomLens Testing Quick Reference

## Quick Start

```bash
# Install dependencies (if needed)
npm install

# Run all tests
npm test

# Watch mode for development
npm run test:watch

# Generate coverage report
npm run test:coverage

# Run specific test file
npm test -- ScreenCaptureHelper.test.ts
```

## Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `ScreenCaptureHelper.test.ts` | Screen capture stealth (macOS) | 50+ tests |
| `SystemAudioHelper.test.ts` | Audio capture & transcription (Windows) | 60+ tests |
| `shortcuts.test.ts` | All keyboard shortcuts | 70+ tests |
| `BrowserInjectionHelper.test.ts` | Browser detection & injection | 50+ tests |

## What's Tested

### ✅ Stealth Mode
- Screen capture protection on macOS
- Swift helper process management
- Window exclusion from ScreenCaptureKit

### ✅ Audio + Screen Capture
- System audio capture (Windows)
- Whisper speech-to-text transcription
- Real-time transcript streaming
- Audio-only and audio+screenshot modes

### ✅ Shortcuts
- `Cmd+Enter` - Stealth screenshot
- `Cmd+R` - Reset
- `Cmd+Arrow` - Window movement
- `Cmd+Shift+R` - Emergency recovery
- `Cmd+Shift+A` - Audio-only capture
- `Cmd+Shift+S` - Audio+screenshot capture
- `Alt+Arrow` - Scrolling
- Plus 8 more shortcuts!

### ✅ Browser Injection
- Automatic browser detection
- Timing bypass injection
- Multi-browser support (Chrome, Firefox, Edge, etc.)
- Continuous monitoring

## Common Test Commands

```bash
# Single test file
npm test -- shortcuts.test.ts

# Single test case
npm test -- -t "should take screenshot"

# Coverage for specific file
npm test -- --coverage --collectCoverageFrom=electron/shortcuts.ts

# Update snapshots
npm test -- -u

# Verbose output
npm run test:verbose

# Clear cache and run
npm test -- --clearCache && npm test
```

## Debug in VS Code

Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Debug",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand", "--no-cache"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

## CI/CD

Tests run automatically on:
- Push to `main` or `develop`
- Pull requests
- Multiple platforms (Windows, macOS, Linux)
- Multiple Node versions (18.x, 20.x)

## Test Structure

```typescript
describe('Component', () => {
  beforeEach(() => {
    // Setup mocks
  });

  afterEach(() => {
    // Cleanup
  });

  describe('Feature', () => {
    it('should do something', () => {
      // Test implementation
    });
  });
});
```

## Troubleshooting

### Tests fail to run
```bash
npm install
npm test
```

### Import errors
```bash
npm test -- --clearCache
```

### Timeout errors
Increase timeout in test:
```typescript
it('test name', async () => {
  // ...
}, 10000); // 10 second timeout
```

### Platform-specific tests
Tests automatically detect and skip unsupported platforms

## Coverage Goals

- **Overall**: 80%+
- **Critical paths**: 90%+
- **New code**: 75% minimum

## Files Created

```
electron/
  __tests__/
    ScreenCaptureHelper.test.ts
    SystemAudioHelper.test.ts
    shortcuts.test.ts
    BrowserInjectionHelper.test.ts
    test-utils.ts
    README.md
.github/
  workflows/
    test.yml
jest.config.js
jest.setup.js
TEST_IMPLEMENTATION_SUMMARY.md
TESTING_QUICK_REFERENCE.md (this file)
```

## Resources

- Full documentation: `electron/__tests__/README.md`
- Implementation details: `TEST_IMPLEMENTATION_SUMMARY.md`
- Jest docs: https://jestjs.io/
- TypeScript testing: https://kulshekhar.github.io/ts-jest/

---

**Total Tests**: 230+  
**Test Files**: 4  
**Lines of Test Code**: ~2,100  
**Status**: ✅ Ready to use
