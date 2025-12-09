/**
 * Unit tests for ScreenCaptureHelper
 * Tests stealth mode and screen capture protection functionality
 */

import { ScreenCaptureHelper } from '../ScreenCaptureHelper';
import { BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import { EventEmitter } from 'events';

// Mock modules
jest.mock('child_process');
jest.mock('fs');

describe('ScreenCaptureHelper', () => {
  let screenCaptureHelper: ScreenCaptureHelper;
  let mockWindow: jest.Mocked<BrowserWindow>;
  let mockProcess: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock window
    mockWindow = new BrowserWindow() as jest.Mocked<BrowserWindow>;
    mockWindow.getTitle.mockReturnValue('PhantomLens');
    
    // Create mock child process
    mockProcess = new EventEmitter();
    (mockProcess as any).kill = jest.fn();
    (mockProcess as any).killed = false;
    (mockProcess as any).stdout = new EventEmitter();
    (mockProcess as any).stderr = new EventEmitter();
    
    // Mock spawn to return our mock process
    (spawn as jest.Mock).mockReturnValue(mockProcess);
    
    // Mock fs.existsSync
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.chmodSync as jest.Mock).mockImplementation(() => {});
    
    screenCaptureHelper = new ScreenCaptureHelper();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Platform Detection', () => {
    it('should only work on macOS', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });

      const result = await screenCaptureHelper.startScreenCaptureProtection(mockWindow);
      
      expect(result).toBe(false);
      
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true,
      });
    });

    it('should attempt to start on macOS', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      // Simulate helper ready
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', Buffer.from('READY\n'));
      }, 10);

      const result = await screenCaptureHelper.startScreenCaptureProtection(mockWindow);
      
      expect(spawn).toHaveBeenCalled();
      expect(result).toBe(true);
      
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true,
      });
    });
  });

  describe('Screen Capture Protection', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
    });

    it('should start protection with correct parameters', async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', Buffer.from('READY\n'));
      }, 10);

      await screenCaptureHelper.startScreenCaptureProtection(mockWindow);

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        [process.pid.toString(), 'PhantomLens'],
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        })
      );
    });

    it('should not start if already running', async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', Buffer.from('READY\n'));
      }, 10);

      await screenCaptureHelper.startScreenCaptureProtection(mockWindow);
      (spawn as jest.Mock).mockClear();

      const result = await screenCaptureHelper.startScreenCaptureProtection(mockWindow);
      
      expect(result).toBe(true);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should set executable permissions on helper binary', async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', Buffer.from('READY\n'));
      }, 10);

      await screenCaptureHelper.startScreenCaptureProtection(mockWindow);

      expect(fs.chmodSync).toHaveBeenCalledWith(expect.any(String), '755');
    });

    it('should return true when helper is ready', async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', Buffer.from('READY\n'));
      }, 10);

      const result = await screenCaptureHelper.startScreenCaptureProtection(mockWindow);

      expect(result).toBe(true);
      expect(screenCaptureHelper.isRunning()).toBe(true);
    });
  });

  describe('Stop Protection', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
    });

    it('should stop protection gracefully', async () => {
      // Start protection first
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', Buffer.from('READY\n'));
      }, 10);
      await screenCaptureHelper.startScreenCaptureProtection(mockWindow);

      // Stop protection
      const stopPromise = screenCaptureHelper.stopScreenCaptureProtection();
      
      // Simulate process exit
      setTimeout(() => {
        mockProcess.emit('exit', 0);
      }, 10);

      await stopPromise;

      expect((mockProcess as any).kill).toHaveBeenCalledWith('SIGTERM');
      expect(screenCaptureHelper.isRunning()).toBe(false);
    });

    it('should force kill if graceful shutdown times out', async () => {
      // Start protection first
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', Buffer.from('READY\n'));
      }, 10);
      await screenCaptureHelper.startScreenCaptureProtection(mockWindow);

      // Stop protection without emitting exit event
      await screenCaptureHelper.stopScreenCaptureProtection();

      expect((mockProcess as any).kill).toHaveBeenCalledWith('SIGTERM');
    }, 10000);

    it('should do nothing if not running', async () => {
      await screenCaptureHelper.stopScreenCaptureProtection();

      expect((mockProcess as any).kill).not.toHaveBeenCalled();
    });
  });

  describe('Helper Event Handling', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
    });

    it('should handle stdout messages', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', Buffer.from('READY\n'));
        (mockProcess.stdout as any).emit('data', Buffer.from('Test message\n'));
      }, 10);

      await screenCaptureHelper.startScreenCaptureProtection(mockWindow);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Swift helper'));
      consoleLogSpy.mockRestore();
    });

    it('should handle stderr messages', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', Buffer.from('READY\n'));
        (mockProcess.stderr as any).emit('data', Buffer.from('Error message\n'));
      }, 10);

      await screenCaptureHelper.startScreenCaptureProtection(mockWindow);

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should handle process exit', async () => {
      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', Buffer.from('READY\n'));
      }, 10);

      await screenCaptureHelper.startScreenCaptureProtection(mockWindow);
      
      mockProcess.emit('exit', 0);

      expect(screenCaptureHelper.isRunning()).toBe(false);
    });

    it('should handle process error', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', Buffer.from('READY\n'));
      }, 10);

      await screenCaptureHelper.startScreenCaptureProtection(mockWindow);
      
      mockProcess.emit('error', new Error('Process error'));

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('State Management', () => {
    it('should return correct running state', () => {
      expect(screenCaptureHelper.isRunning()).toBe(false);
    });

    it('should update running state after starting', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', Buffer.from('READY\n'));
      }, 10);

      await screenCaptureHelper.startScreenCaptureProtection(mockWindow);

      expect(screenCaptureHelper.isRunning()).toBe(true);
    });

    it('should update running state after stopping', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      setTimeout(() => {
        (mockProcess.stdout as any).emit('data', Buffer.from('READY\n'));
      }, 10);

      await screenCaptureHelper.startScreenCaptureProtection(mockWindow);
      
      const stopPromise = screenCaptureHelper.stopScreenCaptureProtection();
      setTimeout(() => {
        mockProcess.emit('exit', 0);
      }, 10);
      await stopPromise;

      expect(screenCaptureHelper.isRunning()).toBe(false);
    });
  });
});
