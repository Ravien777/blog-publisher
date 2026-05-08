/**
 * src/blocks/AccordionBlock.js
 * Editor.js block for creating accordion-style Q&A pairs.
 * Uses semantic <details>/<summary> elements for accessibility.
 */
export class AccordionBlock {
  static get toolbox() {
    return {
      title: "Accordion",
      icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`,
    };
  }

  constructor({ data, api, readOnly }) {
    this.api = api;
    this.readOnly = readOnly;
    this.maxItems = 10; // Configurable soft limit

    // Initialize data with default empty item if none provided
    this.data = {
      items:
        Array.isArray(data?.items) && data.items.length > 0
          ? data.items.filter((item) => item?.question || item?.answer)
          : [{ question: "", answer: "" }],
    };

    // Ensure we have at least one item
    if (this.data.items.length === 0) {
      this.data.items = [{ question: "", answer: "" }];
    }
  }

  render() {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("cdx-accordion-block");

    // Block toolbar (add/remove buttons)
    if (!this.readOnly) {
      this.blockToolbar = document.createElement("div");
      this.blockToolbar.classList.add("cdx-accordion-toolbar");
      this.blockToolbar.innerHTML = `
        <button type="button" class="cdx-accordion-btn cdx-accordion-add" title="Add Item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          Add Item
        </button>
      `;
      this.wrapper.appendChild(this.blockToolbar);

      // Bind add button
      const addBtn = this.blockToolbar.querySelector(".cdx-accordion-add");
      addBtn.addEventListener("click", () => this.addItem());
    }

    // Items container
    this.itemsContainer = document.createElement("div");
    this.itemsContainer.classList.add("cdx-accordion-items");
    this.wrapper.appendChild(this.itemsContainer);

    // Render all items
    this.data.items.forEach((item, index) => {
      this.renderItem(item, index);
    });

    return this.wrapper;
  }

  renderItem(itemData, index) {
    const itemEl = document.createElement("div");
    itemEl.classList.add("cdx-accordion-item");
    itemEl.dataset.index = index;

    const isReadOnly = this.readOnly;

    itemEl.innerHTML = `
      <div class="cdx-accordion-item-header">
        <span class="cdx-accordion-item-label">Question ${index + 1}</span>
        ${
          !isReadOnly && this.data.items.length > 1
            ? `
          <button type="button" class="cdx-accordion-remove" title="Remove Item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        `
            : ""
        }
      </div>
      <input
        type="text"
        class="cdx-accordion-question"
        placeholder="Enter question..."
        value="${this.escapeHtml(itemData.question || "")}"
        ${isReadOnly ? "readonly" : ""}
      />
      <div class="cdx-accordion-item-label" style="margin-top: 12px;">Answer</div>
      <div
        class="cdx-accordion-answer"
        contenteditable="${!isReadOnly}"
        tabindex="${isReadOnly ? "-1" : "0"}"
      >${itemData.answer || ""}</div>
    `;

    // Bind events for non-read-only mode
    if (!isReadOnly) {
      // Question input
      const questionInput = itemEl.querySelector(".cdx-accordion-question");
      questionInput.addEventListener("input", (e) => {
        this.data.items[index].question = e.target.value;
      });

      // Answer contenteditable
      const answerDiv = itemEl.querySelector(".cdx-accordion-answer");
      answerDiv.addEventListener("input", () => {
        this.data.items[index].answer = answerDiv.innerHTML;
      });

      // Remove button
      const removeBtn = itemEl.querySelector(".cdx-accordion-remove");
      if (removeBtn) {
        removeBtn.addEventListener("click", () => {
          this.removeItem(index);
        });
      }
    }

    this.itemsContainer.appendChild(itemEl);
    return itemEl;
  }

  addItem() {
    if (this.data.items.length >= this.maxItems) {
      this.api.notifier.show({
        message: `Maximum ${this.maxItems} items allowed`,
        style: "warning",
      });
      return;
    }

    // Add new empty item
    this.data.items.push({ question: "", answer: "" });

    // Re-render all items to update labels and remove buttons
    this.itemsContainer.innerHTML = "";
    this.data.items.forEach((item, index) => {
      this.renderItem(item, index);
    });

    // Focus on the new question field
    const newIndex = this.data.items.length - 1;
    const newQuestionInput = this.itemsContainer.children[
      newIndex
    ]?.querySelector(".cdx-accordion-question");
    if (newQuestionInput) {
      newQuestionInput.focus();
    }
  }

  removeItem(index) {
    if (this.data.items.length <= 1) {
      this.api.notifier.show({
        message: "At least one item is required",
        style: "warning",
      });
      return;
    }

    // Remove item from data
    this.data.items.splice(index, 1);

    // Re-render all items
    this.itemsContainer.innerHTML = "";
    this.data.items.forEach((item, idx) => {
      this.renderItem(item, idx);
    });
  }

  save() {
    // Filter out items with empty question or answer
    const validItems = this.data.items.filter((item) => {
      const question = (item.question || "").trim();
      const answer = (item.answer || "").replace(/<[^>]*>/g, "").trim();
      return question && answer;
    });

    return {
      items: validItems.map((item) => ({
        question: item.question.trim(),
        answer: item.answer.trim(),
      })),
    };
  }

  validate(savedData) {
    // Check that at least one valid item exists
    if (!savedData.items || savedData.items.length === 0) {
      return false;
    }

    // Check that all items have non-empty question and answer
    for (const item of savedData.items) {
      if (!item.question || !item.question.trim()) {
        return false;
      }
      if (!item.answer || !item.answer.replace(/<[^>]*>/g, "").trim()) {
        return false;
      }
    }

    return true;
  }

  escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get pasteConfig() {
    return {
      tags: ["details"],
      patterns: {
        accordion: /<details/i,
      },
    };
  }

  /**
   * Handle pasted content
   */
  onPaste(event) {
    const {
      detail: { data: pasteData },
    } = event;

    if (pasteData.tagName === "DETAILS") {
      const details = pasteData.node;
      const summary = details.querySelector("summary");
      const content = details.querySelector(
        ".accordion-content, [class*='accordion']",
      );

      if (summary && content) {
        this.data.items.push({
          question: summary.textContent.trim(),
          answer: content.innerHTML.trim(),
        });

        // Re-render if not first item
        if (this.data.items.length > 1) {
          this.itemsContainer.innerHTML = "";
          this.data.items.forEach((item, index) => {
            this.renderItem(item, index);
          });
        }
      }
    }
  }
}
