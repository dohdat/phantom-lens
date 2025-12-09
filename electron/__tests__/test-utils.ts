/**
 * Test utilities and helpers
 * Shared utilities for all test files
 */

import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';

/**
 * Create a mock child process with standard streams
 */
export function createMockChildProcess(): EventEmitter & Partial<ChildProcess> {
  const mockProcess = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
  
  mockProcess.kill = jest.fn((signal?: string) => {
    mockProcess.emit('exit', signal === 'SIGKILL' ? 137 : 0);
    return true;
  });
  
  mockProcess.killed = false;
  mockProcess.stdout = new EventEmitter() as any;
  mockProcess.stderr = new EventEmitter() as any;
  mockProcess.stdin = {
    write: jest.fn(),
    end: jest.fn(),
  } as any;
  
  return mockProcess;
}

/**
 * Create a mock BrowserWindow
 */
export function createMockBrowserWindow(): any {
  return {
    loadURL: jest.fn(),
    loadFile: jest.fn(),
    on: jest.fn(),
    webContents: {
      send: jest.fn(),
      on: jest.fn(),
      openDevTools: jest.fn(),
    },
    isDestroyed: jest.fn(() => false),
    show: jest.fn(),
    hide: jest.fn(),
    setAlwaysOnTop: jest.fn(),
    setIgnoreMouseEvents: jest.fn(),
    getBounds: jest.fn(() => ({ x: 100, y: 100, width: 800, height: 600 })),
    setBounds: jest.fn(),
    setOpacity: jest.fn(),
    getTitle: jest.fn(() => 'PhantomLens'),
    focus: jest.fn(),
    blur: jest.fn(),
    close: jest.fn(),
  };
}

/**
 * Wait for a specific amount of time
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await wait(interval);
  }
}

/**
 * Mock console methods to avoid noise in tests
 */
export function mockConsole(): {
  restore: () => void;
  log: jest.SpyInstance;
  error: jest.SpyInstance;
  warn: jest.SpyInstance;
} {
  const logSpy = jest.spyOn(console, 'log').mockImplementation();
  const errorSpy = jest.spyOn(console, 'error').mockImplementation();
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
  
  return {
    restore: () => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    },
    log: logSpy,
    error: errorSpy,
    warn: warnSpy,
  };
}

/**
 * Create a mock file system
 */
export function createMockFileSystem(): {
  existsSync: jest.Mock;
  readFileSync: jest.Mock;
  writeFileSync: jest.Mock;
  chmodSync: jest.Mock;
  promises: {
    access: jest.Mock;
    mkdir: jest.Mock;
    writeFile: jest.Mock;
    readFile: jest.Mock;
  };
} {
  return {
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() => ''),
    writeFileSync: jest.fn(),
    chmodSync: jest.fn(),
    promises: {
      access: jest.fn().mockResolvedValue(undefined),
      mkdir: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn().mockResolvedValue(Buffer.from('')),
    },
  };
}

/**
 * Simulate JSON streaming data
 */
export function* jsonStreamGenerator(objects: any[]): Generator<string> {
  for (const obj of objects) {
    const json = JSON.stringify(obj);
    // Simulate chunked data
    const chunkSize = Math.max(1, Math.floor(json.length / 3));
    for (let i = 0; i < json.length; i += chunkSize) {
      yield json.slice(i, i + chunkSize);
    }
    yield '\n';
  }
}

/**
 * Mock platform for testing platform-specific code
 */
export function mockPlatform(platform: NodeJS.Platform): () => void {
  const originalPlatform = process.platform;
  
  Object.defineProperty(process, 'platform', {
    value: platform,
    writable: true,
  });
  
  return () => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
    });
  };
}

/**
 * Create a test timeout that automatically cleans up
 */
export function createTestTimeout(ms: number): {
  clear: () => void;
  promise: Promise<never>;
} {
  let timeoutId: NodeJS.Timeout;
  
  const promise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Test timeout after ${ms}ms`));
    }, ms);
  });
  
  return {
    clear: () => clearTimeout(timeoutId),
    promise,
  };
}

/**
 * Assert that a function throws with a specific message
 */
export async function assertThrows(
  fn: () => any | Promise<any>,
  expectedMessage?: string | RegExp
): Promise<void> {
  let threw = false;
  let error: Error | undefined;
  
  try {
    const result = fn();
    if (result instanceof Promise) {
      await result;
    }
  } catch (e) {
    threw = true;
    error = e as Error;
  }
  
  if (!threw) {
    throw new Error('Expected function to throw but it did not');
  }
  
  if (expectedMessage) {
    if (typeof expectedMessage === 'string') {
      if (!error?.message.includes(expectedMessage)) {
        throw new Error(
          `Expected error message to include "${expectedMessage}" but got "${error?.message}"`
        );
      }
    } else {
      if (!expectedMessage.test(error?.message || '')) {
        throw new Error(
          `Expected error message to match ${expectedMessage} but got "${error?.message}"`
        );
      }
    }
  }
}

/**
 * Create a deferred promise that can be resolved/rejected externally
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  
  return { promise, resolve, reject };
}
