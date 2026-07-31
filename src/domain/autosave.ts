export type AutosaveState = 'saved' | 'dirty' | 'saving' | 'error';

export interface AutosaveStatus {
  state: AutosaveState;
  message: string;
}

export interface AutosaveOptions {
  delayMs?: number;
  onStatus?: (status: AutosaveStatus) => void;
}

/** Debounces durable saves while keeping failed edits pending for retry. */
export class AutosaveController {
  private readonly save: () => Promise<void>;
  private readonly delayMs: number;
  private readonly onStatus?: (status: AutosaveStatus) => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private pending = false;
  private status: AutosaveStatus = { state: 'saved', message: 'All changes saved' };

  constructor(save: () => Promise<void>, options: AutosaveOptions = {}) {
    this.save = save;
    this.delayMs = options.delayMs ?? 700;
    this.onStatus = options.onStatus;
  }

  getStatus(): AutosaveStatus { return this.status; }

  markDirty(): void {
    this.pending = true;
    this.setStatus({ state: 'dirty', message: 'Unsaved changes' });
    this.schedule();
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.inFlight) await this.inFlight;
    while (this.pending) {
      this.pending = false;
      this.setStatus({ state: 'saving', message: 'Saving…' });
      const operation = this.save();
      this.inFlight = operation;
      try {
        await operation;
        this.inFlight = undefined;
        if (this.pending) continue;
        this.setStatus({ state: 'saved', message: 'All changes saved' });
      } catch (error) {
        this.inFlight = undefined;
        this.pending = true;
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus({ state: 'error', message: `Save failed: ${message}` });
        throw error;
      }
    }
  }

  /** Retry a failed save without discarding the editor's dirty value. */
  retry(): Promise<void> { return this.flush(); }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch(() => undefined);
    }, this.delayMs);
  }

  private setStatus(status: AutosaveStatus): void {
    this.status = status;
    this.onStatus?.(status);
  }
}
