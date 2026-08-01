import { useCallback, useLayoutEffect, useRef } from 'react';

const BLOCK_TAGS = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL']);
const INLINE_TAGS = new Set(['A', 'B', 'BR', 'CODE', 'DEL', 'EM', 'I', 'S', 'SPAN', 'STRONG', 'SUB', 'SUP', 'U']);

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function renderInline(markdown: string): string {
  let html = escapeHtml(markdown);
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  html = html.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  return html;
}

function isSpecialBlockStart(line: string): boolean {
  return /^(#{1,6})[ \t]+/.test(line) || /^```/.test(line) || /^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line) || /^>\s?/.test(line) || /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

/** Render the Markdown source into the editable page surface without trusting source HTML. */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(?:[^`]*)$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})[ \t]+(.*?)\s*$/);
    if (heading) {
      html.push(`<h${heading[1].length}>${renderInline(heading[2]) || '<br>'}</h${heading[1].length}>`);
      index += 1;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      html.push('<hr>');
      index += 1;
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*[-*+]\s+(.*)$/);
        if (!item) break;
        items.push(`<li>${renderInline(item[1]) || '<br>'}</li>`);
        index += 1;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*\d+[.)]\s+(.*)$/);
        if (!item) break;
        items.push(`<li>${renderInline(item[1]) || '<br>'}</li>`);
        index += 1;
      }
      html.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      html.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && (paragraph.length === 0 || !isSpecialBlockStart(lines[index]))) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(`<p>${paragraph.map(renderInline).join('<br>') || '<br>'}</p>`);
  }

  return html.join('') || '<p><br></p>';
}

function inlineToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.replace(/\u00a0/g, ' ') ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node as HTMLElement;
  const content = Array.from(element.childNodes).map(inlineToMarkdown).join('');
  switch (element.tagName) {
    case 'BR': return '\n';
    case 'STRONG':
    case 'B': return `**${content}**`;
    case 'EM':
    case 'I': return `*${content}*`;
    case 'DEL':
    case 'S': return `~~${content}~~`;
    case 'CODE': return `\`${content}\``;
    case 'A': {
      const href = element.getAttribute('href');
      return href ? `[${content}](${href})` : content;
    }
    default: return content;
  }
}

function blockToMarkdown(element: HTMLElement): string {
  const tag = element.tagName;
  if (/^H[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag.slice(1)))} ${inlineToMarkdown(element)}`;
  if (tag === 'UL' || tag === 'OL') {
    const marker = tag === 'UL' ? '-' : '1.';
    return Array.from(element.children).filter((child) => child.tagName === 'LI').map((child) => `${marker} ${inlineToMarkdown(child)}`).join('\n');
  }
  if (tag === 'BLOCKQUOTE') {
    const content = element.children.length > 0
      ? Array.from(element.children).map((child) => blockToMarkdown(child as HTMLElement)).join('\n\n')
      : inlineToMarkdown(element);
    return content.split('\n').map((line) => `> ${line}`).join('\n');
  }
  if (tag === 'PRE') return `\`\`\`\n${element.textContent ?? ''}\n\`\`\``;
  if (tag === 'HR') return '---';
  return inlineToMarkdown(element);
}

/** Convert the browser's safe, editable DOM back to canonical Markdown. */
export function htmlToMarkdown(root: HTMLElement): string {
  const blocks: string[] = [];
  let inlineBuffer = '';
  const flushInline = () => {
    if (inlineBuffer) {
      blocks.push(inlineBuffer);
      inlineBuffer = '';
    }
  };

  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      inlineBuffer += node.textContent?.replace(/\u00a0/g, ' ') ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (BLOCK_TAGS.has(element.tagName)) {
      flushInline();
      blocks.push(blockToMarkdown(element));
    } else if (INLINE_TAGS.has(element.tagName)) {
      inlineBuffer += inlineToMarkdown(element);
    } else {
      inlineBuffer += inlineToMarkdown(element);
    }
  });
  flushInline();

  while (blocks.length && !blocks[blocks.length - 1].trim()) blocks.pop();
  const markdown = blocks.join('\n\n').replace(/\u00a0/g, ' ');
  return markdown.trim() ? markdown : '';
}

function blockAtSelection(root: HTMLElement): HTMLElement | undefined {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return undefined;
  const anchor = selection.anchorNode;
  const element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor?.parentElement;
  const block = element?.closest('p,div,h1,h2,h3,h4,h5,h6,li,blockquote');
  return block instanceof HTMLElement && root.contains(block) ? block : undefined;
}

function selectionTextBeforeCaret(block: HTMLElement): string | undefined {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed || !selection.anchorNode) return undefined;
  const range = document.createRange();
  range.selectNodeContents(block);
  try {
    range.setEnd(selection.anchorNode, selection.anchorOffset);
  } catch {
    return undefined;
  }
  return range.toString().replace(/\u00a0/g, ' ');
}

function placeCaretAtStart(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function applyMarkdownShortcut(root: HTMLElement): boolean {
  const block = blockAtSelection(root);
  if (!block) return false;
  const before = selectionTextBeforeCaret(block);
  if (!before || block.textContent !== before) return false;

  const heading = before.match(/^(#{1,6})$/);
  const unordered = before.match(/^[-*+]$/);
  const ordered = before.match(/^\d+[.)]$/);
  const quote = before === '>';
  if (!heading && !unordered && !ordered && !quote) return false;

  const replacement = heading ? document.createElement(`h${heading[1].length}`) : quote ? document.createElement('blockquote') : unordered || ordered ? document.createElement(unordered ? 'ul' : 'ol') : undefined;
  if (!replacement) return false;
  if (unordered || ordered) replacement.append(document.createElement('li'));
  block.replaceWith(replacement);
  const caretTarget = replacement.tagName === 'UL' || replacement.tagName === 'OL' ? replacement.firstElementChild as HTMLElement : replacement;
  placeCaretAtStart(caretTarget);
  return true;
}

export function MarkdownPageEditor({ markdown, pageIndex, onChange }: { markdown: string; pageIndex: number; onChange: (value: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const emitMarkdown = useCallback(() => {
    const element = editorRef.current;
    if (element) onChange(htmlToMarkdown(element));
  }, [onChange]);

  useLayoutEffect(() => {
    const element = editorRef.current;
    if (!element || htmlToMarkdown(element) === markdown) return;
    element.innerHTML = markdownToHtml(markdown);
  }, [markdown]);

  return <div
    ref={editorRef}
    className="note-page-input note-page-editor"
    contentEditable
    suppressContentEditableWarning
    role="textbox"
    aria-multiline="true"
    aria-label={`Markdown note page ${pageIndex + 1}`}
    spellCheck
    onKeyDown={(event) => {
      if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (applyMarkdownShortcut(event.currentTarget)) {
        event.preventDefault();
        emitMarkdown();
      }
    }}
    onInput={emitMarkdown}
  />;
}
