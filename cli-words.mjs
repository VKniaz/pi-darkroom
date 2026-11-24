import { heredocOpener } from './highlight.mjs';

const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;
const ASSIGNMENT = String.raw`[A-Za-z_]\w*=(?:"(?:\\.|[^"])*"|'[^']*'|[^\s;&|()]*)\s+`;
const COMMAND = String.raw`[A-Za-z_./][A-Za-z0-9_./:+-]*`;
const POSITION = new RegExp(String.raw`(^|&&|\|\||[;|{]|\$\()\s*(?:(?:if|then|do|elif|while|until|!|time)\s+)*(?:${ASSIGNMENT})*(${COMMAND})(?=$|[\s;&|<>)])`, 'g');
const WRAPPED = new RegExp(String.raw`^\s+(?:${ASSIGNMENT})*(${COMMAND})(?=$|[\s;&|<>)])`);
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'builtin']);

function foreground(sequence, current = null) {
  const codes = sequence.slice(2, -1).split(';').map(Number);
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index];
    if (code === 0 || code === 39) current = null;
    else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) current = String(code);
    else if (code === 38 || code === 48) {
      const count = codes[index + 1] === 2 ? 5 : 3;
      if (code === 38) current = codes.slice(index, index + count).join(';');
      index += count - 1;
    }
  }
  return current;
}

function colorKey(ansi) {
  let color = null;
  for (const [sequence] of ansi.matchAll(/\x1b\[[\d;]*m/g)) color = foreground(sequence, color);
  return color;
}

function visibleMap(line) {
  let text = '', offset = 0, color = null;
  const positions = [], colors = [];
  function append(end) {
    while (offset < end) {
      text += line[offset]; positions.push(offset++); colors.push(color);
    }
  }
  for (const match of line.matchAll(ANSI)) {
    append(match.index);
    if (/^\x1b\[[\d;]*m$/.test(match[0])) color = foreground(match[0], color);
    offset = match.index + match[0].length;
  }
  append(line.length);
  return { text, positions, colors };
}

/**
 * @param {readonly string[]} lines
 * @param {{paint: (word: string) => string, ignoredForegrounds: readonly string[]}} options
 * @returns {string[]}
 */
export function tintCliLines(lines, options) {
  const ignored = new Set(options.ignoredForegrounds.map(colorKey).filter(Boolean));
  let continued = false;
  let heredoc;
  return lines.map(line => {
    const mapped = visibleMap(line);
    if (heredoc) {
      const closing = mapped.text.replace(/\r$/, '');
      if ((heredoc.tabs ? closing.replace(/^\t+/, '') : closing) === heredoc.delimiter) heredoc = undefined;
      continued = false;
      return line;
    }
    const opener = /^[ \t]*#/.test(mapped.text) ? null : heredocOpener(mapped.text);
    if (opener) heredoc = { delimiter: opener[3], tabs: opener[1] === '-' };
    const ranges = [];
    POSITION.lastIndex = 0;
    for (let match; (match = POSITION.exec(mapped.text));) {
      if (continued && match[1] === '') continue;
      if (match[1] && ((/\\+$/.exec(mapped.text.slice(0, match.index))?.[0].length ?? 0) % 2 === 1)) continue;
      let word = match[2];
      let start = match.index + match[0].lastIndexOf(word);
      if (mapped.text[start + word.length] === ')' && match[1] !== '$(') continue;
      while (word) {
        const end = start + word.length;
        if (mapped.colors.slice(start, end).some(color => ignored.has(color))) break;
        ranges.push({ start: mapped.positions[start], end: mapped.positions[end - 1] + 1, color: mapped.colors[start] });
        if (!WRAPPERS.has(word.split('/').at(-1))) break;
        const wrapped = WRAPPED.exec(mapped.text.slice(end));
        if (!wrapped) break;
        word = wrapped[1];
        start = end + wrapped[0].lastIndexOf(word);
      }
    }
    const slashes = /\\+$/.exec(mapped.text)?.[0].length ?? 0;
    continued = slashes % 2 === 1 && !ignored.has(mapped.colors.at(-1));
    for (const range of ranges.reverse()) {
      const restore = range.color ? '\x1b[' + range.color + 'm' : '';
      line = line.slice(0, range.start) + options.paint(line.slice(range.start, range.end)) + restore + line.slice(range.end);
    }
    return line;
  });
}
