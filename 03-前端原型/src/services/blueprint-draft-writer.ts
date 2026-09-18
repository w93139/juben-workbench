import type { BlueprintData } from "@/domain/blueprint";
import type { BlueprintDraft } from "@/domain/workbench";

type Write = (draft: BlueprintDraft, expected: number | null) => Promise<BlueprintDraft>;
export type DraftWriteStatus = { pending: boolean; saved: boolean; error: unknown };

/** One editor owns one immutable branch. Coalesce keystrokes; serialize disk writes. */
export class BlueprintDraftWriter {
  private data: BlueprintData | null = null;
  private sequence = 0;
  private savedSequence = 0;
  private record: BlueprintDraft | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flight: Promise<BlueprintDraft> | null = null;
  private sealed = false;
  private error: unknown = null;
  constructor(
    readonly id: string, readonly baseRevision: number, readonly baseBlueprintRevision: number,
    private write: Write, private notify: (status: DraftWriteStatus) => void,
  ) {}
  private report() { this.notify({ pending: this.savedSequence < this.sequence, saved: this.record !== null && this.savedSequence === this.sequence, error: this.error }); }
  change(data: BlueprintData) {
    if (this.sealed) throw new Error("此草稿会话已结束，请重新编辑。");
    this.data = data; this.sequence++; this.error = null; this.report();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush().catch(() => {}); }, 300);
  }
  flush(): Promise<BlueprintDraft> {
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    if (this.flight) return this.flight;
    if (this.sealed || !this.data) return Promise.reject(new Error("当前没有可保存的草稿。"));
    const run = async () => {
      try {
        while (this.savedSequence < this.sequence) {
          const sequence = this.sequence;
          const next = { id: this.id, baseRevision: this.baseRevision, baseBlueprintRevision: this.baseBlueprintRevision, data: this.data!, revision: (this.record?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
          this.record = await this.write(next, this.record?.revision ?? null);
          this.savedSequence = sequence;
        }
        this.error = null; this.report(); return this.record!;
      } catch (failure) { this.error = failure; this.report(); throw failure; }
      finally { this.flight = null; }
    };
    this.flight = Promise.resolve().then(run); return this.flight;
  }
  /** Freeze new edits and drain queued work before a commit or discard. */
  async seal() {
    const pending = this.flush(); this.sealed = true;
    try { return await pending; } catch (failure) { this.sealed = false; throw failure; }
  }
  async abandon() {
    this.sealed = true;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    await this.flight?.catch(() => {});
    return this.record;
  }
  reopen() { this.sealed = false; }
}
