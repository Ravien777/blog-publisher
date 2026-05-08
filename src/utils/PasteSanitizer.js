/**
 * PasteSanitizer.js
 * Cleans pasted HTML from Word, LibreOffice, ChatGPT, and other external editors.
 * Removes unwanted whitespace, invisible characters, and Office-specific markup.
 */

/**
 * Clean pasted HTML by removing unwanted characters and formatting artifacts
 * @param {string} htmlString - Raw HTML from clipboard
 * @returns {string} - Cleaned HTML
 */
export function cleanPastedHTML(htmlString) {
  if (!htmlString || typeof htmlString !== "string") {
    return "";
  }

  // Use DOMParser for safe manipulation (never regex on raw HTML)
  const doc = new DOMParser().parseFromString(htmlString, "text/html");

  // Step 1: Replace non-breaking spaces and zero-width spaces with regular spaces
  replaceInTextNodes(doc.body, /[\u00A0\u200B\u200C\u200D]/g, " ");

  // Step 2: Remove Word-specific <o:p> tags (Office namespace clutter)
  const officeParagraphs = doc.body.querySelectorAll("o\\:p, p");
  officeParagraphs.forEach((p) => {
    if (
      p.tagName.toLowerCase() === "o:p" ||
      p.getAttribute("class")?.includes("MsoNormal")
    ) {
      // Unwrap o:p tags but keep content
      const parent = p.parentNode;
      while (p.firstChild) {
        parent.insertBefore(p.firstChild, p);
      }
      p.remove();
    }
  });

  // Step 3: Remove empty paragraphs that contain only <br> or &nbsp;
  const paragraphs = doc.body.querySelectorAll("p");
  paragraphs.forEach((p) => {
    const trimmedContent = p.textContent.trim();
    const hasOnlyWhitespace =
      !trimmedContent || /^[\s\u00A0]*$/.test(trimmedContent);
    const hasOnlyBreaks = Array.from(p.childNodes).every(
      (node) =>
        (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) ||
        node.nodeName === "BR",
    );

    if (hasOnlyWhitespace && hasOnlyBreaks) {
      p.remove();
    }
  });

  // Step 4: Trim leading/trailing whitespace from every block element
  // but preserve content inside <pre> and <code> tags
  const blockElements = doc.body.querySelectorAll(
    "p, h1, h2, h3, h4, h5, h6, li, td, th, div, section, article, header, footer, blockquote",
  );

  blockElements.forEach((el) => {
    // Skip preformatted text
    if (el.closest("pre, code")) {
      return;
    }

    // Trim text nodes at the start and end
    trimElementWhitespace(el);
  });

  // Step 5: Collapse multiple consecutive spaces into single space
  // (except inside <pre> or <code>)
  collapseMultipleSpaces(doc.body);

  // Step 6: Remove class/style attributes from Word/LibreOffice specific classes
  const allElements = doc.body.querySelectorAll("*");
  allElements.forEach((el) => {
    const className = el.getAttribute("class") || "";

    // Remove Office-specific classes
    if (/Mso|msocomment|FootnoteText|EndnoteText/i.test(className)) {
      el.removeAttribute("class");
    }

    // Remove style attributes that are purely presentational from Office
    const style = el.getAttribute("style") || "";
    if (/mso-|tab-stops:|margin-left:.*pt/i.test(style)) {
      el.removeAttribute("style");
    }
  });

  return doc.body.innerHTML;
}

/**
 * Replace matching patterns in all text nodes within an element
 * @param {Element} element - Root element to search
 * @param {RegExp} pattern - Regex pattern to match
 * @param {string} replacement - Replacement string
 */
function replaceInTextNodes(element, pattern, replacement) {
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false,
  );

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  textNodes.forEach((textNode) => {
    if (pattern.test(textNode.nodeValue)) {
      textNode.nodeValue = textNode.nodeValue.replace(pattern, replacement);
    }
  });
}

/**
 * Trim leading and trailing whitespace from an element's direct text nodes
 * @param {Element} el - Element to trim
 */
function trimElementWhitespace(el) {
  const childNodes = Array.from(el.childNodes);

  // Trim leading whitespace
  for (let i = 0; i < childNodes.length; i++) {
    const node = childNodes[i];
    if (node.nodeType === Node.TEXT_NODE) {
      const trimmed = node.textContent.replace(/^[\s\u00A0]+/, "");
      if (trimmed !== node.textContent) {
        node.textContent = trimmed;
      }
      if (trimmed) break; // Stop if there's actual content
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      break; // Stop at first element
    }
  }

  // Trim trailing whitespace
  for (let i = childNodes.length - 1; i >= 0; i--) {
    const node = childNodes[i];
    if (node.nodeType === Node.TEXT_NODE) {
      const trimmed = node.textContent.replace(/[\s\u00A0]+$/, "");
      if (trimmed !== node.textContent) {
        node.textContent = trimmed;
      }
      if (trimmed) break; // Stop if there's actual content
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      break; // Stop at first element
    }
  }
}

/**
 * Collapse multiple consecutive spaces into a single space
 * Skips content inside <pre> and <code> tags
 * @param {Element} element - Root element to process
 */
function collapseMultipleSpaces(element) {
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false,
  );

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    // Skip text nodes inside pre/code
    if (!node.parentElement.closest("pre, code")) {
      textNodes.push(node);
    }
  }

  textNodes.forEach((textNode) => {
    // Replace multiple spaces/tabs/newlines with single space
    const cleaned = textNode.nodeValue.replace(/[\s\u00A0]+/g, " ");
    if (cleaned !== textNode.nodeValue) {
      textNode.nodeValue = cleaned;
    }
  });
}
