import {
  getAllowedCommandNames,
  isSafeRelativePath,
  validateCommandInvocation as v,
} from '../../lib/core/skills/commandPolicy';

const posix = (command: string, args: string[] = []) => v(command, args, 'linux');
const win = (command: string, args: string[] = []) => v(command, args, 'win32');

describe('isSafeRelativePath', () => {
  it.each(['a', 'a/b.txt', './a', 'a/../b', '.', 'dir\\file', 'a//b'])('accepts %s', (p) => {
    expect(isSafeRelativePath(p)).toBe(true);
  });
  it.each(['/etc/passwd', '..', '../x', 'a/../../x', '~/x', 'C:\\Users\\x', 'c:/x', '\\\\server\\share', '/abs/in/sandbox'])(
    'rejects %s',
    (p) => {
      expect(isSafeRelativePath(p)).toBe(false);
    },
  );
});

describe('validateCommandInvocation (posix)', () => {
  it('rejects commands outside the allowlist', () => {
    expect(posix('rm', ['x'])).toMatch(/not allowed/);
    expect(posix('dir')).toMatch(/not allowed/);
  });

  describe('find (#137: destructive / writing primaries)', () => {
    it.each([
      [['-delete']],
      [['-exec', 'rm', '{}', '+']],
      [['-execdir', 'cat', '{}', '+']],
      [['-ok', 'rm', '{}']],
      [['-fprint', 'out.txt']],
      [['-fprintf', 'out.txt', '%p']],
      [['-fls', 'out.txt']],
      [['-printf', 'x']],
    ])('rejects find . %j', (expr) => {
      expect(posix('find', ['.', ...expr])).toMatch(/not allowed/);
    });

    it('accepts read-only searches', () => {
      expect(posix('find', ['.', '-name', '*.txt', '-type', 'f', '-maxdepth', '2'])).toBeNull();
      expect(posix('find', ['docs', '-newer', 'a.txt', '-o', '-empty'])).toBeNull();
      expect(posix('find')).toBeNull();
    });

    it('rejects starting points and -newer references outside the sandbox', () => {
      expect(posix('find', ['/', '-name', 'x'])).toMatch(/outside the sandbox/);
      expect(posix('find', ['..', '-name', 'x'])).toMatch(/outside the sandbox/);
      expect(posix('find', ['.', '-newer', '/etc/passwd'])).toMatch(/outside the sandbox/);
    });
  });

  describe('sort / uniq (#137: output files)', () => {
    it('rejects sort -o and --output', () => {
      expect(posix('sort', ['-o', 'out.txt', 'in.txt'])).toMatch(/not allowed/);
      expect(posix('sort', ['-oout.txt', 'in.txt'])).toMatch(/not allowed/);
      expect(posix('sort', ['--output=out.txt', 'in.txt'])).toMatch(/not allowed/);
    });
    it('accepts plain sort and uniq with one input', () => {
      expect(posix('sort', ['-rn', 'in.txt'])).toBeNull();
      expect(posix('uniq', ['-c', 'in.txt'])).toBeNull();
    });
    it('rejects uniq with an output file', () => {
      expect(posix('uniq', ['in.txt', 'out.txt'])).toMatch(/at most 1/);
    });
  });

  describe('absolute and escaping paths (#137: reads outside the sandbox)', () => {
    it.each([
      ['cat', ['/etc/hostname']],
      ['cat', ['C:\\Users\\me\\.env.local']],
      ['cat', ['/abs/path/.env.local']],
      ['cat', ['sub/../../.env.local']],
      ['head', ['-n', '5', '/abs/file']],
      ['tail', ['-5', '..']],
      ['wc', ['-l', '~/secret']],
      ['grep', ['token', '/abs/file']],
      ['grep', ['-r', 'token', '..']],
      ['ls', ['/']],
      ['du', ['-s', '/']],
      ['df', ['/']],
    ])('rejects %s %j', (command, args) => {
      expect(posix(command, args)).toMatch(/outside the sandbox/);
    });

    it('accepts sandbox-relative paths', () => {
      expect(posix('cat', ['notes/a.txt'])).toBeNull();
      expect(posix('head', ['-n', '5', 'a.txt'])).toBeNull();
      expect(posix('tail', ['-5', 'a.txt'])).toBeNull();
      expect(posix('ls', ['-la', '.'])).toBeNull();
      expect(posix('ls')).toBeNull();
    });

    it('treats the grep pattern as text but checks the file arguments', () => {
      expect(posix('grep', ['/etc/passwd', 'a.txt'])).toBeNull(); // pattern, not a path
      expect(posix('grep', ['-e', 'foo', '-e', 'bar', 'a.txt'])).toBeNull();
      expect(posix('grep', ['-e', 'foo', '/abs'])).toMatch(/outside the sandbox/);
      expect(posix('grep', ['-rn', 'todo'])).toBeNull();
    });
  });

  describe('state-changing / stdin-hanging forms', () => {
    it('rejects date -s and positional date/hostname values', () => {
      expect(posix('date', ['-s', '2020-01-01'])).toMatch(/not allowed/);
      expect(posix('date', ['010100002020'])).toMatch(/does not take arguments/);
      expect(posix('hostname', ['evil'])).toMatch(/does not take arguments/);
    });
    it('rejects tail -f and long options', () => {
      expect(posix('tail', ['-f', 'a.txt'])).toMatch(/not allowed/);
      expect(posix('grep', ['--file=/etc/passwd', 'x', 'a'])).toMatch(/not allowed/);
      expect(posix('ls', ['--color=always'])).toMatch(/not allowed/);
    });
    it('rejects grep -f (pattern file) and commands that would read stdin forever', () => {
      expect(posix('grep', ['-f', 'p.txt', 'a.txt'])).toMatch(/not allowed/);
      expect(posix('cat')).toMatch(/at least 1/);
      expect(posix('grep', ['foo'])).toMatch(/at least one file/);
    });
    it('requires numeric values for numeric options', () => {
      expect(posix('head', ['-n', 'abc', 'a.txt'])).toMatch(/numeric/);
      expect(posix('head', ['-n'])).toMatch(/requires a value/);
    });
  });

  it('echo accepts arbitrary text arguments', () => {
    expect(posix('echo', ['hello', '-n', '/not/a/path'])).toBeNull();
  });
});

describe('validateCommandInvocation (win32)', () => {
  it('exposes only commands that exist in cmd.exe', () => {
    expect(getAllowedCommandNames('win32').sort()).toEqual(['dir', 'echo', 'hostname', 'type', 'whoami']);
    expect(win('cat', ['a'])).toMatch(/not allowed/);
    expect(win('find', ['.'])).toMatch(/not allowed/);
  });
  it('accepts dir switches but still checks paths', () => {
    expect(win('dir', ['/b', '/s'])).toBeNull();
    expect(win('dir', ['C:\\Windows'])).toMatch(/outside the sandbox/);
    expect(win('dir', ['sub'])).toBeNull();
  });
  it('checks type paths', () => {
    expect(win('type', ['..\\secret'])).toMatch(/outside the sandbox/);
    expect(win('type', ['a.txt'])).toBeNull();
  });
});
