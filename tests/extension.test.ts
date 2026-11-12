import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindFiles = vi.fn<() => Promise< Array<{ fsPath: string; toString: () => string }> >>(async () => []);
const mockReadFile = vi.fn<(uri: { fsPath: string }) => Promise<Uint8Array>>(async () => new Uint8Array());

let registeredHoverProvider: {
  provideHover: (document: unknown, position: unknown) => unknown;
} | null = null;

let registeredDefinitionProvider: {
  provideDefinition: (document: unknown, position: unknown) => unknown;
} | null = null;

vi.mock('vscode', () => ({
  Position: class {
    line: number;
    character: number;
    constructor(line: number, character: number) {
      this.line = line;
      this.character = character;
    }
  },
  Location: class {
    uri: { fsPath: string; toString: () => string };
    range: { start: { line: number; character: number } };
    constructor(
      uri: { fsPath: string; toString: () => string },
      pos: { line: number; character: number }
    ) {
      this.uri = uri;
      this.range = { start: pos };
    }
  },
  MarkdownString: class {
    value = '';
    appendMarkdown(text: string) {
      this.value += text;
      return this;
    }
    appendCodeblock(code: string, language = '') {
      this.value += `\`\`\`${language}\n${code}\n\`\`\`\n`;
      return this;
    }
  },
  Hover: class {
    contents: unknown;
    constructor(contents: unknown) {
      this.contents = contents;
    }
  },
  workspace: {
    findFiles: () => mockFindFiles(),
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: vi.fn(),
      onDidCreate: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: vi.fn(),
    })),
    fs: {
      readFile: (uri: { fsPath: string }) => mockReadFile(uri),
    },
    asRelativePath: vi.fn((uri: { fsPath: string }) => uri.fsPath),
  },
  languages: {
    registerHoverProvider: vi.fn((_selector: string, provider: typeof registeredHoverProvider) => {
      registeredHoverProvider = provider;
      return { dispose: vi.fn() };
    }),
    registerDefinitionProvider: vi.fn(
      (_selector: string, provider: typeof registeredDefinitionProvider) => {
        registeredDefinitionProvider = provider;
        return { dispose: vi.fn() };
      }
    ),
  },
}));

import { activate, deactivate } from '../src/extension';

describe('forth-sight Extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredHoverProvider = null;
    registeredDefinitionProvider = null;
    deactivate();
  });

  it('registers watcher, hover provider, and definition provider on activate', async () => {
    mockFindFiles.mockResolvedValueOnce([]);
    const subscriptions: unknown[] = [];
    const mockContext = {
      subscriptions,
      extensionUri: { fsPath: '/test' },
    } as unknown as Parameters<typeof activate>[0];

    await activate(mockContext);
    expect(subscriptions.length).toBe(3);
    expect(registeredHoverProvider).not.toBeNull();
    expect(registeredDefinitionProvider).not.toBeNull();
  });

  it('indexes Forth definitions and provides hover and definition locations', async () => {
    const fakeUri = {
      fsPath: 'math.fs',
      toString: () => 'file:///math.fs',
    };
    const forthSource = [
      '\\ Berechnet das Quadrat',
      ': square ( n -- n^2 )',
      '  dup * ;',
    ].join('\n');

    mockFindFiles.mockResolvedValueOnce([fakeUri]);
    mockReadFile.mockResolvedValueOnce(Buffer.from(forthSource, 'utf8'));

    const subscriptions: unknown[] = [];
    const mockContext = {
      subscriptions,
      extensionUri: { fsPath: '/test' },
    } as unknown as Parameters<typeof activate>[0];

    await activate(mockContext);

    const mockDocument = {
      getWordRangeAtPosition: vi.fn(() => ({ start: { line: 0, character: 0 } })),
      getText: vi.fn(() => 'SQUARE'),
    };

    const hover = registeredHoverProvider?.provideHover(mockDocument, { line: 0, character: 0 }) as {
      contents: { value: string };
    } | null;
    expect(hover).not.toBeNull();
    expect(hover?.contents.value).toContain(': square');
    expect(hover?.contents.value).toContain('( n -- n^2 )');
    expect(hover?.contents.value).toContain('Berechnet das Quadrat');

    const definitions = registeredDefinitionProvider?.provideDefinition(mockDocument, {
      line: 0,
      character: 0,
    }) as Array<{ uri: typeof fakeUri; range: { start: { line: number } } }> | null;
    expect(definitions).toHaveLength(1);
    expect(definitions?.[0].uri.fsPath).toBe('math.fs');
    expect(definitions?.[0].range.start.line).toBe(1);
  });

  it('clears the word index on deactivate', async () => {
    const fakeUri = {
      fsPath: 'const.fs',
      toString: () => 'file:///const.fs',
    };
    mockFindFiles.mockResolvedValueOnce([fakeUri]);
    mockReadFile.mockResolvedValueOnce(Buffer.from('42 constant answer', 'utf8'));

    const mockContext = {
      subscriptions: [],
      extensionUri: { fsPath: '/test' },
    } as unknown as Parameters<typeof activate>[0];

    await activate(mockContext);
    deactivate();

    const mockDocument = {
      getWordRangeAtPosition: vi.fn(() => ({ start: { line: 0, character: 0 } })),
      getText: vi.fn(() => 'answer'),
    };

    expect(registeredDefinitionProvider?.provideDefinition(mockDocument, { line: 0, character: 0 })).toBeNull();
  });
});
