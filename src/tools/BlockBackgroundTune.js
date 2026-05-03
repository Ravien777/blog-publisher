export class BlockBackgroundTune {
  static get isTune() {
    return true;
  }
  static get sanitize() {
    return { backgroundColor: false };
  }

  constructor({ api, tune = {} }) {
    this.api = api;
    this.tune = tune;
    this.wrapper = null;
  }

  render() {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "block-bg-tune";
    this.wrapper.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:4px 0;";

    const label = document.createElement("label");
    label.textContent = "BG";
    label.style.cssText = "font-size:12px;color:var(--text-secondary);";

    const input = document.createElement("input");
    input.type = "color";
    input.value = this.tune.backgroundColor || "#ffffff";
    input.style.cssText =
      "width:28px;height:28px;border:none;cursor:pointer;background:transparent;";

    const reset = document.createElement("button");
    reset.textContent = "×";
    reset.className = "bg-tune-reset";
    reset.style.cssText =
      "background:var(--danger);color:white;border:none;border-radius:4px;width:24px;height:24px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;";

    input.addEventListener("input", (e) => {
      this.tune.backgroundColor = e.target.value;
      this._applyBackground();
    });
    reset.addEventListener("click", () => {
      this.tune.backgroundColor = "transparent";
      input.value = "#ffffff";
      this._applyBackground();
    });

    this.wrapper.append(label, input, reset);
    // ✅ SAFE: Apply after DOM settles to avoid Editor.js mount conflicts
    setTimeout(() => this._applyBackground(), 0);
    return this.wrapper;
  }

  _applyBackground() {
    try {
      const block = this.api.blocks.getCurrentBlock();
      if (block?.holder) {
        const bg = this.tune.backgroundColor;
        block.holder.style.backgroundColor =
          bg && bg !== "transparent" ? bg : "";
        block.holder.style.padding = bg && bg !== "transparent" ? "12px" : "";
      }
    } catch (e) {
      console.warn("BgTune apply failed:", e);
    }
  }

  save() {
    const bg = this.tune.backgroundColor;
    return bg && bg !== "transparent" ? { backgroundColor: bg } : {};
  }
}
