export class NoticesCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoticesCursorError";
  }
}
