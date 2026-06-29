import { PLATFORMS } from './paths.mjs';

const PLATFORM_LABELS = {
  cursor: 'Cursor',
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
};

/**
 * Interactive multi-select for platforms using raw mode ANSI escape.
 * Falls back to ['cursor'] in non-TTY environments.
 * @returns {Promise<string[]>}
 */
export async function selectPlatforms() {
  if (!process.stdin.isTTY) return ['cursor'];

  const items = PLATFORMS.map((name, i) => ({
    name,
    label: PLATFORM_LABELS[name] || name,
    selected: i === 0,
  }));

  let cursor = 0;

  const render = () => {
    const lines = items.map((item, i) => {
      const icon = item.selected ? '\x1b[36m◉\x1b[0m' : '◯';
      const pointer = i === cursor ? '\x1b[1m>\x1b[0m ' : '  ';
      return `${pointer}${icon} ${item.label}`;
    });
    return lines.join('\n');
  };

  const clearLines = (count) => {
    for (let i = 0; i < count; i++) {
      process.stdout.write('\x1b[1A\x1b[2K');
    }
  };

  return new Promise((resolve) => {
    process.stdout.write('选择目标平台（空格切换，回车确认）:\n');
    process.stdout.write(render() + '\n');

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    const onData = (key) => {
      if (key === '\u0003') {
        // Ctrl+C
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        stdin.pause();
        process.stdout.write('\n');
        process.exit(130);
      }

      if (key === '\r' || key === '\n') {
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        stdin.pause();
        process.stdout.write('\n');
        const selected = items.filter((it) => it.selected).map((it) => it.name);
        resolve(selected.length > 0 ? selected : ['cursor']);
        return;
      }

      if (key === ' ') {
        items[cursor].selected = !items[cursor].selected;
      } else if (key === '\x1b[A' || key === 'k') {
        cursor = (cursor - 1 + items.length) % items.length;
      } else if (key === '\x1b[B' || key === 'j') {
        cursor = (cursor + 1) % items.length;
      } else if (key === 'a') {
        const allSelected = items.every((it) => it.selected);
        items.forEach((it) => { it.selected = !allSelected; });
      } else {
        return;
      }

      clearLines(items.length);
      process.stdout.write(render() + '\n');
    };

    stdin.on('data', onData);
  });
}
