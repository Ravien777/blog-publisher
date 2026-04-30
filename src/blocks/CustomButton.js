/**
 * src/blocks/CustomButton.js
 * Custom Editor.js block for fully configurable buttons.
 */
export class CustomButtonBlock {
  static get toolbox() {
    return {
      title: "Button",
      icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h12"/></svg>`,
    };
  }

  constructor({ data, api, readOnly }) {
    this.api = api;
    this.readOnly = readOnly;
    this.data = {
      text: data.text || "Click Here",
      link: data.link || "#",
      textColor: data.textColor || "#ffffff",
      bgColor: data.bgColor || "#007acc",
      radius: data.radius || "4px",
    };
  }

  render() {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("cdx-button-wrapper");

    // Create live preview link
    this.previewBtn = document.createElement("a");
    this.previewBtn.className = "cdx-button-preview";
    this.previewBtn.target = "_blank";
    this.previewBtn.rel = "noopener";
    this.previewBtn.href = this.data.link;
    this.previewBtn.textContent = this.data.text;
    this.previewBtn.style.color = this.data.textColor;
    this.previewBtn.style.backgroundColor = this.data.bgColor;
    this.previewBtn.style.borderRadius = this.data.radius;
    this.previewBtn.style.padding = "10px 20px";
    this.previewBtn.style.display = "inline-block";
    this.previewBtn.style.textDecoration = "none";
    this.previewBtn.style.fontWeight = "600";
    this.previewBtn.style.transition = "all 0.2s";

    this.wrapper.appendChild(this.previewBtn);

    if (!this.readOnly) {
      // Settings panel (only in editor mode)
      this.settings = document.createElement("div");
      this.settings.className = "cdx-button-settings";
      this.settings.innerHTML = `
        <div class="cdx-settings-group"><label>Text</label><input type="text" value="${this.data.text}" data-field="text" placeholder="Button label"></div>
        <div class="cdx-settings-group"><label>URL</label><input type="text" value="${this.data.link}" data-field="link" placeholder="https://..."></div>
        <div class="cdx-settings-group"><label>Text Color</label><input type="color" value="${this.data.textColor}" data-field="textColor"></div>
        <div class="cdx-settings-group"><label>BG Color</label><input type="color" value="${this.data.bgColor}" data-field="bgColor"></div>
        <div class="cdx-settings-group"><label>Radius</label><input type="text" value="${this.data.radius}" data-field="radius" placeholder="4px, 50%, etc."></div>
      `;
      this.wrapper.appendChild(this.settings);

      // Bind live updates
      this.settings.querySelectorAll("input").forEach((input) => {
        input.addEventListener("input", (e) => {
          this.data[e.target.dataset.field] = e.target.value;
          if (e.target.dataset.field === "text")
            this.previewBtn.textContent = e.target.value;
          if (e.target.dataset.field === "link")
            this.previewBtn.href = e.target.value;
          if (e.target.dataset.field === "textColor")
            this.previewBtn.style.color = e.target.value;
          if (e.target.dataset.field === "bgColor")
            this.previewBtn.style.backgroundColor = e.target.value;
          if (e.target.dataset.field === "radius")
            this.previewBtn.style.borderRadius = e.target.value;
        });
      });
    }

    return this.wrapper;
  }

  save() {
    return {
      text: this.data.text,
      link: this.data.link,
      textColor: this.data.textColor,
      bgColor: this.data.bgColor,
      radius: this.data.radius,
    };
  }

  static get isReadOnlySupported() {
    return true;
  }
}
