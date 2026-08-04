export interface MarkdownImportActionProps {
  busy: boolean;
  run: (operation: () => Promise<void>) => Promise<void>;
  flushDocument: () => Promise<void>;
  flushMarkdownNote: () => Promise<boolean>;
  onOpen: () => void;
}

/** Shared project action; its flushing only runs after the user opens import. */
export function MarkdownImportAction({ busy, run, flushDocument, flushMarkdownNote, onOpen }: MarkdownImportActionProps) {
  const open = () => run(async () => {
    await flushDocument();
    if (!await flushMarkdownNote()) return;
    onOpen();
  });
  return <button type="button" onClick={open} disabled={busy}>Import</button>;
}
