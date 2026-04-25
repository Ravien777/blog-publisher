/**
 * HtmlToEditorJs.js
 * Converts WordPress rendered HTML into Editor.js compatible JSON structure.
 * Handles common blocks with graceful fallback and strict sanitization.
 */
export class HtmlToEditorJs {
  convert(htmlString) {
    if (!htmlString || typeof htmlString !== "string") {
      return { time: Date.now(), blocks: [] };
    }

    // Strip dangerous tags/attributes before parsing
    const sanitized = htmlString
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/\son\w+="[^"]*"/gi, "")
      .replace(/\son\w+='[^']*'/gi, "");

    const doc = new DOMParser().parseFromString(sanitized, "text/html");
    const blocks = [];

    const processElement = (element) => {
      if (!element) return;
      const tag = element.tagName.toLowerCase();

      switch (tag) {
        case "p":
          blocks.push({
            type: "paragraph",
            data: { text: this.extractInlineHtml(element) },
          });
          break;

        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6":
          blocks.push({
            type: "header",
            data: {
              text: this.extractInlineHtml(element),
              level: parseInt(tag.charAt(1), 10),
            },
          });
          break;

        case "ul":
        case "ol":
          const items = Array.from(element.children)
            .filter((li) => li.tagName.toLowerCase() === "li")
            .map((li) => this.extractInlineHtml(li));
          blocks.push({
            type: "list",
            data: { style: tag === "ol" ? "ordered" : "unordered", items },
          });
          break;

        case "blockquote":
          const cite = element.querySelector("cite");
          const textNodes = Array.from(element.childNodes)
            .filter(
              (n) =>
                n.nodeType === Node.TEXT_NODE ||
                (n.nodeType === Node.ELEMENT_NODE &&
                  n.tagName.toLowerCase() !== "cite"),
            )
            .map((n) =>
              n.nodeType === Node.TEXT_NODE ? n.textContent : n.innerHTML,
            )
            .join("")
            .trim();
          blocks.push({
            type: "quote",
            data: {
              text: textNodes,
              caption: cite ? cite.textContent.trim() : "",
            },
          });
          break;

        case "pre":
          const codeEl = element.querySelector("code");
          blocks.push({
            type: "code",
            data: { code: codeEl ? codeEl.textContent : element.textContent },
          });
          break;

        case "figure":
          const img = element.querySelector("img");
          if (img) {
            const figcaption = element.querySelector("figcaption");
            blocks.push({
              type: "image",
              data: {
                file: { url: img.src, id: null },
                caption: figcaption ? figcaption.textContent.trim() : "",
                withBorder: false,
                withBackground: false,
                stretched: false,
              },
            });
          }
          break;

        case "hr":
          blocks.push({ type: "delimiter", data: {} });
          break;

        case "div":
          if (
            element.classList.contains("wp-block-embed") ||
            element.querySelector("iframe")
          ) {
            const iframe = element.querySelector("iframe");
            if (iframe) {
              blocks.push({
                type: "embed",
                data: {
                  service: "other",
                  source: iframe.src,
                  embed: iframe.src,
                  width: 560,
                  height: 315,
                },
              });
            }
          } else {
            blocks.push({
              type: "paragraph",
              data: { text: this.extractInlineHtml(element) },
            });
          }
          break;

        default:
          // Fallback: treat unknown block elements as paragraphs
          if (element.textContent.trim()) {
            blocks.push({
              type: "paragraph",
              data: { text: this.extractInlineHtml(element) },
            });
          }
      }
    };

    Array.from(doc.body.children).forEach(processElement);
    return { time: Date.now(), blocks };
  }

  /**
   * Extract inner HTML while preserving Editor.js-compatible inline tags
   * @param {HTMLElement} element
   * @returns {string}
   */
  extractInlineHtml(element) {
    let html = element.innerHTML;
    // Remove scripts/styles just in case
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");
    return html.trim();
  }
}
