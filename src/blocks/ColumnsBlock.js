import EditorJS from "@editorjs/editorjs";
import Paragraph from "@editorjs/paragraph";
import Header from "@editorjs/header";
import ImageTool from "@editorjs/image";
import List from "@editorjs/list";
import Quote from "@editorjs/quote";

export class ColumnsBlock {
  constructor({ data, api, config }) {
    this.api = api;
    this.data = {
      columnsCount: data.columnsCount || 2,
      items: data.items || [],
    };
    this.readOnly = api.readOnly;
    this.columnEditors = [];
    this.wrapper = null;
  }

  static get toolbox() {
    return {
      title: "Columns",
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>`,
    };
  }

  render() {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "columns-container";

    const initialItems =
      this.data.items.length > 0
        ? this.data.items
        : Array.from({ length: this.data.columnsCount }, () => ({
            blocks: [],
          }));

    initialItems.forEach((colData, index) =>
      this._createColumn(colData, index),
    );

    if (!this.readOnly) this._renderControls();
    return this.wrapper;
  }

  _getNestedToolsConfig() {
    return {
      paragraph: { class: Paragraph, inlineToolbar: true },
      header: {
        class: Header,
        config: { levels: [2, 3, 4, 5, 6], defaultLevel: 2 },
      },
      image: {
        class: ImageTool,
        inlineToolbar: true,
        config: {
          uploader: {
            async uploadByFile(file) {
              try {
                const base64 = await new Promise((res, rej) => {
                  const r = new FileReader();
                  r.onload = () => res(r.result);
                  r.onerror = rej;
                  r.readAsDataURL(file);
                });
                const id = `col-img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                if (!window.pendingUploads) window.pendingUploads = new Map();
                window.pendingUploads.set(id, file);
                return { success: 1, file: { url: base64, id, pending: true } };
              } catch (e) {
                return { success: 0, error: e.message };
              }
            },
            async uploadByUrl(url) {
              return url
                ? { success: 1, file: { url, pending: false } }
                : { success: 0 };
            },
          },
        },
      },
      list: { class: List, inlineToolbar: true },
      quote: { class: Quote, inlineToolbar: true },
    };
  }

  _createColumn(colData, index) {
    const colWrapper = document.createElement("div");
    colWrapper.className = "column-wrapper";

    // ✅ REMOVED stopPropagation listeners.
    // They were breaking Editor.js's native document click handlers (popover close, focus management).

    const holder = document.createElement("div");
    holder.id = `column-editor-${Date.now()}-${index}`;
    holder.className = "column-editor-holder";
    holder.tabIndex = 0; // Ensures proper focus traversal without event hijacking
    colWrapper.appendChild(holder);
    this.wrapper.appendChild(colWrapper);

    // ✅ Set hideToolbar: false so Editor.js renders its native toolbar block properly
    const editor = new EditorJS({
      holder: holder.id,
      tools: this._getNestedToolsConfig(),
      data: { time: Date.now(), blocks: colData.blocks || [] },
      readOnly: false,
      minHeight: 60,
      hideToolbar: false, // Native toolbar block renders correctly now
      placeholder: "Type or press / to add a block...",
    });

    this.columnEditors.push(editor);
  }

  _renderControls() {
    const controls = document.createElement("div");
    controls.className = "columns-controls";
    controls.addEventListener("click", (e) => e.stopPropagation());

    const addBtn = document.createElement("button");
    addBtn.innerHTML = "+ Add Column";
    addBtn.className = "cdx-button";
    addBtn.addEventListener("click", () => {
      if (this.columnEditors.length < 4) {
        this._createColumn({ blocks: [] }, this.columnEditors.length);
        this.wrapper.insertBefore(controls, this.wrapper.lastChild);
      }
    });

    const removeBtn = document.createElement("button");
    removeBtn.innerHTML = "- Remove";
    removeBtn.className = "cdx-button";
    removeBtn.addEventListener("click", () => {
      if (this.columnEditors.length > 1) {
        const editor = this.columnEditors.pop();
        editor.destroy();
        this.wrapper.removeChild(
          this.wrapper.children[this.wrapper.children.length - 2],
        );
      }
    });

    controls.appendChild(addBtn);
    controls.appendChild(removeBtn);
    this.wrapper.appendChild(controls);
  }

  async save() {
    const items = [];
    for (const editor of this.columnEditors) {
      try {
        if (!editor.blocks || editor.configuration.readOnly) {
          items.push({ blocks: [] });
          continue;
        }
        const saved = await editor.save();
        const validBlocks = (saved.blocks || [])
          .filter((b) => b && b.type && typeof b.data === "object")
          .map((b) => ({
            type: b.type,
            data: b.data || {},
            tunes: b.tunes || {},
          }));
        items.push({ blocks: validBlocks });
      } catch (e) {
        console.warn("Column save skipped:", e);
        items.push({ blocks: [] });
      }
    }
    return { columnsCount: this.columnEditors.length, items };
  }

  validate() {
    return true;
  }

  destroy() {
    this.columnEditors.forEach((editor) => editor.destroy());
    this.columnEditors = [];
    if (this.wrapper && this.wrapper.parentNode) {
      this.wrapper.parentNode.removeChild(this.wrapper);
    }
  }
}
