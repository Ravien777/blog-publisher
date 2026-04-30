/**
 * CustomButtonBlock.js
 * Editor.js Block Tool for configurable buttons.
 */
export class CustomButtonBlock {
  static get toolbox() {
    return {
      title: "Button",
      icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h12"/></svg>`,
    };
  }

  constructor({ data, config, api, readOnly }) {
    this.api = api;
    this.readOnly = readOnly;
    this.data = {
      text: data.text || "",
      link: data.link || "",
      textColor: data.textColor || "#ffffff",
      bgColor: data.bgColor || "#007acc",
      radius: data.radius || "4px",
    };
    this.settings = [
      {
        label: "Button Text",
        type: "text",
        key: "text",
        placeholder: "Click here",
      },
      {
        label: "Destination URL",
        type: "url",
        key: "link",
        placeholder: "https://example.com",
      },
      {
        label: "Text Color",
        type: "color",
        key: "textColor",
        default: "#ffffff",
      },
      {
        label: "Background Color",
        type: "color",
        key: "bgColor",
        default: "#007acc",
      },
      {
        label: "Border Radius",
        type: "text",
        key: "radius",
        placeholder: "4px, 50%, etc.",
        default: "4px",
      },
    ];
  }

  render() {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("cdx-button-wrapper");

    // Live preview button
    this.previewBtn = document.createElement("a");
    this.previewBtn.className = "cdx-button-preview";
    this.previewBtn.target = "_blank";
    this.previewBtn.rel = "noopener noreferrer";
    this._applyStyles();
    this.wrapper.appendChild(this.previewBtn);

    // Settings panel
    this.settingsContainer = document.createElement("div");
    this.settingsContainer.className = "cdx-button-settings";
    this.settings.forEach(({ label, type, key, placeholder, default: def }) => {
      const group = document.createElement("div");
      group.className = "cdx-settings-group";
      const labelEl = document.createElement("label");
      labelEl.textContent = label;
      const input = document.createElement("input");
      input.type = type;
      input.placeholder = placeholder || def || "";
      input.value = this.data[key] || def || "";
      input.dataset.key = key;
      input.addEventListener("input", (e) => {
        this.data[key] = e.target.value;
        this._applyStyles();
      });
      group.append(labelEl, input);
      this.settingsContainer.appendChild(group);
    });
    this.wrapper.appendChild(this.settingsContainer);
    return this.wrapper;
  }

  _applyStyles() {
    const { text, link, textColor, bgColor, radius } = this.data;
    this.previewBtn.textContent = text || "Button Text";
    this.previewBtn.href = link || "#";
    this.previewBtn.style.color = this._validateHex(textColor)
      ? textColor
      : "#ffffff";
    this.previewBtn.style.backgroundColor = this._validateHex(bgColor)
      ? bgColor
      : "#007acc";
    this.previewBtn.style.borderRadius = this._validateRadius(radius)
      ? radius
      : "4px";
  }

  _validateHex(hex) {
    return /^#([0-9A-F]{3}){1,2}$/i.test(hex);
  }

  _validateRadius(val) {
    return /^[\d]+(px|%|em|rem|vw|vh)?$/.test(val.trim());
  }

  save(blockContent) {
    return {
      text: this.data.text.trim(),
      link: this.data.link.trim(),
      textColor: this.data.textColor,
      bgColor: this.data.bgColor,
      radius: this.data.radius,
    };
  }

  validate(savedData) {
    if (!savedData.text.trim()) return false;
    if (!savedData.link.trim()) return false;
    return true;
  }

  static get isReadOnlySupported() {
    return true;
  }
}
