/** jsdom has no showModal/close: open toggles the attribute and close fires the close event. */
export function stubDialog(): void {
  const proto = HTMLDialogElement.prototype;
  if (typeof proto.showModal === "function") return;
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
