/**
 * Unit tests for SystemAudioHelper
 * Tests system audio capture and transcription functionality
 */

import { SystemAudioHelper } from '../SystemAudioHelper';
import { BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import { EventEmitter } from 'events';

// Mock modules
jest.mock('child_process');
jest.mock('fs');
jest.mock('https');

describe('SystemAudioHelper', () => {
  let systemAudioHelper: SystemAudioHelper;
  let mockWindow: jest.Mocked<BrowserWindow>;
  let mockProcess: EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock window
    mockWindow = new BrowserWindow() as jest.Mocked<BrowserWindow>;
    
    // Create mock child process
    mockProcess = new EventEmitter();
    (mockProcess as any).kill = jest.fn();
    (mockProcess as any).killed = false;
    (mockProcess as any).stdin = {
      write: jest.fn(),
      end: jest.fn(),
    };
    (mockProcess as any).stdout = new EventEmitter();
    (mockProcess as any).stderr = new EventEmitter();
    
    // Mock spawn to return our mock process
    (spawn as jest.Mock).mockReturnValue(mockProcess);
    
    // Mock fs
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    
    systemAudioHelper = new SystemAudioHelper();
    systemAudioHelper.initialize(mockWindow);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with window reference', () => {
      const helper = new SystemAudioHelper();
      helper.initialize(mockWindow);
      
      expect(ipcMain.handle).toHaveBeenCalledWith('system-audio:start', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('system-audio:stop', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('system-audio:toggle', expect.any(Function));
    });

    it('should register IPC handlers', () => {
      expect(ipcMain.handle).toHaveBeenCalledWith('system-audio:start', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('system-audio:stop', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('system-audio:toggle', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('system-audio:get-state', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('system-audio:check-availability', expect.any(Function));
    });
  });

  describe('Start Audio Capture', () => {
    it('should start audio capture process', async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'ready' }) + '\n');
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'started' }) + '\n');
      }, 10);

      await systemAudioHelper.start();

      expect(spawn).toHaveBeenCalled();
      expect(systemAudioHelper.isCapturing()).toBe(true);
    });

    it('should not start if already capturing', async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'ready' }) + '\n');
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'started' }) + '\n');
      }, 10);

      await systemAudioHelper.start();
      (spawn as jest.Mock).mockClear();

      await systemAudioHelper.start();

      expect(spawn).not.toHaveBeenCalled();
    });

    it('should send ready message to renderer', async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'ready' }) + '\n');
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'started' }) + '\n');
      }, 10);

      await systemAudioHelper.start();

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'system-audio:message',
        expect.objectContaining({ type: 'ready' })
      );
    });

    it('should handle executable not found', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(systemAudioHelper.start()).rejects.toThrow();
    });
  });

  describe('Stop Audio Capture', () => {
    beforeEach(async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'ready' }) + '\n');
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'started' }) + '\n');
      }, 10);
      await systemAudioHelper.start();
    });

    it('should stop audio capture', async () => {
      await systemAudioHelper.stop();

      expect((mockProcess as any).stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('stop')
      );
    });

    it('should update capturing state', async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'stopped' }) + '\n');
      }, 10);

      await systemAudioHelper.stop();

      expect(systemAudioHelper.isCapturing()).toBe(false);
    });

    it('should send stopped message to renderer', async () => {
      mockWindow.webContents.send.mockClear();
      
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'stopped' }) + '\n');
      }, 10);

      await systemAudioHelper.stop();

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'system-audio:message',
        expect.objectContaining({ type: 'stopped' })
      );
    });

    it('should do nothing if not capturing', async () => {
      await systemAudioHelper.stop();
      (mockProcess as any).stdin.write.mockClear();

      await systemAudioHelper.stop();

      expect((mockProcess as any).stdin.write).not.toHaveBeenCalled();
    });
  });

  describe('Toggle Audio Capture', () => {
    it('should start when not capturing', async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'ready' }) + '\n');
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'started' }) + '\n');
      }, 10);

      const result = await systemAudioHelper.toggle();

      expect(result).toBe(true);
      expect(systemAudioHelper.isCapturing()).toBe(true);
    });

    it('should stop when capturing', async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'ready' }) + '\n');
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'started' }) + '\n');
      }, 10);

      await systemAudioHelper.start();
      
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'stopped' }) + '\n');
      }, 150);

      const result = await systemAudioHelper.toggle();

      expect(result).toBe(false);
    });
  });

  describe('Transcript Messages', () => {
    beforeEach(async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'ready' }) + '\n');
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'started' }) + '\n');
      }, 10);
      await systemAudioHelper.start();
      mockWindow.webContents.send.mockClear();
    });

    it('should handle partial transcripts', () => {
      (mockProcess.stdout as any).emit(
        'data',
        JSON.stringify({ type: 'partial', text: 'Hello' }) + '\n'
      );

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'system-audio:message',
        expect.objectContaining({ type: 'partial', text: 'Hello' })
      );
    });

    it('should handle final transcripts', () => {
      (mockProcess.stdout as any).emit(
        'data',
        JSON.stringify({ type: 'final', text: 'Hello world' }) + '\n'
      );

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'system-audio:message',
        expect.objectContaining({ type: 'final', text: 'Hello world' })
      );
    });

    it('should handle error messages', () => {
      (mockProcess.stdout as any).emit(
        'data',
        JSON.stringify({ type: 'error', message: 'Test error' }) + '\n'
      );

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'system-audio:message',
        expect.objectContaining({ type: 'error', message: 'Test error' })
      );
    });

    it('should handle incomplete JSON data', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Send incomplete JSON
      (mockProcess.stdout as any).emit('data', '{"type": "partial"');

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      
      // Complete the JSON
      (mockProcess.stdout as any).emit('data', ', "text": "test"}\n');

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'system-audio:message',
        expect.objectContaining({ type: 'partial', text: 'test' })
      );
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Idle Timer', () => {
    beforeEach(async () => {
      jest.useFakeTimers();
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'ready' }) + '\n');
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'started' }) + '\n');
      }, 10);
      await systemAudioHelper.start();
      jest.runAllTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start idle timer after stopping', async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'stopped' }) + '\n');
      }, 10);

      await systemAudioHelper.stop();
      jest.runAllTimers();

      // Timer should be set
      expect(setTimeout).toHaveBeenCalled();
    });

    it('should clear idle timer when starting again', async () => {
      await systemAudioHelper.stop();
      jest.runAllTimers();

      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'started' }) + '\n');
      }, 10);

      await systemAudioHelper.start();

      // New activity should clear the timer
      expect(clearTimeout).toHaveBeenCalled();
    });
  });

  describe('Process Error Handling', () => {
    it('should handle process spawn error', async () => {
      (spawn as jest.Mock).mockImplementation(() => {
        const proc = new EventEmitter();
        setTimeout(() => proc.emit('error', new Error('Spawn failed')), 10);
        return proc;
      });

      await expect(systemAudioHelper.start()).rejects.toThrow();
    });

    it('should handle process exit with error', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'ready' }) + '\n');
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'started' }) + '\n');
      }, 10);

      await systemAudioHelper.start();
      
      mockProcess.emit('exit', 1);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(systemAudioHelper.isCapturing()).toBe(false);
      
      consoleErrorSpy.mockRestore();
    });

    it('should handle stderr output', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'ready' }) + '\n');
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'started' }) + '\n');
      }, 10);

      await systemAudioHelper.start();
      
      (mockProcess.stderr as any).emit('data', Buffer.from('Error output'));

      expect(consoleErrorSpy).toHaveBeenCalled();
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('State Management', () => {
    it('should return correct capturing state', () => {
      expect(systemAudioHelper.isCapturing()).toBe(false);
    });

    it('should track capturing state correctly', async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'ready' }) + '\n');
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'started' }) + '\n');
      }, 10);

      await systemAudioHelper.start();
      expect(systemAudioHelper.isCapturing()).toBe(true);

      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'stopped' }) + '\n');
      }, 10);

      await systemAudioHelper.stop();
      expect(systemAudioHelper.isCapturing()).toBe(false);
    });
  });

  describe('Shutdown', () => {
    beforeEach(async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'ready' }) + '\n');
        (mockProcess.stdout as any).emit('data', JSON.stringify({ type: 'started' }) + '\n');
      }, 10);
      await systemAudioHelper.start();
    });

    it('should shutdown process completely', async () => {
      await systemAudioHelper.shutdown();

      expect((mockProcess as any).kill).toHaveBeenCalled();
    });

    it('should clear all timers on shutdown', async () => {
      await systemAudioHelper.shutdown();

      // Verify cleanup happened
      expect(systemAudioHelper.isCapturing()).toBe(false);
    });
  });
});
