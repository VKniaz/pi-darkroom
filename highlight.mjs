const HEREDOC = /<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\2[ \t]*(?:#[^\r\n]*)?\r?$/;
const PYTHON = /^(?:uv[ \t]+run[ \t]+)?(?:[^\s<]+\/)?python(?:[23](?:\.\d+)*)?(?:[ \t]+-)?$/;
const NODE = /^(?:[^\s<]+\/)?node(?:js)?(?:[ \t]+--input-type(?:=|[ \t]+)(?:module|commonjs))?(?:[ \t]+-)?$/;

const SHELL = /^(?:[^\s<]+\/)?(?:bash|sh)(?:[ \t]+-s)?$/;
const SSH = /^(?:[^\s<]+\/)?ssh[ \t]/;
const REMOTE_STDIN = /[ \t](['"])(?:bash|sh)[ \t]+-s\1$/;

function scriptLanguage(interpreter) {
  if (PYTHON.test(interpreter)) return 'python';
  if (NODE.test(interpreter)) return 'javascript';
  if (SHELL.test(interpreter) || (SSH.test(interpreter) && REMOTE_STDIN.test(interpreter))) return 'bash';
}

function closingLine(lines, start, delimiter, stripTabs) {
  for (let index = start; index < lines.length; index++) {
    const line = lines[index].replace(/\r$/, '');
    if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) return index;
  }
  return -1;
}

/**
 * @param {string} command
 * @param {(code: string, language: string) => readonly string[]} highlight
 * @param {number} [depth]
 * @returns {readonly string[]}
 */
export function highlightCommand(command, highlight, depth = 0) {
  const shell = highlight(command, 'bash');
  if (depth >= 4) return shell;
  const rendered = [...shell];
  const lines = command.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (/^[ \t]*#/.test(lines[index])) continue;
    const opener = HEREDOC.exec(lines[index]);
    if (!opener) continue;
    const interpreter = lines[index].slice(0, opener.index).trim();
    if (interpreter.includes('<')) return shell;
    const end = closingLine(lines, index + 1, opener[3], opener[1] === '-');
    if (end < 0) break;
    const language = scriptLanguage(interpreter);
    if (language && end > index + 1) {
      const source = lines.slice(index + 1, end).join('\n');
      const body = language === 'bash' ? highlightCommand(source, highlight, depth + 1) : highlight(source, language);
      for (let offset = 0; offset < body.length; offset++) rendered[index + 1 + offset] = body[offset];
    }
    index = end;
  }
  return rendered;
}
