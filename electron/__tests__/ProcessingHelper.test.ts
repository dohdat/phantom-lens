/**
 * Unit tests for ProcessingHelper
 * Focus on cancellation safeguards and follow-up processing flows
 */

import { ProcessingHelper } from '../ProcessingHelper';
import { IProcessingHelperDeps } from '../main';
import fs from 'node:fs';

jest.mock('sharp', () =>
  jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('optimized')),
  }))
);

jest.mock('node:fs');

describe('ProcessingHelper', () => {
  let helper: ProcessingHelper;
  let deps: jest.Mocked<IProcessingHelperDeps>;
  let mockWindow: any;
  let mockScreenshotHelper: any;

  const PROCESSING_EVENTS = {
    API_KEY_INVALID: 'processing-api-key-invalid',
    INITIAL_START: 'initial-start',
    RESPONSE_SUCCESS: 'response-success',
    INITIAL_RESPONSE_ERROR: 'response-error',
    FOLLOW_UP_START: 'follow-up-start',
    FOLLOW_UP_SUCCESS: 'follow-up-success',
    FOLLOW_UP_ERROR: 'follow-up-error',
    FOLLOW_UP_CHUNK: 'follow-up-chunk',
    RESPONSE_CHUNK: 'response-chunk',
    RESET: 'reset',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockWindow = {
      isDestroyed: jest.fn(() => false),
      webContents: { send: jest.fn() },
      setSkipTaskbar: jest.fn(),
      setFocusable: jest.fn(),
      setIgnoreMouseEvents: jest.fn(),
      blur: jest.fn(),
    };

    mockScreenshotHelper = {
      getScreenshotQueue: jest.fn().mockReturnValue([]),
      getExtraScreenshotQueue: jest.fn().mockReturnValue([]),
      clearQueues: jest.fn(),
      cleanupAllScreenshots: jest.fn(),
    };

    deps = {
      getScreenshotHelper: jest.fn(() => mockScreenshotHelper),
      getMainWindow: jest.fn(() => mockWindow),
      getView: jest.fn(() => 'initial'),
      setView: jest.fn(),
      getConfiguredModel: jest.fn().mockResolvedValue('model'),
      getAudioOnlyModel: jest.fn().mockResolvedValue('audio-model'),
      getAudioScreenshotModel: jest.fn().mockResolvedValue('audio-screenshot'),
      getVisionModel: jest.fn().mockResolvedValue('vision-model'),
      getTextModel: jest.fn().mockResolvedValue('text-model'),
      getSystemPrompt: jest.fn().mockResolvedValue(null),
      setHasFollowedUp: jest.fn(),
      clearQueues: jest.fn(),
      PROCESSING_EVENTS,
      getUserPrompt: jest.fn(() => null),
      clearUserPrompt: jest.fn(),
      getPreviousResponse: jest.fn(() => null),
    } as unknown as jest.Mocked<IProcessingHelperDeps>;

    helper = new ProcessingHelper(deps);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('cancelOngoingRequests', () => {
    it('aborts active controllers, clears timeouts, resets state, and notifies renderer', () => {
      jest.useFakeTimers();

      const processingController = new AbortController();
      const extraController = new AbortController();

      (helper as any).currentProcessingAbortController = processingController;
      (helper as any).currentExtraProcessingAbortController = extraController;
      (helper as any).isCurrentlyProcessing = true;

      const timeoutId = setTimeout(() => {
        // should be cleared
      }, 1000);
      (helper as any).processingTimeouts.add(timeoutId);

      helper.cancelOngoingRequests();

      expect(processingController.signal.aborted).toBe(true);
      expect(extraController.signal.aborted).toBe(true);
      expect(deps.setHasFollowedUp).toHaveBeenCalledWith(false);
      expect(helper.isProcessing()).toBe(false);
      expect((helper as any).processingTimeouts.size).toBe(0);

      jest.runAllTimers();

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(PROCESSING_EVENTS.RESET);
    });

    it('does not emit reset if nothing was cancelled', () => {
      helper.cancelOngoingRequests();

      expect(mockWindow.webContents.send).not.toHaveBeenCalledWith(PROCESSING_EVENTS.RESET);
    });
  });

  describe('processScreenshots', () => {
    it('skips processing when a run is already in progress', async () => {
      (helper as any).isCurrentlyProcessing = true;

      await helper.processScreenshots();

      expect(deps.getView).not.toHaveBeenCalled();
      expect(helper.isProcessing()).toBe(true);
    });
  });

  describe('processFollowUp', () => {
    it('returns error when no screenshots are available', async () => {
      mockScreenshotHelper.getScreenshotQueue.mockReturnValue([]);
      mockScreenshotHelper.getExtraScreenshotQueue.mockReturnValue([]);

      await helper.processFollowUp();

      expect(deps.setView).toHaveBeenCalledWith('followup');
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(PROCESSING_EVENTS.FOLLOW_UP_START);
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        PROCESSING_EVENTS.FOLLOW_UP_ERROR,
        'No screenshots available'
      );
      expect(helper.isProcessing()).toBe(false);
    });

    it('clears user prompt and stores follow-up results on success', async () => {
      mockScreenshotHelper.getScreenshotQueue.mockReturnValue(['shot-1']);
      mockScreenshotHelper.getExtraScreenshotQueue.mockReturnValue(['extra-1']);
      (deps.getUserPrompt as jest.Mock).mockReturnValue('Follow-up question');
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('x'.repeat(256)));

      const processExtraSpy = jest
        .spyOn<any, any>(helper as any, 'processExtraScreenshotsHelper')
        .mockResolvedValue({ success: true, data: 'combined follow-up' });

      await helper.processFollowUp();

      expect(deps.clearUserPrompt).toHaveBeenCalled();
      expect(processExtraSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ path: 'shot-1' }),
          expect.objectContaining({ path: 'extra-1' }),
        ]),
        expect.any(AbortSignal),
        'Follow-up question'
      );
      expect(helper.getPreviousResponse()).toBe('combined follow-up');
      expect(deps.setHasFollowedUp).toHaveBeenCalledWith(true);
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        PROCESSING_EVENTS.FOLLOW_UP_SUCCESS,
        { response: 'combined follow-up', isFollowUp: true }
      );
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        PROCESSING_EVENTS.RESPONSE_SUCCESS,
        { response: 'combined follow-up', isFollowUp: true }
      );
      expect(helper.isProcessing()).toBe(false);
    });
  });
});
