/**
 * Unit tests for ScreenshotHelper
 * Focus on queue management, cleanup, and status reporting
 */

import { ScreenshotHelper } from '../ScreenshotHelper';
import { app } from 'electron';
import fs from 'node:fs';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/phantomlens'),
  },
}));

jest.mock('node:fs', () => {
  const promises = {
    unlink: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(Buffer.from('')),
    readdir: jest.fn().mockResolvedValue([]),
  };

  return {
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    promises,
  };
});

describe('ScreenshotHelper', () => {
  let helper: ScreenshotHelper;
  const fsPromises = (fs as any).promises;

  beforeEach(() => {
    jest.clearAllMocks();
    helper = new ScreenshotHelper('initial');
  });

  describe('constructor', () => {
    it('creates screenshot directories when missing', () => {
      (fs.existsSync as jest.Mock).mockReturnValueOnce(false).mockReturnValueOnce(false);

      helper = new ScreenshotHelper('initial');

      expect(app.getPath).toHaveBeenCalledWith('userData');
      expect(fs.mkdirSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('addToQueue', () => {
    it('keeps only the most recent MAX_SCREENSHOTS items', async () => {
      const total = 25;
      for (let i = 0; i < total; i++) {
        await (helper as any).addToQueue(`file-${i}.png`, false);
      }

      const queue = helper.getScreenshotQueue();
      expect(queue.length).toBe(20);
      expect(queue[0]).toBe('file-5.png');
      expect(queue[queue.length - 1]).toBe('file-24.png');
      expect(fsPromises.unlink).toHaveBeenCalledTimes(total - 20);
    });

    it('rejects when queue processing is already in progress', async () => {
      (helper as any).isProcessingQueue = true;

      await expect((helper as any).addToQueue('stale.png', false)).rejects.toThrow(
        /Queue is busy/i
      );
      expect(helper.getScreenshotQueue()).toEqual([]);
    });
  });

  describe('clearQueues', () => {
    it('clears both queues and deletes files', async () => {
      (helper as any).screenshotQueue = ['main-1.png', 'main-2.png'];
      (helper as any).extraScreenshotQueue = ['extra-1.png'];

      await helper.clearQueues();

      expect(helper.getScreenshotQueue()).toEqual([]);
      expect(helper.getExtraScreenshotQueue()).toEqual([]);
      expect(fsPromises.unlink).toHaveBeenCalledWith('main-1.png');
      expect(fsPromises.unlink).toHaveBeenCalledWith('main-2.png');
      expect(fsPromises.unlink).toHaveBeenCalledWith('extra-1.png');
    });
  });

  describe('destroy', () => {
    it('waits for pending operations and performs cleanup', async () => {
      const pending = Promise.resolve();
      (helper as any).pendingOperations.add(pending);
      const cleanupSpy = jest.spyOn(helper as any, 'cleanupAllScreenshots').mockResolvedValue(undefined);

      await helper.destroy();

      expect(cleanupSpy).toHaveBeenCalled();
      expect((helper as any).pendingOperations.size).toBe(1);
    });
  });

  describe('getStatus', () => {
    it('returns current helper state', () => {
      (helper as any).isCapturingScreenshot = true;
      (helper as any).isProcessingQueue = true;
      (helper as any).pendingOperations.add(Promise.resolve());
      (helper as any).screenshotQueue = ['a'];
      (helper as any).extraScreenshotQueue = ['b', 'c'];
      helper.setView('response');

      const status = helper.getStatus();

      expect(status).toEqual({
        isCapturing: true,
        isProcessingQueue: true,
        pendingOperations: 1,
        mainQueueSize: 1,
        extraQueueSize: 2,
        currentView: 'response',
      });
    });
  });
});
