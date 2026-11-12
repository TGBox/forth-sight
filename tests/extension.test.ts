import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItem: class {
    label: string;
    collapsibleState: number;
    tooltip?: string;
    description?: string;
    command?: unknown;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
  window: {
    createStatusBarItem: vi.fn(() => ({
      text: '',
      tooltip: '',
      command: '',
      show: vi.fn(),
      dispose: vi.fn(),
    })),
    showInformationMessage: vi.fn(),
    registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(() => undefined),
    })),
  },
}));

import { activate, formatGreeting } from '../src/extension';

describe('forth-sight Extension', () => {
  it('formats default greeting when no custom setting is given', () => {
    expect(formatGreeting()).toBe('Hallo aus forth-sight!');
    expect(formatGreeting('   ')).toBe('Hallo aus forth-sight!');
  });

  it('uses custom greeting when provided', () => {
    expect(formatGreeting('Willkommen im Projekt!')).toBe('Willkommen im Projekt!');
  });

  it('registers subscriptions on activate', () => {
    const subscriptions: unknown[] = [];
    const mockContext = {
      subscriptions,
      extensionUri: { fsPath: '/test' },
    } as unknown as Parameters<typeof activate>[0];

    activate(mockContext);
    expect(subscriptions.length).toBeGreaterThanOrEqual(2);
  });
});
