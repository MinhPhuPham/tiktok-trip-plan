const TEXT_FIELD = /^(INPUT|TEXTAREA|SELECT)$/;

/** The node takes typed text: shortcuts (/, Ctrl+Z) leave it alone. */
export const isTypingTarget = (node: EventTarget | null): boolean =>
  node instanceof HTMLElement && (TEXT_FIELD.test(node.tagName) || node.isContentEditable);

/** The nearest ancestor that scrolls vertically (overflow-y auto or scroll), else null. */
export function scrollParent(el: Element): HTMLElement | null {
  for (let box = el.parentElement; box; box = box.parentElement) {
    const { overflowY } = getComputedStyle(box);
    if (overflowY === "auto" || overflowY === "scroll") return box;
  }
  return null;
}
