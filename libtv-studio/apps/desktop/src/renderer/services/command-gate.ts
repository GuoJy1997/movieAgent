/** An ambiguous transport response is not permission to create another operation. */
export class CommandGate {
  pending: {
    commandId: string;
    libraryId: string;
    connectionEpoch: string;
    kind: string;
    payload: unknown;
    schemaVersion: number;
  } | null = null;
  ambiguous = false;
  begin(command: NonNullable<CommandGate['pending']>) {
    if (this.pending) throw new Error('仍有待确认操作，请先查询原回执。');
    this.pending = structuredClone(command);
    this.ambiguous = false;
  }
  uncertain() {
    this.ambiguous = true;
  }
  resolve(receipt: { commandId: string; libraryId: string } | null) {
    if (
      !receipt ||
      receipt.commandId !== this.pending?.commandId ||
      receipt.libraryId !== this.pending.libraryId
    )
      return false;
    this.finish();
    return true;
  }
  finish() {
    this.pending = null;
    this.ambiguous = false;
  }
}
