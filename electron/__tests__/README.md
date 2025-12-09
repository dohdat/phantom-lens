# PhantomLens Unit Tests

Comprehensive test suite for PhantomLens core functionality including stealth mode, audio/screen capture, shortcuts, and browser injection.

## Test Coverage

### 1. ScreenCaptureHelper Tests (`ScreenCaptureHelper.test.ts`)
Tests for macOS screen capture stealth functionality using ScreenCaptureKit.

**Coverage:**
- ✅ Platform detection (macOS only)
- ✅ Screen capture protection start/stop
- ✅ Swift helper binary management
- ✅ Process lifecycle (spawn, ready, exit)
- ✅ Error handling (missing binary, failed startup)
- ✅ Event handlers (stdout, stderr, exit)
- ✅ State management (isRunning)
- ✅ Graceful shutdown with SIGTERM/SIGKILL
- ✅ Duplicate start prevention

**Key Tests:**
- Stealth mode activation on macOS
- Window exclusion from screen capture
- Helper process monitoring
- Recovery from errors

### 2. SystemAudioHelper Tests (`SystemAudioHelper.test.ts`)
Tests for Windows system audio capture and Whisper transcription.

**Coverage:**
- ✅ Initialization and IPC handler registration
- ✅ Audio capture start/stop/toggle
- ✅ Whisper model management
- ✅ Process lifecycle management
- ✅ Transcript message handling (partial, final, error)
- ✅ JSON buffer parsing for incomplete data
- ✅ Idle timer management (10 min timeout)
- ✅ State tracking (isCapturing, isReady)
- ✅ Error handling (spawn errors, process crashes)
- ✅ Renderer communication

**Key Tests:**
- Audio capture toggle functionality
- Real-time transcript streaming
- Automatic model downloading
- Process recovery and cleanup
- Multi-state management

### 3. ShortcutsHelper Tests (`shortcuts.test.ts`)
Tests for global keyboard shortcuts and window management.

**Coverage:**
- ✅ Shortcut registration and unregistration
- ✅ Stealth screenshot (Cmd+Enter)
- ✅ Reset functionality (Cmd+R)
- ✅ Window movement (Cmd+Arrow keys)
- ✅ Emergency recovery (Cmd+Shift+R)
- ✅ Content scrolling (Alt+Arrow keys)
- ✅ History navigation (Cmd+Shift+Up/Down)
- ✅ Settings and preferences (Cmd+,)
- ✅ System audio toggle (Cmd+Shift+A, Cmd+Shift+S)
- ✅ Transparency toggle (Cmd+Shift+V)
- ✅ Update download (Cmd+Shift+U)
- ✅ Platform-specific behavior (Windows audio)
- ✅ Error handling (destroyed windows)

**Key Tests:**
- All 15+ keyboard shortcuts
- Platform-specific functionality
- Window recovery mechanisms
- Graceful error handling

### 4. BrowserInjectionHelper Tests (`BrowserInjectionHelper.test.ts`)
Tests for automatic browser detection and timing bypass injection.

**Coverage:**
- ✅ Self-timing bypass for Electron app
- ✅ Automatic browser detection (Chrome, Firefox, Edge, etc.)
- ✅ DLL and injector tool management
- ✅ Continuous process monitoring (3s interval)
- ✅ Injection tracking (no duplicate injections)
- ✅ Multiple browser support
- ✅ File system operations
- ✅ Process scanning on Windows
- ✅ Error recovery and continuation
- ✅ Cleanup on stop

**Key Tests:**
- Date.now() timing bypass
- Browser process detection
- Tool creation and management
- Injection lifecycle
- Error resilience

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Run Tests with Coverage Report
```bash
npm run test:coverage
```

### Run Electron-Specific Tests Only
```bash
npm run test:electron
```

### Run Tests with Verbose Output
```bash
npm run test:verbose
```

## Test Configuration

### Jest Configuration (`jest.config.js`)
- Uses `ts-jest` for TypeScript support
- Node environment for Electron tests
- Coverage collection enabled
- Module name mapping for imports

### Jest Setup (`jest.setup.js`)
Mocks for Electron modules:
- `electron` (app, BrowserWindow, ipcMain, globalShortcut, screen)
- `child_process` (spawn, exec)
- `fs` (promises, sync methods)
- `https` (for model downloads)

## Test Structure

Each test file follows this pattern:

```typescript
describe('ComponentName', () => {
  let component: Component;
  let mockDependencies: MockDeps;

  beforeEach(() => {
    // Setup mocks and initialize component
  });

  afterEach(() => {
    // Cleanup
  });

  describe('Feature Group', () => {
    it('should do something specific', () => {
      // Test implementation
    });
  });
});
```

## Coverage Goals

Target coverage: **80%+** for critical paths

Current coverage areas:
- ✅ Core functionality (stealth, audio, shortcuts)
- ✅ Error handling and recovery
- ✅ Platform-specific behavior
- ✅ State management
- ✅ Process lifecycle
- ✅ IPC communication

## Continuous Integration

Tests should be run:
- Before every commit (pre-commit hook)
- On pull requests (CI pipeline)
- Before releases (release checklist)

## Future Test Additions

Consider adding tests for:
- ProcessingHelper (screenshot processing)
- ScreenshotHelper (screenshot capture)
- AutoUpdater (update management)
- UsageCounter (usage tracking)
- React components (with React Testing Library)

## Debugging Tests

### Run Single Test File
```bash
npm test -- ScreenCaptureHelper.test.ts
```

### Run Single Test Case
```bash
npm test -- -t "should start protection"
```

### Debug with VS Code
Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Debug",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

## Notes

- Tests use mocks to avoid actual system interactions
- Platform-specific tests conditionally change `process.platform`
- Async operations use timers and promises
- Error logging is mocked to avoid test output pollution
- State is reset between tests using `beforeEach`/`afterEach`

## Dependencies

- `jest` - Test framework
- `ts-jest` - TypeScript support
- `@types/jest` - TypeScript definitions
- `@testing-library/jest-dom` - DOM matchers (for future React tests)

All test dependencies are in `devDependencies` and won't bloat production builds.
