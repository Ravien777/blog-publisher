/**
 * HtmlToEditorJs.js
 * Converts WordPress rendered HTML into Editor.js compatible JSON structure.
 * Fixed: Preserves spacing around inline elements (links, bold, italics, etc.)
 */
export class HtmlToEditorJs {
  convert(htmlString) {
    if (!htmlString || typeof htmlString !== "string") {
      return { time: Date.now(), blocks: [] };
    }

    // 1. Sanitize dangerous tags
    const sanitized = htmlString
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/\son\w+=["'][^"']*["']/gi, "")
      .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "");

    const doc = new DOMParser().parseFromString(sanitized, "text/html");
    const blocks = [];
    let inlineBuffer = [];

    // Flush buffered inline content as a single paragraph block
    const flushInlineBuffer = () => {
      if (inlineBuffer.length === 0) return;
      const tempDiv = document.createElement("div");
      inlineBuffer.forEach((node) => tempDiv.appendChild(node));

      // Preserve internal spacing, collapse indentation/newlines to single spaces
      let html = tempDiv.innerHTML.replace(/\s+/g, " ").trim();

      if (html) {
        blocks.push({ type: "paragraph", data: { text: html } });
      }
      inlineBuffer = [];
    };

    const extractBlocks = (element) => {
      const children = Array.from(element.childNodes);

      for (const child of children) {
        if (child.nodeType === Node.TEXT_NODE) {
          // Skip pure whitespace/indentation nodes, but keep nodes with visible text + spacing
          if (child.textContent.trim().length > 0) {
            inlineBuffer.push(document.createTextNode(child.textContent));
          }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName.toLowerCase();

          // ✅ NEW: Handle WordPress Columns HTML structure
          if (tag === "div" && child.classList.contains("wp-block-columns")) {
            const columnsBlock = {
              type: "columns",
              data: { columnsCount: child.children.length, items: [] },
            };
            const columnDivs = child.querySelectorAll(
              ":scope > .wp-block-column",
            );
            columnDivs.forEach((colDiv) => {
              const subConverter = new HtmlToEditorJs();
              const colBlocks = subConverter.convert(colDiv.innerHTML).blocks;
              columnsBlock.data.items.push({ blocks: colBlocks });
            });
            blocks.push(columnsBlock);
            continue; // Skip normal processing for this div
          }

          const isBlock = [
            "p",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "ul",
            "ol",
            "blockquote",
            "pre",
            "figure",
            "hr",
            "div",
            "section",
            "article",
            "header",
            "footer",
            "main",
            "nav",
          ].includes(tag);

          // Flush inline buffer before processing a new block element
          if (inlineBuffer.length > 0 && isBlock) {
            flushInlineBuffer();
          }

          if (isBlock) {
            if (
              [
                "div",
                "section",
                "article",
                "header",
                "footer",
                "main",
                "nav",
              ].includes(tag)
            ) {
              extractBlocks(child);
            } else {
              processBlockElement(child, tag);
            }
          } else {
            // Inline element (a, strong, em, span, etc.) -> preserve exactly
            inlineBuffer.push(child.cloneNode(true));
          }
        }
      }
      flushInlineBuffer();
    };

    const processBlockElement = (el, tag) => {
      switch (tag) {
        case "p":
          // Direct innerHTML preserves exact inline spacing/formatting
          const pText = el.innerHTML.replace(/\s+/g, " ").trim();
          if (pText) blocks.push({ type: "paragraph", data: { text: pText } });
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
              text: el.innerHTML.replace(/\s+/g, " ").trim(),
              level: parseInt(tag.charAt(1), 10),
            },
          });
          break;

        case "ul":
        case "ol":
          const items = Array.from(el.querySelectorAll("li")).map((li) =>
            li.innerHTML.replace(/\s+/g, " ").trim(),
          );
          if (items.length > 0) {
            blocks.push({
              type: "list",
              data: { style: tag === "ol" ? "ordered" : "unordered", items },
            });
          }
          break;

        case "blockquote":
          const quoteText =
            el.querySelector("p")?.innerHTML.replace(/\s+/g, " ").trim() ||
            el.innerHTML
              .replace(/<cite[^>]*>[\s\S]*?<\/cite>/gi, "")
              .replace(/\s+/g, " ")
              .trim();
          const cite = el.querySelector("cite");
          blocks.push({
            type: "quote",
            data: {
              text: quoteText,
              caption: cite ? cite.textContent.trim() : "",
            },
          });
          break;

        case "pre":
          const code = el.querySelector("code");
          blocks.push({
            type: "code",
            data: { code: code ? code.textContent : el.textContent },
          });
          break;

        case "figure":
          const img = el.querySelector("img");
          if (img?.src) {
            const caption = el.querySelector("figcaption");
            blocks.push({
              type: "image",
              data: {
                file: { url: img.src, id: null },
                caption: caption ? caption.textContent.trim() : "",
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
      }
    };

    // Start recursive extraction
    extractBlocks(doc.body);

    // Fallback: If no blocks found but text exists
    if (blocks.length === 0) {
      const plainText = doc.body.textContent.replace(/\s+/g, " ").trim();
      if (plainText) {
        blocks.push({ type: "paragraph", data: { text: plainText } });
      }
    }

    return { time: Date.now(), blocks };
  }
}
