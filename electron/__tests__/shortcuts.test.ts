/**
 * Unit tests for ShortcutsHelper
 * Tests keyboard shortcut registration and handling
 */

import { ShortcutsHelper } from '../shortcuts';
import { globalShortcut, BrowserWindow, screen } from 'electron';
import { IShortcutsHelperDeps } from '../main';

describe('ShortcutsHelper', () => {
  let shortcutsHelper: ShortcutsHelper;
  let mockDeps: jest.Mocked<IShortcutsHelperDeps>;
  let mockWindow: jest.Mocked<BrowserWindow>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock window
    mockWindow = new BrowserWindow() as jest.Mocked<BrowserWindow>;
    mockWindow.getBounds.mockReturnValue({ x: 100, y: 100, width: 800, height: 600 });
    mockWindow.setBounds.mockImplementation(() => {});

    // Create mock dependencies
    mockDeps = {
      takeScreenshot: jest.fn().mockResolvedValue(undefined),
      processingHelper: {
        processScreenshots: jest.fn().mockResolvedValue(undefined),
        cancelOngoingRequests: jest.fn(),
      },
      clearQueues: jest.fn(),
      setView: jest.fn(),
      getMainWindow: jest.fn().mockReturnValue(mockWindow),
      moveWindowLeft: jest.fn(),
      moveWindowRight: jest.fn(),
      moveWindowUp: jest.fn(),
      moveWindowDown: jest.fn(),
      scrollResponseBy: jest.fn(),
      scrollCodeBlockBy: jest.fn(),
      navigateHistoryPrev: jest.fn(),
      navigateHistoryNext: jest.fn(),
    } as any;

    shortcutsHelper = new ShortcutsHelper(mockDeps);
  });

  describe('Initialization', () => {
    it('should create shortcuts helper with dependencies', () => {
      expect(shortcutsHelper).toBeDefined();
    });
  });

  describe('Register Shortcuts', () => {

    it('should not register duplicate shortcuts', () => {
      (globalShortcut.isRegistered as jest.Mock).mockReturnValue(true);

      shortcutsHelper.registerAppShortcuts();

      // Should check if registered before attempting
      expect(globalShortcut.isRegistered).toHaveBeenCalled();
    });
  });

  describe('Stealth Screenshot (Cmd+Enter)', () => {
    it('should take screenshot and process in stealth mode', async () => {
      shortcutsHelper.registerAppShortcuts();

      // Find the Cmd+Enter handler
      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const cmdEnterCall = calls.find(call => call[0] === 'CommandOrControl+Enter');
      const handler = cmdEnterCall[1];

      await handler();

      expect(mockDeps.takeScreenshot).toHaveBeenCalled();
      expect(mockDeps.processingHelper?.processScreenshots).toHaveBeenCalled();
    });

    it('should not show window in stealth mode', async () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const cmdEnterCall = calls.find(call => call[0] === 'CommandOrControl+Enter');
      const handler = cmdEnterCall[1];

      await handler();

      expect(mockWindow.show).not.toHaveBeenCalled();
    });
  });

  describe('Reset (Cmd+R)', () => {
    it('should cancel requests and reset view', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const cmdRCall = calls.find(call => call[0] === 'CommandOrControl+R');
      const handler = cmdRCall[1];

      handler();

      expect(mockDeps.processingHelper?.cancelOngoingRequests).toHaveBeenCalled();
      expect(mockDeps.clearQueues).toHaveBeenCalled();
      expect(mockDeps.setView).toHaveBeenCalledWith('initial');
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('reset-view');
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('reset');
    });
  });

  describe('Window Movement', () => {
    it('should move window left (Cmd+Left)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const cmdLeftCall = calls.find(call => call[0] === 'CommandOrControl+Left');
      const handler = cmdLeftCall[1];

      handler();

      expect(mockDeps.moveWindowLeft).toHaveBeenCalled();
    });

    it('should move window right (Cmd+Right)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const cmdRightCall = calls.find(call => call[0] === 'CommandOrControl+Right');
      const handler = cmdRightCall[1];

      handler();

      expect(mockDeps.moveWindowRight).toHaveBeenCalled();
    });

    it('should move window up (Cmd+Up)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const cmdUpCall = calls.find(call => call[0] === 'CommandOrControl+Up');
      const handler = cmdUpCall[1];

      handler();

      expect(mockDeps.moveWindowUp).toHaveBeenCalled();
    });

    it('should move window down (Cmd+Down)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const cmdDownCall = calls.find(call => call[0] === 'CommandOrControl+Down');
      const handler = cmdDownCall[1];

      handler();

      expect(mockDeps.moveWindowDown).toHaveBeenCalled();
    });
  });

  describe('Emergency Recovery (Cmd+Shift+R)', () => {
    it('should recover window visibility', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const emergencyCall = calls.find(call => call[0] === 'CommandOrControl+Shift+R');
      const handler = emergencyCall[1];

      handler();

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.setOpacity).toHaveBeenCalledWith(1);
      expect(mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
      expect(mockWindow.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    });

    it('should reset window size if too small', () => {
      mockWindow.getBounds.mockReturnValue({ x: 0, y: 0, width: 50, height: 50 });

      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const emergencyCall = calls.find(call => call[0] === 'CommandOrControl+Shift+R');
      const handler = emergencyCall[1];

      handler();

      expect(mockWindow.setBounds).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 800,
          height: 600,
        }),
        false
      );
    });

    it('should handle missing window gracefully', () => {
      mockDeps.getMainWindow.mockReturnValue(null);
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const emergencyCall = calls.find(call => call[0] === 'CommandOrControl+Shift+R');
      const handler = emergencyCall[1];

      handler();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No main window')
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Scrolling', () => {
    it('should scroll response up (Alt+Up)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const altUpCall = calls.find(call => call[0] === 'Alt+Up');
      const handler = altUpCall[1];

      handler();

      expect(mockDeps.scrollResponseBy).toHaveBeenCalledWith(-120);
    });

    it('should scroll response down (Alt+Down)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const altDownCall = calls.find(call => call[0] === 'Alt+Down');
      const handler = altDownCall[1];

      handler();

      expect(mockDeps.scrollResponseBy).toHaveBeenCalledWith(120);
    });

    it('should scroll code block left (Alt+Left)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const altLeftCall = calls.find(call => call[0] === 'Alt+Left');
      const handler = altLeftCall[1];

      handler();

      expect(mockDeps.scrollCodeBlockBy).toHaveBeenCalledWith(-120);
    });

    it('should scroll code block right (Alt+Right)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const altRightCall = calls.find(call => call[0] === 'Alt+Right');
      const handler = altRightCall[1];

      handler();

      expect(mockDeps.scrollCodeBlockBy).toHaveBeenCalledWith(120);
    });
  });

  describe('History Navigation', () => {
    it('should navigate to previous history (Cmd+Shift+Up)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const prevCall = calls.find(call => call[0] === 'CommandOrControl+Shift+Up');
      const handler = prevCall[1];

      handler();

      expect(mockDeps.navigateHistoryPrev).toHaveBeenCalled();
    });

    it('should navigate to next history (Cmd+Shift+Down)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const nextCall = calls.find(call => call[0] === 'CommandOrControl+Shift+Down');
      const handler = nextCall[1];

      handler();

      expect(mockDeps.navigateHistoryNext).toHaveBeenCalled();
    });
  });

  describe('Settings', () => {
    it('should open settings (Cmd+,)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const settingsCall = calls.find(call => call[0] === 'CommandOrControl+,');
      const handler = settingsCall[1];

      handler();

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('open-settings');
    });

    it('should unlock interactive settings (Cmd+Shift+,)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const unlockCall = calls.find(call => call[0] === 'CommandOrControl+Shift+,');
      const handler = unlockCall[1];

      handler();

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('settings-unlock');
    });
  });

  describe('System Audio (Windows only)', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true,
      });
    });



    it('should not work on non-Windows platforms', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const audioCall = calls.find(call => call[0] === 'CommandOrControl+Shift+A');
      const handler = audioCall[1];

      await handler();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('only available on Windows')
      );

      consoleLogSpy.mockRestore();
    });
  });

  describe('Transparency Toggle', () => {
    it('should toggle transparency (Cmd+Shift+V)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const transparencyCall = calls.find(call => call[0] === 'CommandOrControl+Shift+V');
      const handler = transparencyCall[1];

      handler();

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('toggle-transparency');
    });
  });

  describe('Update Download', () => {
    it('should open update download (Cmd+Shift+U)', () => {
      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const updateCall = calls.find(call => call[0] === 'CommandOrControl+Shift+U');
      const handler = updateCall[1];

      handler();

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('download-update');
    });
  });



  describe('Error Handling', () => {
    it('should handle window destroyed state', () => {
      mockWindow.isDestroyed.mockReturnValue(true);

      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const cmdRCall = calls.find(call => call[0] === 'CommandOrControl+R');
      const handler = cmdRCall[1];

      expect(() => handler()).not.toThrow();
      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('should handle missing processing helper', async () => {
      mockDeps.processingHelper = undefined;

      shortcutsHelper.registerAppShortcuts();

      const calls = (globalShortcut.register as jest.Mock).mock.calls;
      const cmdEnterCall = calls.find(call => call[0] === 'CommandOrControl+Enter');
      const handler = cmdEnterCall[1];

      await expect(handler()).resolves.not.toThrow();
    });
  });
});
