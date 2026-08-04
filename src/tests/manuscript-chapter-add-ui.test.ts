import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Manuscript header chapter control', () => {
  it('creates the next chapter in the selected story rather than a project', () => {
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    expect(app).toContain("const addChapter = () => void run(async () => { if (!selectedStoryId) return; const chapterNumber = (snapshot?.chapters.filter((item) => item.storyId === selectedStoryId).length ?? 0) + 1; await repository.createChapter(selectedStoryId, `Chapter ${chapterNumber}`); await refresh(false); });");
    expect(app).toContain('<button type="button" onClick={addChapter} disabled={!selectedStoryId} aria-label={selectedStoryId ? \'New chapter\' : \'New chapter (select a story first)\'} title={selectedStoryId ? \'New chapter\' : \'Select a story first to create a chapter\'}>+</button>');
    expect(app).not.toContain('<button type="button" onClick={createProject} aria-label="New project">+</button>');
  });

  it('keeps the empty-state instruction and explicit New story path accessible', () => {
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    expect(app).toContain("disabled={!selectedStoryId}");
    expect(app).toContain("New chapter (select a story first)");
    expect(app).toContain("Select a story first to create a chapter");
    expect(app).toContain('<button type="button" className="add-story" onClick={newStory}>+ New story</button>');
  });
});
