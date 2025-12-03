import { autoUpdater, UpdateInfo, ProgressInfo } from "electron-updater";
import { app, BrowserWindow } from "electron";
import log from "electron-log";

// Configure logging for auto-updater
autoUpdater.logger = log;
(autoUpdater.logger as typeof log).transports.file.level = "info";

export interface AutoUpdateStatus {
  status: "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  info?: UpdateInfo;
  progress?: ProgressInfo;
  error?: string;
}

type UpdateCallback = (status: AutoUpdateStatus) => void;

class AutoUpdaterService {
  private mainWindow: BrowserWindow | null = null;
  private updateCallbacks: UpdateCallback[] = [];
  private currentStatus: AutoUpdateStatus = { status: "not-available" };
  private isInitialized = false;

  constructor() {
    // Configure auto-updater settings
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    
    // For testing, you can set this to true to check for updates on every launch
    // autoUpdater.forceDevUpdateConfig = true;
    
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    autoUpdater.on("checking-for-update", () => {
      log.info("[AutoUpdater] Checking for updates...");
      this.notifyStatus({ status: "checking" });
    });

    autoUpdater.on("update-available", (info: UpdateInfo) => {
      log.info("[AutoUpdater] Update available:", info.version);
      this.notifyStatus({ status: "available", info });
    });

    autoUpdater.on("update-not-available", (info: UpdateInfo) => {
      log.info("[AutoUpdater] No update available. Current version:", app.getVersion());
      this.notifyStatus({ status: "not-available", info });
    });

    autoUpdater.on("download-progress", (progress: ProgressInfo) => {
      const logMessage = `Download speed: ${this.formatBytes(progress.bytesPerSecond)}/s - Downloaded ${progress.percent.toFixed(1)}% (${this.formatBytes(progress.transferred)}/${this.formatBytes(progress.total)})`;
      log.info("[AutoUpdater]", logMessage);
      this.notifyStatus({ status: "downloading", progress });
      
      // Send progress to renderer
      this.sendToRenderer("auto-update-progress", {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      });
    });

    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      log.info("[AutoUpdater] Update downloaded:", info.version);
      this.notifyStatus({ status: "downloaded", info });
      
      // Notify renderer that update is ready
      this.sendToRenderer("auto-update-downloaded", {
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseName: info.releaseName,
        releaseDate: info.releaseDate
      });
    });

    autoUpdater.on("error", (error: Error) => {
      log.error("[AutoUpdater] Error:", error.message);
      this.notifyStatus({ status: "error", error: error.message });
      
      // Send error to renderer
      this.sendToRenderer("auto-update-error", {
        message: error.message
      });
    });
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  private notifyStatus(status: AutoUpdateStatus): void {
    this.currentStatus = status;
    this.updateCallbacks.forEach(cb => cb(status));
  }

  private sendToRenderer(channel: string, data: any): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send(channel, data);
      } catch (error) {
        log.warn("[AutoUpdater] Failed to send to renderer:", error);
      }
    }
  }

  public initialize(mainWindow: BrowserWindow): void {
    if (this.isInitialized) {
      log.warn("[AutoUpdater] Already initialized");
      return;
    }
    
    this.mainWindow = mainWindow;
    this.isInitialized = true;
    log.info("[AutoUpdater] Initialized with main window");
    
    // Check for updates after a short delay (let the app settle first)
    setTimeout(() => {
      this.checkForUpdates();
    }, 5000);
  }

  public setMainWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
  }

  public async checkForUpdates(): Promise<void> {
    if (!app.isPackaged) {
      log.info("[AutoUpdater] Skipping update check in development mode");
      return;
    }
    
    try {
      log.info("[AutoUpdater] Starting update check...");
      await autoUpdater.checkForUpdates();
    } catch (error: any) {
      log.error("[AutoUpdater] Check for updates failed:", error.message);
    }
  }

  public async downloadUpdate(): Promise<void> {
    try {
      await autoUpdater.downloadUpdate();
    } catch (error: any) {
      log.error("[AutoUpdater] Download update failed:", error.message);
      throw error;
    }
  }

  public quitAndInstall(): void {
    log.info("[AutoUpdater] Quitting and installing update...");
    autoUpdater.quitAndInstall(false, true);
  }

  public onStatusChange(callback: UpdateCallback): () => void {
    this.updateCallbacks.push(callback);
    // Immediately notify with current status
    callback(this.currentStatus);
    
    return () => {
      const index = this.updateCallbacks.indexOf(callback);
      if (index > -1) {
        this.updateCallbacks.splice(index, 1);
      }
    };
  }

  public getStatus(): AutoUpdateStatus {
    return this.currentStatus;
  }

  public isUpdateDownloaded(): boolean {
    return this.currentStatus.status === "downloaded";
  }
}

// Export singleton instance
export const autoUpdaterService = new AutoUpdaterService();
