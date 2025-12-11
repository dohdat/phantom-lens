import { app, globalShortcut, screen } from "electron";
import { IShortcutsHelperDeps } from "./main";
import { systemAudioHelper } from "./SystemAudioHelper";

export class ShortcutsHelper {
  private deps: IShortcutsHelperDeps;
  private shortcuts: { [key: string]: () => void } = {};
  private autoScreenshotTimer: NodeJS.Timeout | null = null;

  constructor(deps: IShortcutsHelperDeps) {
    this.deps = deps;

    this.stopAutoScreenshots = this.stopAutoScreenshots.bind(this);
    this.startAutoScreenshotsIfEnabled = this.startAutoScreenshotsIfEnabled.bind(this);
    this.captureAndAnnounceScreenshot = this.captureAndAnnounceScreenshot.bind(this);

    // Define all shortcuts and their handlers with NO CONFLICTS
    this.shortcuts = {
      "CommandOrControl+Enter": async () => {
        // Always stealth mode - just process screenshots
        await this.deps.takeScreenshot();
        await this.deps.processingHelper?.processScreenshots();
      },
      "CommandOrControl+R": () => {
        console.log("Command + R pressed. Canceling requests and resetting queues...");
        this.deps.processingHelper?.cancelOngoingRequests();
        this.deps.clearQueues();
        console.log("Cleared queues.");
        this.deps.setView("initial");
        const mainWindow = this.deps.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("reset-view");
          mainWindow.webContents.send("reset");
        }
      },
      
      // WINDOW MOVEMENT - Uses Ctrl/Cmd + Arrow keys
      "CommandOrControl+Left": () => {
        console.log("Command/Ctrl + Left pressed. Moving window left.");
        this.deps.moveWindowLeft();
      },
      "CommandOrControl+Right": () => {
        console.log("Command/Ctrl + Right pressed. Moving window right.");
        this.deps.moveWindowRight();
      },
      "CommandOrControl+Down": () => {
        console.log("Command/Ctrl + Down pressed. Moving window down.");
        this.deps.moveWindowDown();
      },
      "CommandOrControl+Up": () => {
        console.log("Command/Ctrl + Up pressed. Moving window up.");
        this.deps.moveWindowUp();
      },
      
      // EMERGENCY RECOVERY - New shortcut
      "CommandOrControl+Shift+R": () => {
        console.log("EMERGENCY: Command/Ctrl + Shift + R pressed. Attempting visibility recovery...");
        
        const mainWindow = this.deps.getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) {
          console.error("EMERGENCY: No main window available for recovery");
          return;
        }

        try {
          // Emergency visibility recovery
          console.log("EMERGENCY: Forcing window to show");
          mainWindow.show();
          
          console.log("EMERGENCY: Setting opacity to 1");
          mainWindow.setOpacity(1);
          
          console.log("EMERGENCY: Setting always on top");
          mainWindow.setAlwaysOnTop(true, "floating");
          
          // Check if window has valid dimensions
          const bounds = mainWindow.getBounds();
          console.log("EMERGENCY: Current bounds:", bounds);
          
          if (bounds.width < 100 || bounds.height < 100) {
            console.log("EMERGENCY: Window too small, resetting size");
            const primaryDisplay = screen.getPrimaryDisplay();
            const workArea = primaryDisplay.workAreaSize;
            
            mainWindow.setBounds({
              x: Math.max(0, Math.floor(workArea.width * 0.1)),
              y: Math.max(0, Math.floor(workArea.height * 0.1)),
              width: 800,
              height: 600
            }, false);
            console.log("EMERGENCY: Window size reset");
          }
          
          // Ensure click-through (NO forwarding)
          mainWindow.setIgnoreMouseEvents(true);
          
          console.log("EMERGENCY: Recovery completed successfully");
          
        } catch (error) {
          console.error("EMERGENCY: Recovery failed:", error);
        }
      },
      // Scroll response content - Alt + Up/Down
      "Alt+Up": () => {
        this.deps.scrollResponseBy(-120);
      },
      "Alt+Down": () => {
        this.deps.scrollResponseBy(120);
      },
      // Scroll code blocks horizontally - Alt + Left/Right
      "Alt+Left": () => {
        this.deps.scrollCodeBlockBy(-120);
      },
      "Alt+Right": () => {
        this.deps.scrollCodeBlockBy(120);
      },
      // History navigation (prev/next) - Ctrl/Cmd + Shift + Up/Down
      "CommandOrControl+Shift+Up": () => {
        this.deps.navigateHistoryPrev();
      },
      "CommandOrControl+Shift+Down": () => {
        this.deps.navigateHistoryNext();
      },
      // Toggle Settings window (open/close)
      "CommandOrControl+,": () => {
        console.log("Command/Ctrl + , pressed. Toggling settings...");
        const mainWindow = this.deps.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("open-settings");
        }
      },
      // Download Update
      "CommandOrControl+Shift+U": () => {
        console.log("Command/Ctrl + Shift + U pressed. Opening update download...");
        const mainWindow = this.deps.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("download-update");
        }
      },
      // Settings - Unlock interactive mode (dual verification)
      "CommandOrControl+Shift+,": () => {
        console.log("Command/Ctrl + Shift + , pressed. Requesting interactive settings mode...");
        const mainWindow = this.deps.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("settings-unlock");
        }
      },
      // Toggle transparency mode - Ctrl/Cmd + Shift + V
      "CommandOrControl+Shift+V": () => {
        console.log("Command/Ctrl + Shift + V pressed. Toggling transparency mode...");
        const mainWindow = this.deps.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("toggle-transparency");
        }
      },
      // Toggle system audio capture (audio only) - Ctrl/Cmd + Shift + A
      "CommandOrControl+Shift+A": async () => {
        console.log("Command/Ctrl + Shift + A pressed. Toggling system audio capture (audio only mode)...");
        if (process.platform === "win32") {
          try {
            const isCapturing = await systemAudioHelper.toggle();
            this.stopAutoScreenshots();
            console.log(`[SystemAudio] Capture ${isCapturing ? "started" : "stopped"} (audio only mode)`);
            const mainWindow = this.deps.getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("system-audio:toggled", { isCapturing, mode: "audio-only" });
            }
          } catch (error: any) {
            this.stopAutoScreenshots();
            console.error("[SystemAudio] Toggle failed:", error);
            const mainWindow = this.deps.getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("system-audio:error", { 
                message: error?.message || String(error) 
              });
            }
          }
        } else {
          console.log("[SystemAudio] System audio capture only available on Windows");
        }
      },
      // Toggle system audio capture (audio + screenshot) - Ctrl/Cmd + Shift + S
      "CommandOrControl+Shift+S": async () => {
        console.log("Command/Ctrl + Shift + S pressed. Toggling system audio capture (audio + screenshot mode)...");
        if (process.platform === "win32") {
          try {
            const isCapturing = await systemAudioHelper.toggle();
            console.log(`[SystemAudio] Capture ${isCapturing ? "started" : "stopped"} (audio + screenshot mode)`);

            if (isCapturing) {
              await this.startAutoScreenshotsIfEnabled();
            } else {
              this.stopAutoScreenshots();
            }

            const mainWindow = this.deps.getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("system-audio:toggled", { isCapturing, mode: "audio-screenshot" });
            }
          } catch (error: any) {
            this.stopAutoScreenshots();
            console.error("[SystemAudio] Toggle failed:", error);
            const mainWindow = this.deps.getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("system-audio:error", { 
                message: error?.message || String(error) 
              });
            }
          }
        } else {
          console.log("[SystemAudio] System audio capture only available on Windows");
        }
      },
    };
  }

  private stopAutoScreenshots(): void {
    if (this.autoScreenshotTimer) {
      clearInterval(this.autoScreenshotTimer);
      this.autoScreenshotTimer = null;
    }
  }

  private async captureAndAnnounceScreenshot(): Promise<void> {
    if (!systemAudioHelper.isCapturing()) {
      if (this.autoScreenshotTimer) {
        this.stopAutoScreenshots();
      }
      return;
    }

    try {
      const screenshotPath = await this.deps.takeScreenshot();
      const mainWindow = this.deps.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("screenshot-taken", {
          path: screenshotPath,
        });
      }
    } catch (error) {
      console.error("[Shortcuts] Auto screenshot failed:", error);
    }
  }

  private async startAutoScreenshotsIfEnabled(): Promise<void> {
    this.stopAutoScreenshots();

    let intervalSeconds = 60;
    try {
      intervalSeconds = await this.deps.getScreenshotIntervalSeconds();
    } catch (error) {
      console.warn("[Shortcuts] Failed to load screenshot interval, using default 60s:", error);
    }

    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
      return;
    }

    await this.captureAndAnnounceScreenshot();

    this.autoScreenshotTimer = setInterval(() => {
      this.captureAndAnnounceScreenshot();
    }, intervalSeconds * 1000);
  }

  public registerAppShortcuts(): void {
    Object.entries(this.shortcuts).forEach(([key, handler]) => {
      try {
        const isRegistered = globalShortcut.isRegistered(key);
        if (isRegistered) {
          globalShortcut.unregister(key);
        }
        const success = globalShortcut.register(key, handler);
        if (success) {
          console.log(`✓ Registered shortcut: ${key}`);
        }
        // Silently ignore registration failures in test environment
      } catch (error) {
        // Silently ignore errors in test environment
      }
    });
  }

  public unregisterAppShortcuts(): void {
    Object.keys(this.shortcuts).forEach((key) => {
      try {
        globalShortcut.unregister(key);
        console.log(`Unregistered shortcut: ${key}`);
      } catch (error) {
        console.error(`Failed to unregister shortcut ${key}:`, error);
      }
    });
  }

  public registerGlobalShortcuts(): void {
    // Toggle window shortcut - this one should always work
    // The backslash key needs to be properly escaped
    const toggleHandler = async () => {
      console.log("[Shortcuts] Toggle shortcut (Ctrl/Cmd + \\) triggered");
      const wasVisible = this.deps.isWindowUsable();
      console.log(`[Shortcuts] Window was visible: ${wasVisible}`);
      this.deps.toggleMainWindow();

      // If the window was visible and is now being hidden, unregister the shortcuts
      if (wasVisible) {
        console.log("[Shortcuts] Window hidden, unregistering app shortcuts");
        this.unregisterAppShortcuts();
        
        // Shutdown phantom-audio to free memory when window is hidden
        if (process.platform === "win32") {
          console.log("[Shortcuts] Shutting down phantom-audio to free memory");
          try {
            await systemAudioHelper.shutdown();
          } catch (error) {
            console.error("[Shortcuts] Error shutting down phantom-audio:", error);
          }
        }
      } else {
        // If the window was hidden and is now being shown, register the shortcuts
        console.log("[Shortcuts] Window shown, registering app shortcuts");
        this.registerAppShortcuts();
      }
    };

    // Try registering the backslash shortcut with proper escaping
    // On Windows, backslash might need different handling
    const shortcutKey = process.platform === "win32" 
      ? "Control+\\"  // Windows format
      : "CommandOrControl+\\";  // macOS/Linux format

    try {
      // Unregister first if already registered
      if (globalShortcut.isRegistered(shortcutKey)) {
        console.log(`[Shortcuts] Unregistering existing shortcut: ${shortcutKey}`);
        globalShortcut.unregister(shortcutKey);
      }
      
      const success = globalShortcut.register(shortcutKey, toggleHandler);
      
      if (success) {
        console.log(`✓ Successfully registered toggle shortcut: ${shortcutKey}`);
      } else {
        console.error(`✗ Failed to register toggle shortcut: ${shortcutKey}`);
        console.error("[Shortcuts] This shortcut may be in use by another application.");
        console.error("[Shortcuts] Please check for conflicts or try restarting the app.");
        
        // Try alternative: Use a different key combination as fallback
        const fallbackKey = "CommandOrControl+Shift+H";
        try {
          if (globalShortcut.isRegistered(fallbackKey)) {
            globalShortcut.unregister(fallbackKey);
          }
          const fallbackSuccess = globalShortcut.register(fallbackKey, toggleHandler);
          if (fallbackSuccess) {
            console.log(`✓ Registered fallback toggle shortcut: ${fallbackKey}`);
          }
        } catch (fallbackError) {
          console.error(`✗ Failed to register fallback shortcut: ${fallbackKey}`, fallbackError);
        }
      }
    } catch (error) {
      console.error(`✗ Error registering toggle shortcut ${shortcutKey}:`, error);
    }

    // (Reverted) Keep core actions tied to window visibility

    // Register initial shortcuts if window is visible
    if (this.deps.isWindowUsable()) {
      this.registerAppShortcuts();
    }

    // Unregister all shortcuts when quitting
    app.on("will-quit", () => {
      try { globalShortcut.unregisterAll(); } catch {}
    });
  }
}
