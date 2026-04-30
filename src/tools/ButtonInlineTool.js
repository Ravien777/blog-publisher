/**
 * ButtonInlineTool.js
 * Editor.js InlineTool to convert selected text into a CustomButtonBlock.
 */
export class ButtonInlineTool {
  static get isInline() {
    return true;
  }
  static get sanitize() {
    return { a: { href: true, target: true, rel: true } };
  }

  constructor({ config, api }) {
    this.api = api;
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.innerHTML = `<i class="fas fa-hand-pointer"></i>`;
    this.button.title = "Convert to Button";
    this.button.addEventListener("click", () => this._handleSelection());
  }

  render() {
    return this.button;
  }

  async _handleSelection() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // Delete selected content safely
    selection.deleteFromDocument();

    // Insert button block with pre-filled text
    await this.api.blocks.insert(
      "custom-button",
      {
        text: selectedText,
        link: "",
        textColor: "#ffffff",
        bgColor: "#007acc",
        radius: "4px",
      },
      {},
      this.api.blocks.getCurrentBlockIndex() + 1,
    );
  }

  surround(range) {
    /* No-op: we handle via click -> insert block */
  }
  checkState() {
    return false;
  }
}
