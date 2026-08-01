import { describe, expect, it } from 'vitest';
import { markdownToHtml } from '../app/MarkdownPageEditor';

describe('Markdown note page editor', () => {
  it('renders headings, paragraphs, lists, and inline Markdown visibly', () => {
    const html = markdownToHtml('# A heading\n\nA paragraph with `code`, **bold**, *italic*, and [a link](https://example.com).\n\n- one\n- two');
    expect(html).toContain('<h1>A heading</h1>');
    expect(html).toContain('<p>A paragraph with <code>code</code>, <strong>bold</strong>, <em>italic</em>, and <a href="https://example.com" target="_blank" rel="noreferrer">a link</a>.</p>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
  });

  it('renders an empty page as an editable empty paragraph', () => {
    expect(markdownToHtml('')).toBe('<p><br></p>');
    expect(markdownToHtml(' \n\n')).toBe('<p><br></p>');
  });

  it('keeps wiki links as source text and does not trust raw HTML', () => {
    const html = markdownToHtml('[[A note]] and [[A note|the label]] <script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(html).toContain('[[A note]] and [[A note|the label]]');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });
});
