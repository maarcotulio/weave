import type { WritingActivity, WritingStats } from '../domain/types';

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function activityLevel(words: number, maximum: number): number {
  if (words <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((words / maximum) * 4)));
}

export function WritingHeatmap({ activity, days = 365 }: { activity: WritingActivity[]; days?: number }) {
  const today = new Date();
  const count = Math.max(7, Math.trunc(days));
  const columns = Math.ceil(count / 7);
  const mondayOffset = (today.getDay() + 6) % 7;
  const entries = Array.from({ length: columns * 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset - ((columns - 1) * 7) + index);
    return { date, key: dateKey(date), words: 0 };
  });
  const wordsByDate = new Map(activity.map((entry) => [entry.date, Math.max(0, entry.words)]));
  entries.forEach((entry) => { entry.words = wordsByDate.get(entry.key) ?? 0; });
  const maximum = Math.max(1, ...entries.map((entry) => entry.words));
  const todayKey = dateKey(today);
  const cells = entries.map((entry) => entry.key > todayKey ? undefined : entry);
  return <section className="heatmap-card" aria-label="Writing activity heatmap">
    <div className="heatmap-heading"><div><p className="eyebrow">WRITING RHYTHM · LAST YEAR</p><h2>Keep the thread going</h2><p>Every mark counts. A fuller map means a steadier writing habit.</p></div><span className="heatmap-total">{entries.filter((entry) => entry.words > 0).length} active days</span></div>
    <div className="heatmap-scroll"><div className="heatmap-weekdays" aria-hidden="true"><span />{['Mon', '', 'Wed', '', 'Fri', '', ''].map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div><div className="heatmap-grid" style={{ gridTemplateColumns: `repeat(${columns}, 14px)`, gridTemplateRows: 'repeat(7, 14px)' }}>{cells.map((entry, index) => entry ? <span key={entry.key} className={`heatmap-cell level-${activityLevel(entry.words, maximum)}`} title={`${dateLabel(entry.date)} · ${entry.words.toLocaleString()} words`} aria-label={`${dateLabel(entry.date)}: ${entry.words.toLocaleString()} words`} /> : <span key={`empty-${index}`} className="heatmap-cell empty" aria-hidden="true" />)}</div></div>
    <div className="heatmap-legend"><span>Less</span><i className="heatmap-cell level-0" /><i className="heatmap-cell level-1" /><i className="heatmap-cell level-2" /><i className="heatmap-cell level-3" /><i className="heatmap-cell level-4" /><span>More</span></div>
  </section>;
}

export function HomePage({ stats, activity, onOpenManuscript, onImportProject, importAvailable, error }: { stats: WritingStats; activity: WritingActivity[]; onOpenManuscript: () => void; onImportProject: () => void; importAvailable: boolean; error?: string }) {
  const progress = stats.dailyTarget > 0 ? Math.min(100, Math.round((stats.dailyWords / stats.dailyTarget) * 100)) : 0;
  return <main id="home-workspace" className="home-page" role="tabpanel" aria-label="Home">
    <header className="home-header"><div><p className="eyebrow">HOME · {stats.date}</p><h1>Welcome back to your story.</h1><p>Build a small, repeatable writing rhythm. Your local progress is here to encourage the next session.</p></div><div className="home-actions"><button type="button" className="primary-button" onClick={onOpenManuscript}>Open manuscript</button><button type="button" className="secondary-button" disabled={!importAvailable} title={importAvailable ? undefined : 'Available in the desktop app only'} onClick={onImportProject}>Import</button></div></header>{error && <div className="inline-error" role="alert">{error}<button type="button" className="retry-button" onClick={onImportProject}>Retry import</button></div>}
    <div className="home-overview"><section className="home-stat-grid" aria-label="Writing overview"><article className="home-progress-card"><span>Today</span><strong>{stats.dailyWords.toLocaleString()} <small>/ {stats.dailyTarget.toLocaleString()} words</small></strong><div className="home-progress" role="progressbar" aria-label="Today's writing progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div></article><article><span>Project total</span><strong>{stats.projectWords.toLocaleString()} <small>words</small></strong></article><article><span>Daily target</span><strong>{stats.dailyTarget.toLocaleString()} <small>words</small></strong></article></section></div>
    <section className="writing-analytics" aria-labelledby="writing-analytics-heading"><div className="writing-analytics-heading"><div><p className="eyebrow">LOCAL WRITING ANALYTICS</p><h2 id="writing-analytics-heading">Your writing rhythm</h2><p>Sessions are active local calendar days with a positive manuscript-word delta.</p></div></div><div className="writing-analytics-grid"><article><span>Sessions</span><strong>{stats.sessions.toLocaleString()}</strong><small>{stats.sessions === 0 ? 'No writing sessions yet.' : 'active writing days'}</small></article><article><span>Current streak</span><strong>{stats.currentStreak.toLocaleString()} <small>days</small></strong><small>{stats.currentStreak === 0 ? 'Write today to start a streak.' : 'consecutive active days'}</small></article><article><span>Longest streak</span><strong>{stats.longestStreak.toLocaleString()} <small>days</small></strong><small>best consecutive run</small></article><article><span>Daily pace</span><strong>{stats.averageWordsPerDay.toLocaleString()} <small>words</small></strong><small>average on active days</small></article></div></section>
    <WritingHeatmap activity={activity} />
  </main>;
}
