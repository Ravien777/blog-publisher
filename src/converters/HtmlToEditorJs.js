/**
 * HtmlToEditorJs.js
 * Converts WordPress rendered HTML into Editor.js compatible JSON structure.
 * Fixed: Preserves spacing around inline elements (links, bold, italics, etc.)
 */
export class HtmlToEditorJs {
  convert(htmlString) {
    if (!htmlString || typeof htmlString !== "string") {
      return {
        time: Date.now(),
        blocks: [],
      };
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

      // Check if we're inside a <pre> or <code> block - preserve spacing there
      const isPreformatted = tempDiv.querySelector("pre, code") !== null;

      let html = tempDiv.innerHTML;

      if (!isPreformatted) {
        // Replace non-breaking spaces and zero-width spaces with regular spaces
        html = html.replace(/\u00A0/g, " ").replace(/\u200B/g, "");
        // Collapse multiple whitespace characters to single space
        html = html.replace(/\s+/g, " ").trim();
      } else {
        // For preformatted text, just trim outer whitespace
        html = html.trim();
      }

      if (html) {
        blocks.push({
          type: "paragraph",
          data: {
            text: html,
          },
        });
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

          // ✅ NEW: Detect custom button wrapper or standalone link
          if (
            (tag === "a" &&
              child.classList.contains("wp-block-custom-button")) ||
            (tag === "div" &&
              child.classList.contains("wp-block-custom-button-wrapper"))
          ) {
            if (inlineBuffer.length > 0) flushInlineBuffer();

            const btn =
              tag === "a"
                ? child
                : child.querySelector("a.wp-block-custom-button");
            if (btn) {
              const style = btn.getAttribute("style") || "";
              const matchColor = style.match(/color:\s*([^;]+)/);
              const matchBg = style.match(/background-color:\s*([^;]+)/);
              const matchRadius = style.match(/border-radius:\s*([^;]+)/);

              blocks.push({
                type: "custom-button",
                data: {
                  text: btn.textContent.trim(),
                  link: btn.href || "#",
                  textColor: matchColor ? matchColor[1].trim() : "#ffffff",
                  bgColor: matchBg ? matchBg[1].trim() : "#007acc",
                  radius: matchRadius ? matchRadius[1].trim() : "4px",
                },
              });
            }
            continue; // Skip further processing for this node
          }

          // ✅ NEW: Detect WordPress Columns Block to prevent collapsing
          if (tag === "div" && child.classList.contains("wp-block-columns")) {
            if (inlineBuffer.length > 0) flushInlineBuffer();

            const columnDivs = Array.from(
              child.querySelectorAll(".wp-block-column"),
            );
            if (columnDivs.length > 0) {
              const items = columnDivs.map((col) => {
                // Recursive parse of inner column HTML
                const innerParser = new HtmlToEditorJs();
                const innerData = innerParser.convert(col.innerHTML);
                return { blocks: innerData.blocks || [] };
              });

              blocks.push({
                type: "columns",
                data: {
                  columnsCount: items.length,
                  items: items,
                },
              });
              continue; // Skip generic div handling
            }
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
          // But clean up non-breaking spaces and zero-width spaces
          let pText = el.innerHTML
            .replace(/\u00A0/g, " ") // Non-breaking space → regular space
            .replace(/\u200B/g, "") // Remove zero-width spaces
            .replace(/\s+/g, " ") // Collapse multiple spaces
            .trim();
          if (pText)
            blocks.push({
              type: "paragraph",
              data: {
                text: pText,
              },
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
              text: el.innerHTML
                .replace(/\u00A0/g, " ") // Non-breaking space → regular space
                .replace(/\u200B/g, "") // Remove zero-width spaces
                .replace(/\s+/g, " ") // Collapse multiple spaces
                .trim(),
              level: parseInt(tag.charAt(1), 10),
            },
          });
          break;

        case "ul":
        case "ol":
          const items = Array.from(el.querySelectorAll("li")).map((li) =>
            li.innerHTML
              .replace(/\u00A0/g, " ") // Non-breaking space → regular space
              .replace(/\u200B/g, "") // Remove zero-width spaces
              .replace(/\s+/g, " ") // Collapse multiple spaces
              .trim(),
          );
          if (items.length > 0) {
            blocks.push({
              type: "list",
              data: {
                style: tag === "ol" ? "ordered" : "unordered",
                items,
              },
            });
          }
          break;

        case "blockquote":
          const quoteText =
            el
              .querySelector("p")
              ?.innerHTML.replace(/\u00A0/g, " ") // Non-breaking space → regular space
              .replace(/\u200B/g, "") // Remove zero-width spaces
              .replace(/\s+/g, " ") // Collapse multiple spaces
              .trim() ||
            el.innerHTML
              .replace(/<cite[^>]*>[\s\S]*?<\/cite>/gi, "")
              .replace(/\u00A0/g, " ") // Non-breaking space → regular space
              .replace(/\u200B/g, "") // Remove zero-width spaces
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
            data: {
              code: code ? code.textContent : el.textContent,
            },
          });
          break;

        case "figure":
          const img = el.querySelector("img");
          if (img?.src) {
            const caption = el.querySelector("figcaption");
            blocks.push({
              type: "image",
              data: {
                file: {
                  url: img.src,
                  id: null,
                },
                caption: caption ? caption.textContent.trim() : "",
                withBorder: false,
                withBackground: false,
                stretched: false,
              },
            });
          }
          break;

        case "hr":
          blocks.push({
            type: "delimiter",
            data: {},
          });
          break;
      }
    };

    // Start recursive extraction
    extractBlocks(doc.body);

    // Fallback: If no blocks found but text exists
    if (blocks.length === 0) {
      const plainText = doc.body.textContent
        .replace(/\u00A0/g, " ") // Non-breaking space → regular space
        .replace(/\u200B/g, "") // Remove zero-width spaces
        .replace(/\s+/g, " ") // Collapse multiple spaces
        .trim();
      if (plainText) {
        blocks.push({
          type: "paragraph",
          data: {
            text: plainText,
          },
        });
      }
    }

    return {
      time: Date.now(),
      blocks,
    };
  }
}
