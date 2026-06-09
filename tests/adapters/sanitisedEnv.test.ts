import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sanitisedEnv } from '../../src/adapters/claude.js';

// WS_02-D2-allowlist confirmed vars (PATH and USER): verified by T-2 literal assertions below.
// Tests use a controlled mock of process.env to isolate the function from the host machine.

// Representative sample of Haiku path-leak class vars that must be stripped.
const HAIKU_LEAK_VARS = [
  'PWD',
  'OLDPWD',
  'HOME',
  'SHELL',
  'SHLVL',
  'TERM',
  'TERM_PROGRAM',
  'ITERM_SESSION_ID',
  'COLORTERM',
  'NVM_DIR',
  'JAVA_HOME',
  'GOPATH',
  'CARGO_HOME',
  'npm_config_prefix',
  'LOGNAME',
  'EDITOR',
  'PAGER',
  'MANPATH',
] as const;

describe('sanitisedEnv', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = {
      PATH: '/usr/local/bin:/usr/bin',
      USER: 'testuser',
      PWD: '/home/testuser/project',
      OLDPWD: '/home/testuser',
      HOME: '/home/testuser',
      SHELL: '/bin/zsh',
      SHLVL: '2',
      TERM: 'xterm-256color',
      TERM_PROGRAM: 'iTerm.app',
      ITERM_SESSION_ID: 'fake-session-id',
      COLORTERM: 'truecolor',
      NVM_DIR: '/home/testuser/.nvm',
      JAVA_HOME: '/usr/local/java',
      GOPATH: '/home/testuser/go',
      CARGO_HOME: '/home/testuser/.cargo',
      npm_config_prefix: '/home/testuser/.npm',
      LOGNAME: 'testuser',
      EDITOR: '/usr/bin/vim',
      PAGER: '/usr/bin/less',
      MANPATH: '/usr/share/man',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('T-1: Haiku path-leak class vars are absent from the return value', () => {
    const result = sanitisedEnv();

    for (const varName of HAIKU_LEAK_VARS) {
      expect(
        result[varName],
        `expected ${varName} to be absent from sanitisedEnv() result`,
      ).toBeUndefined();
    }
  });

  it('T-2: required auth vars are present in the return value', () => {
    const result = sanitisedEnv();

    expect(result['PATH']).toBe('/usr/local/bin:/usr/bin');
    expect(result['USER']).toBe('testuser');
  });

  it('T-3: Haiku leak class var absent even when present in process.env (confirms active stripping)', () => {
    process.env['ITERM_SESSION_ID'] = 'definitely-present';

    const result = sanitisedEnv();

    expect(result['ITERM_SESSION_ID']).toBeUndefined();
    expect(result['HOME']).toBeUndefined();
    expect(result['SHELL']).toBeUndefined();
    expect(result['PWD']).toBeUndefined();
  });

  it('T-4: return value is a fresh object, not process.env', () => {
    const result = sanitisedEnv();

    expect(result).not.toBe(process.env);

    // Mutating the result must not affect process.env.
    result['__test_mutation'] = 'mutated';
    expect(process.env['__test_mutation']).toBeUndefined();

    // Successive calls return distinct objects.
    const result2 = sanitisedEnv();
    expect(result).not.toBe(result2);
  });

  it('T-5: missing required var in process.env does not throw; missing var is absent from result', () => {
    delete process.env['USER'];

    let result: Record<string, string> | undefined;
    expect(() => {
      result = sanitisedEnv();
    }).not.toThrow();

    expect(result!['USER']).toBeUndefined();
    // PATH is still present.
    expect(result!['PATH']).toBe('/usr/local/bin:/usr/bin');
  });
});
