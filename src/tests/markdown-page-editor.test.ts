import { describe, expect, it } from 'vitest';
import { markdownToHtml } from '../app/MarkdownPageEditor';

describe('Markdown note page editor', () => {
  it('renders Markdown blocks as editable rich text', () => {
    const html = markdownToHtml('# A heading\n\n## A subheading\n\n- one\n- two\n\n**bold** and *italic*');
    expect(html).toContain('<h1>A heading</h1>');
    expect(html).toContain('<h2>A subheading</h2>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('keeps note links as text and does not trust raw HTML', () => {
    const html = markdownToHtml('[[A note]] <script>alert(1)</script>');
    expect(html).toContain('[[A note]]');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});
