const OPENER = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Fenced code blocks from Markdown, as the exact source the user wants to paste: no fence lines,
 * no fence indentation and no trailing newline. An unclosed final fence runs to the end.
 * @param {string} markdown
 * @returns {{ language: string, code: string }[]}
 */
export function codeBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index++) {
    const opener = OPENER.exec(lines[index]);
    if (!opener || (opener[2][0] === '`' && opener[3].includes('`'))) continue;
    const [, indent, fence, info] = opener;
    const closing = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
    let end = index + 1;
    while (end < lines.length && !closing.test(lines[end])) end++;
    const code = lines.slice(index + 1, end)
      .map(line => line.startsWith(indent) ? line.slice(indent.length) : line.replace(/^ +/, ''))
      .join('\n');
    blocks.push({ language: info.trim().split(/\s+/)[0] ?? '', code });
    index = end;
  }
  return blocks;
}

function assistantText(entry) {
  const message = entry?.type === 'message' ? entry.message : undefined;
  if (message?.role !== 'assistant' || !Array.isArray(message.content)) return '';
  return message.content.filter(part => part?.type === 'text').map(part => part.text ?? '').join('\n');
}

/** The Nth most recent code block (1 = latest) across assistant messages on the current branch. */
export function pickCodeBlock(entries, position) {
  const blocks = entries.flatMap(entry => codeBlocks(assistantText(entry)));
  return blocks[blocks.length - position];
}
