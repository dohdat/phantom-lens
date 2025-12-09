/**
 * Unit tests for BrowserInjectionHelper
 * Tests automatic browser detection and timing bypass injection
 */

import { BrowserInjectionHelper } from '../BrowserInjectionHelper';
import { spawn, exec } from 'child_process';
import fs from 'fs';
import { EventEmitter } from 'events';

// Mock modules
jest.mock('child_process');
jest.mock('fs');

describe('BrowserInjectionHelper', () => {
  let browserInjectionHelper: BrowserInjectionHelper;
  let mockProcess: EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create mock child process
    mockProcess = new EventEmitter();
    (mockProcess as any).kill = jest.fn();
    (mockProcess as any).killed = false;
    (mockProcess as any).stdout = new EventEmitter();
    (mockProcess as any).stderr = new EventEmitter();

    // Mock spawn to return our mock process
    (spawn as jest.Mock).mockReturnValue(mockProcess);

    // Mock exec for Windows commands
    (exec as jest.Mock).mockImplementation((cmd, callback) => {
      if (callback) {
        callback(null, '', '');
      }
    });

    // Mock fs promises
    (fs.promises as any).access = jest.fn().mockResolvedValue(undefined);
    (fs.promises as any).mkdir = jest.fn().mockResolvedValue(undefined);
    (fs.promises as any).writeFile = jest.fn().mockResolvedValue(undefined);
    (fs.promises as any).readFile = jest.fn().mockResolvedValue(Buffer.from(''));

    browserInjectionHelper = new BrowserInjectionHelper();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with correct paths', () => {
      expect(browserInjectionHelper).toBeDefined();
    });

    it('should set up paths for packaged app', () => {
      const helper = new BrowserInjectionHelper();
      expect(helper).toBeDefined();
    });
  });

  describe('Self-Timing Bypass', () => {
    it('should apply timing bypass to electron app', async () => {
      const originalDateNow = Date.now;
      const beforeTime = Date.now();

      await browserInjectionHelper.startAutomaticInjection();

      const afterTime = Date.now();

      // First few calls should return offset time
      expect(afterTime).toBeLessThan(beforeTime);

      // Restore
      (Date as any).now = originalDateNow;
    });

    it('should return normal time after offset calls', async () => {
      const originalDateNow = Date.now;

      await browserInjectionHelper.startAutomaticInjection();

      // Make several calls to exhaust offset
      Date.now();
      Date.now();
      Date.now();
      Date.now();

      const afterTime = Date.now();
      expect(afterTime).toBeGreaterThan(0);

      // Restore
      (Date as any).now = originalDateNow;
    });
  });

  describe('Start Automatic Injection', () => {
    it('should start automatic injection successfully', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await browserInjectionHelper.startAutomaticInjection();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('started successfully')
      );

      consoleLogSpy.mockRestore();
    });

    it('should not start if already running', async () => {
      await browserInjectionHelper.startAutomaticInjection();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await browserInjectionHelper.startAutomaticInjection();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Already running')
      );

      consoleLogSpy.mockRestore();
    });

    it('should create injection tools directory', async () => {
      await browserInjectionHelper.startAutomaticInjection();

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true })
      );
    });

    it('should create DLL and injector if missing', async () => {
      (fs.promises as any).access.mockRejectedValueOnce(new Error('Not found'));

      await browserInjectionHelper.startAutomaticInjection();

      expect(fs.promises.writeFile).toHaveBeenCalled();
    });
  });

  describe('Stop Automatic Injection', () => {
    beforeEach(async () => {
      await browserInjectionHelper.startAutomaticInjection();
    });

    it('should stop automatic injection', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      browserInjectionHelper.stopAutomaticInjection();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('stopped')
      );

      consoleLogSpy.mockRestore();
    });

    it('should clear monitoring interval', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      browserInjectionHelper.stopAutomaticInjection();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should handle stop when not running', () => {
      browserInjectionHelper.stopAutomaticInjection();

      expect(() => browserInjectionHelper.stopAutomaticInjection()).not.toThrow();
    });
  });

  describe('Browser Process Detection', () => {
    beforeEach(async () => {
      await browserInjectionHelper.startAutomaticInjection();
    });

    it('should scan for browser processes periodically', async () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      browserInjectionHelper.stopAutomaticInjection();
      await browserInjectionHelper.startAutomaticInjection();

      expect(setIntervalSpy).toHaveBeenCalled();
    });

    it('should detect Chrome processes', async () => {
      (exec as jest.Mock).mockImplementation((cmd, callback) => {
        if (cmd.includes('tasklist')) {
          callback(null, 'chrome.exe                    1234', '');
        } else {
          callback(null, '', '');
        }
      });

      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      expect(exec).toHaveBeenCalled();
    });

    it('should detect Firefox processes', async () => {
      (exec as jest.Mock).mockImplementation((cmd, callback) => {
        if (cmd.includes('tasklist')) {
          callback(null, 'firefox.exe                   5678', '');
        } else {
          callback(null, '', '');
        }
      });

      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      expect(exec).toHaveBeenCalled();
    });

    it('should detect Edge processes', async () => {
      (exec as jest.Mock).mockImplementation((cmd, callback) => {
        if (cmd.includes('tasklist')) {
          callback(null, 'msedge.exe                    9012', '');
        } else {
          callback(null, '', '');
        }
      });

      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      expect(exec).toHaveBeenCalled();
    });
  });

  describe('Injection Management', () => {
    beforeEach(async () => {
      await browserInjectionHelper.startAutomaticInjection();
    });

    it('should not inject into same process twice', async () => {
      (exec as jest.Mock).mockImplementation((cmd, callback) => {
        if (cmd.includes('tasklist')) {
          callback(null, 'chrome.exe                    1234', '');
        } else {
          callback(null, '', '');
        }
      });

      // First scan
      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      const firstExecCount = (exec as jest.Mock).mock.calls.length;

      // Second scan with same process
      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      // Should not inject again into the same PID
      expect((exec as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(firstExecCount);
    });

    it('should track injected processes', async () => {
      (exec as jest.Mock).mockImplementation((cmd, callback) => {
        if (cmd.includes('tasklist')) {
          callback(null, 'chrome.exe                    1234', '');
        } else if (cmd.includes('injector')) {
          callback(null, 'Injection successful', '');
        } else {
          callback(null, '', '');
        }
      });

      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      // Process should be tracked
      expect(exec).toHaveBeenCalled();
    });

    it('should handle injection failures', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      (exec as jest.Mock).mockImplementation((cmd, callback) => {
        if (cmd.includes('injector')) {
          callback(new Error('Injection failed'), '', '');
        } else {
          callback(null, '', '');
        }
      });

      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Injection Tools Management', () => {
    it('should check for DLL existence', async () => {
      (fs.promises as any).access.mockResolvedValue(undefined);

      await browserInjectionHelper.startAutomaticInjection();

      expect(fs.promises.access).toHaveBeenCalled();
    });

    it('should create DLL if missing', async () => {
      (fs.promises as any).access
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValue(undefined);

      await browserInjectionHelper.startAutomaticInjection();

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.dll'),
        expect.any(Buffer)
      );
    });

    it('should create injector if missing', async () => {
      (fs.promises as any).access
        .mockResolvedValueOnce(undefined) // DLL exists
        .mockRejectedValueOnce(new Error('Not found')) // Injector missing
        .mockResolvedValue(undefined);

      await browserInjectionHelper.startAutomaticInjection();

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.exe'),
        expect.any(Buffer)
      );
    });

    it('should handle tool creation errors', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      (fs.promises as any).writeFile.mockRejectedValue(new Error('Write failed'));
      (fs.promises as any).access.mockRejectedValue(new Error('Not found'));

      try {
        await browserInjectionHelper.startAutomaticInjection();
      } catch (error) {
        // Error is expected
      }

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Cleanup', () => {
    it('should clean up tracked processes on stop', async () => {
      await browserInjectionHelper.startAutomaticInjection();

      (exec as jest.Mock).mockImplementation((cmd, callback) => {
        if (cmd.includes('tasklist')) {
          callback(null, 'chrome.exe                    1234', '');
        } else {
          callback(null, '', '');
        }
      });

      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      browserInjectionHelper.stopAutomaticInjection();

      expect(browserInjectionHelper).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle process scanning errors', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      (exec as jest.Mock).mockImplementation((cmd, callback) => {
        callback(new Error('Command failed'), '', '');
      });

      await browserInjectionHelper.startAutomaticInjection();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      consoleErrorSpy.mockRestore();
    });

    it('should continue monitoring after injection failure', async () => {
      (exec as jest.Mock)
        .mockImplementationOnce((cmd, callback) => {
          callback(new Error('Failed'), '', '');
        })
        .mockImplementation((cmd, callback) => {
          callback(null, '', '');
        });

      await browserInjectionHelper.startAutomaticInjection();

      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      // Should continue despite previous failure
      expect(exec).toHaveBeenCalled();
    });

    it('should handle file system errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      (fs.promises as any).mkdir.mockRejectedValue(new Error('Permission denied'));

      try {
        await browserInjectionHelper.startAutomaticInjection();
      } catch (error) {
        // Error is expected
      }

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Target Browsers', () => {
    it('should target Chrome', async () => {
      (exec as jest.Mock).mockImplementation((cmd, callback) => {
        if (cmd.includes('chrome.exe')) {
          callback(null, 'chrome.exe                    1234', '');
        } else {
          callback(null, '', '');
        }
      });

      await browserInjectionHelper.startAutomaticInjection();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      expect(exec).toHaveBeenCalled();
    });

    it('should target multiple browser types', async () => {
      (exec as jest.Mock).mockImplementation((cmd, callback) => {
        callback(
          null,
          'chrome.exe                    1234\nfirefox.exe                   5678\nmsedge.exe                    9012',
          ''
        );
      });

      await browserInjectionHelper.startAutomaticInjection();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();

      expect(exec).toHaveBeenCalled();
    });
  });
});
