import EditorJS from "@editorjs/editorjs";

import Header from "@editorjs/header";
import Paragraph from "@editorjs/paragraph";
import ImageTool from "@editorjs/image";
import Embed from "@editorjs/embed";
import List from "@editorjs/list";
import Quote from "@editorjs/quote";
import LinkTool from "@editorjs/link";
import Underline from "@editorjs/underline";
import InlineCode from "@editorjs/inline-code";
import Marker from "@editorjs/marker";
import Delimiter from "@editorjs/delimiter";
import ColorPicker, { ColorPickerWithoutSanitize } from "editorjs-color-picker";

import "./style.css";

import { ColumnsBlock } from "./blocks/ColumnsBlock.js";
import { CustomButtonBlock } from "./blocks/CustomButton.js";
import { ContactFormBlock } from "./blocks/ContactFormBlock.js";
import { AccordionBlock } from "./blocks/AccordionBlock.js";
import { ButtonInlineTool } from "./tools/ButtonInlineTool.js";

import { HtmlToEditorJs } from "./converters/HtmlToEditorJs.js";
import { FormProvider } from "./services/FormProvider.js";
import { PostManager } from "./managers/PostManager.js";
import { PageManager } from "./managers/PageManager.js";
import { LibraryView } from "./components/LibraryView.js";
import { CacheManager, cache } from "./utils/CacheManagers.js";
import { AuthManager } from "./services/AuthManager.js";
import { ImageUploader } from "./services/ImageUploader.js";
import { cleanPastedHTML } from "./utils/PasteSanitizer.js";

// Initialize service singletons
const authManager = new AuthManager();
const imageUploader = new ImageUploader(authManager);

// Track if we're editing an existing post
let editingPostId = null;
let currentEditingType = "post"; // NEW: Tracks if we are editing a post or page
let detectedSeoPlugin = null; // 'yoast', 'rank-math', or null
let hasUnsavedChanges = false; // ✅ NEW: Tracks unsaved editor state

// Security utility functions
const securityUtils = {
  escapeHtml: (text) => {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },
  escapeAttribute: (value) => {
    if (!value) return "";
    // Fixed regex syntax and proper entity encoding
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  },
  sanitizeUrl: (url) => {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return "";
      return parsed.toString();
    } catch {
      return "";
    }
  },

  // NEW: Sanitize HTML but allow safe inline formatting
  sanitizeInlineHtml: (html) => {
    if (!html) return "";

    // Create a temporary div to parse the HTML
    const temp = document.createElement("div");
    temp.innerHTML = html;

    // Define allowed tags and attributes
    const allowedTags = [
      "a",
      "b",
      "i",
      "u",
      "strong",
      "em",
      "code",
      "mark",
      "s",
      "sub",
      "sup",
      "br",
      "span", // ✅ NEW: Allow span for ColorPicker inline styles
    ];
    const allowedAttributes = {
      a: ["href", "target", "rel"],
      b: ["style"],
      i: ["style"],
      u: ["style"],
      strong: ["style"],
      em: ["style"],
      code: ["style"],
      mark: ["style"],
      s: ["style"],
      sub: ["style"],
      sup: ["style"],
      span: ["style"], // ColorPicker uses <span style="color:...">
    };

    // Recursive function to clean nodes
    function cleanNode(node) {
      // If it's a text node, return it as is
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
      }

      // If it's an element node
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();

        // If tag is not allowed, return just the text content
        if (!allowedTags.includes(tagName)) {
          return node.textContent;
        }

        // Build the opening tag
        let result = `<${tagName}`;

        // Add allowed attributes
        if (allowedAttributes[tagName]) {
          for (const attr of allowedAttributes[tagName]) {
            if (node.hasAttribute(attr)) {
              let value = node.getAttribute(attr);

              if (attr === "href") {
                value = securityUtils.sanitizeUrl(value);
                if (!value) continue;
              }

              // ✅ NEW: Sanitize style attribute to only allow color property
              if (attr === "style") {
                // Extract only color-related styles
                const colorMatch = value.match(/color\s*:\s*([^;]+)/i);
                if (colorMatch) {
                  const colorValue = colorMatch[1].trim();
                  // Validate color value
                  if (
                    /^#([0-9A-F]{3}){1,2}$|^rgb(a?)\([^)]+\)$|^hsl(a?)\([^)]+\)$|^[a-z]+$/i.test(
                      colorValue,
                    )
                  ) {
                    value = `color: ${colorValue}`;
                  } else {
                    continue; // Skip invalid
                  }
                } else {
                  continue; // Skip style without color
                }
              }

              result += ` ${attr}="${securityUtils.escapeAttribute(value)}"`;
            }
          }
        }

        result += ">";

        // Process child nodes
        for (const child of node.childNodes) {
          result += cleanNode(child);
        }

        result += `</${tagName}>`;
        return result;
      }

      return "";
    }

    // Process all child nodes
    let result = "";
    for (const child of temp.childNodes) {
      result += cleanNode(child);
    }

    return result;
  },

  isValidBase64Image: (dataUrl) => {
    if (!dataUrl.startsWith("data:image/")) return false;
    const regex =
      /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;
    return regex.test(dataUrl);
  },
};

// Expose cache utilities for debugging (dev only)
if (process.env.NODE_ENV === "development") {
  window.bpCache = {
    clear: () => cache.clear(),
    invalidate: (pattern) => cache.invalidate(pattern),
    stats: () => {
      const keys = Object.keys(localStorage).filter((k) =>
        k.startsWith("blog_publisher_"),
      );
      return {
        count: keys.length,
        keys: keys.map((k) => ({
          key: k,
          size:
            Math.round(((localStorage.getItem(k)?.length || 0) / 1024) * 100) /
              100 +
            " KB",
        })),
      };
    },
  };
  console.log("🔧 WP Post Manager cache utils available: window.bpCache");
}

// SEO Plugin Utilities - handles Yoast & Rank Math keyword mapping
const seoUtils = {
  // Detect active SEO plugin by inspecting a sample post's meta fields
  detectPlugin: async (apiUrl, token) => {
    try {
      const response = await fetch(`${apiUrl}/posts?per_page=1&context=edit`, {
        headers: {
          Authorization: `Basic ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) return null;
      const posts = await response.json();
      if (!posts.length) return null;
      const meta = posts[0].meta || {};
      if (meta._yoast_wpseo_focuskw !== undefined) return "yoast";
      if (meta.rank_math_focus_keyword !== undefined) return "rank-math";
      return null;
    } catch {
      return null;
    }
  },

  // Extract keyword from post object based on detected plugin
  getKeyword: (post, plugin) => {
    if (!post?.meta) return "";
    if (plugin === "yoast") {
      return (
        post.meta._yoast_wpseo_focuskw ||
        post.yoast_head_json?.focus_keyword ||
        ""
      );
    }
    if (plugin === "rank-math") {
      return post.meta.rank_math_focus_keyword || "";
    }
    // Fallback: check both
    return (
      post.meta._yoast_wpseo_focuskw ||
      post.meta.rank_math_focus_keyword ||
      post.yoast_head_json?.focus_keyword ||
      ""
    );
  },

  // Build meta payload for saving keyword to correct plugin field
  buildMetaPayload: (keyword, plugin) => {
    const meta = {};
    if (plugin === "yoast") {
      meta._yoast_wpseo_focuskw = keyword || "";
    } else if (plugin === "rank-math") {
      meta.rank_math_focus_keyword = keyword || "";
    } else {
      // Send to both for maximum compatibility
      meta._yoast_wpseo_focuskw = keyword || "";
      meta.rank_math_focus_keyword = keyword || "";
    }
    return meta;
  },
};

// Generate URL-friendly slug from title
function generateSlug(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special chars
    .replace(/[\s_-]+/g, "-") // Replace spaces/underscores with hyphens
    .replace(/^-+|-+$/g, ""); // Trim leading/trailing hyphens
}

// Update the read-only content type indicator in the sidebar
function updateContentTypeIndicator(type) {
  const el = document.getElementById("contentType");
  if (el) {
    el.value = type === "page" ? "Page" : "Post";
    el.title = `Editing a WordPress ${type}`;
    console.log(`Content type set to: ${type}`);
  }
}

// ====================================
// MULTI-SITE MANAGEMENT (delegated to AuthManager)
// ====================================

// Site management delegated to AuthManager
const siteManager = {
  getSites: () => authManager.getSites(),
  saveSite: (site) => authManager.saveSite(site),
  removeSite: (siteId) => authManager.removeSite(siteId),
  getActiveSite: () => authManager.getActiveSite(),
  setActiveSite: (siteId) => authManager.setActiveSite(siteId),
  createSite: (name, url, username, token) =>
    authManager.createSite(name, url, username, token),
};

// Configuration - delegated to AuthManager
const getActiveConfig = () => authManager.getActiveConfig();

// PostManager factory - reuses existing config & auth systems
function createPostManager() {
  const config = getActiveConfig();
  const token = tokenManagerMultiSite.getToken();

  if (!config.WORDPRESS_API)
    throw new Error("No active WordPress site configured");
  if (!token) throw new Error("Authentication required. Please login first.");

  return new PostManager(config.WORDPRESS_API, token);
}

/**
Clear all sidebar form fields
*/
function clearSidebarFields() {
  const fields = ["postTitle", "postKeyword", "postExcerpt", "postSlug"];
  fields.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const statusEl = document.getElementById("postStatus");
  if (statusEl) statusEl.value = "draft";
}

/**
✅ NEW: Centralized editor & state reset
Call after successful publish, update, cancel, or app exit
*/
function resetEditorState() {
  if (!window.editorInstance) return;

  // 1. Clear Editor.js safely (avoid race conditions)
  window.editorInstance.clear();
  setTimeout(() => {
    window.editorInstance?.blocks.insert("paragraph", { text: "" });
  }, 50);

  // 2. Reset module-level tracking variables
  editingPostId = null;
  currentEditingType = "post";
  updateEditModeUI(false);
  updateContentTypeIndicator("post");
  updateSidebarPostLink(null);

  // 3. Clear sidebar fields & draft storage
  clearSidebarFields();
  if (window.pendingUploads) window.pendingUploads.clear();
  localStorage.removeItem("editorjs-content");

  // 4. Reset featured image input
  const featInput = document.getElementById("featuredImageUpload");
  if (featInput) featInput.value = "";

  // 5. Clear dirty flag
  hasUnsavedChanges = false;
}

/**
 * Creates a clean editor state for a new post or page
 * @param {string} type - 'post' | 'page'
 */
function createNewPost(type = "post") {
  currentEditingType = type; // Track type for API routing
  updateContentTypeIndicator(type); // Update sidebar indicator

  if (!window.editorInstance) return;

  // Clear editor safely
  window.editorInstance.clear();
  setTimeout(() => {
    if (window.editorInstance) {
      window.editorInstance.blocks.insert("paragraph", { text: "" });
    }
  }, 100);

  // Reset sidebar fields
  clearSidebarFields();

  // Reset state & clear drafts
  editingPostId = null;
  updateSidebarPostLink(null); // ✅ NEW: Clear permalink for new drafts
  localStorage.removeItem("editorjs-content");
  updateEditModeUI(false);
  updatePageOptionsVisibility();

  // Switch to editor view
  switchView("editor");
}

let libraryViewInstance = null;

function initLibraryView() {
  const container = document.getElementById("library-view");
  if (!container) return;

  if (!window.libraryInstance) {
    const config = getActiveConfig();
    const token = tokenManagerMultiSite.getToken();
    if (!config.WORDPRESS_API || !token) return;

    const postManager = new PostManager(config.WORDPRESS_API, token);
    const pageManager = new PageManager(config.WORDPRESS_API, token);

    window.libraryInstance = new LibraryView(
      container,
      { post: postManager, page: pageManager }, // Pass manager map
      (post) => {
        switchView("editor");
        loadPostIntoEditor(post);
      },
      (type) => createNewPost(type), // Pass create callback
    );
  } else {
    window.libraryInstance.load();
  }
}

function switchView(view) {
  const editorView = document.getElementById("editor-area");
  const libraryView = document.getElementById("library-view");
  const editorBtn = document.getElementById("view-editor-btn");
  const libraryBtn = document.getElementById("view-library-btn");

  if (view === "editor") {
    editorView.style.display = "block";
    libraryView.style.display = "none";
    editorBtn.classList.add("active");
    libraryBtn.classList.remove("active");
  } else {
    editorView.style.display = "none";
    libraryView.style.display = "flex";
    editorBtn.classList.remove("active");
    libraryBtn.classList.add("active");
    initLibraryView();
  }
}

// Token management delegated to AuthManager
const tokenManagerMultiSite = {
  getToken: () => authManager.getToken(),
  setToken: (token) => authManager.setToken(token),
  clearToken: () => authManager.clearToken(),
  validateToken: async () => authManager.validateToken(),
};

// Image processing utilities (delegated to ImageUploader)
const imageUtils = {
  base64ToBlob: (base64Data) => imageUploader.base64ToBlob(base64Data),
  validateImageFile: (file) => imageUploader.validateImageFile(file),
};

// HTML conversion with proper inline formatting support
async function convertEditorJsToHTML(jsonData) {
  if (!jsonData || !Array.isArray(jsonData.blocks)) {
    console.error("Invalid Editor.js data");
    return "";
  }
  let html = "";
  for (const block of jsonData.blocks) {
    if (!block || !block.type) continue;
    try {
      switch (block.type) {
        case "header":
          const level = Math.min(
            Math.max(parseInt(block.data?.level) || 2, 1),
            6,
          );
          const headerText = securityUtils.sanitizeInlineHtml(
            block.data?.text || "",
          );
          html += `<h${level}>${headerText}</h${level}>`;
          break;

        case "paragraph":
          const paragraphText = securityUtils.sanitizeInlineHtml(
            block.data?.text || "",
          );
          // Normalize newlines (from previous fix)
          const normalizedText = paragraphText
            .replace(/\r\n/g, "\n")
            .replace(/\n{2,}/g, "\n")
            .trim();
          const htmlContent = normalizedText.includes("\n")
            ? normalizedText.replace(/\n/g, "<br>")
            : normalizedText;
          html += `<p>${htmlContent}</p>`; // ← <span> tags will be preserved here
          break;

        case "image":
          const imageUrl = block.data?.file?.url;
          if (imageUrl && !imageUrl.startsWith("data:")) {
            const cleanUrl = securityUtils.sanitizeUrl(imageUrl);
            const alt = securityUtils.escapeAttribute(
              block.data?.alt || block.data?.caption || "Image",
            );
            const caption = securityUtils.sanitizeInlineHtml(
              block.data?.caption || "",
            );
            const fileData = block.data.file;

            // Build srcset safely
            let srcset = "";
            if (fileData?.sizes) {
              const sizes = [
                fileData.sizes.thumbnail,
                fileData.sizes.medium,
                fileData.sizes.large,
                fileData.sizes.full,
              ].filter((s) => s?.source_url);
              if (sizes.length > 0) {
                srcset = `srcset="${sizes.map((s) => `${securityUtils.sanitizeUrl(s.source_url)} ${s.width}w`).join(", ")}"`;
              }
            }

            // ✅ Added style="width: 100%; height: auto; max-width: 100%;"
            html += `<figure class="wp-block-image">
              <img src="${cleanUrl}" alt="${alt}" ${srcset} sizes="(max-width: 768px) 100vw, 1200px" loading="lazy" style="width: 100%; height: auto; max-width: 100%;" />
              ${caption ? `<figcaption>${caption}</figcaption>` : ""}
            </figure>`;
          }
          break;

        case "columns":
          if (block.data?.items?.length) {
            // ✅ FIX: Await recursive conversion to prevent [object Promise]
            const colsHtmlArray = await Promise.all(
              block.data.items.map(async (col) => {
                if (col.blocks && col.blocks.length > 0) {
                  const innerHtml = await convertEditorJsToHTML({
                    blocks: col.blocks,
                  });
                  return `<div class="wp-block-column">${innerHtml}</div>`;
                }
                return `<div class="wp-block-column"></div>`;
              }),
            );
            html += `<div class="wp-block-columns">${colsHtmlArray.join("")}</div>`;
          }
          break;

        case "custom-button":
          const btnText = securityUtils.escapeHtml(
            block.data?.text || "Click Here",
          );
          const btnLink = securityUtils.sanitizeUrl(block.data?.link || "#");
          const txtColor = /^#([0-9A-F]{3}){1,2}$/i.test(block.data?.textColor)
            ? block.data.textColor
            : "#ffffff";
          const bgColor = /^#([0-9A-F]{3}){1,2}$/i.test(block.data?.bgColor)
            ? block.data.bgColor
            : "#007acc";
          const radius = /^[\d]+(px|%|em|rem)?$/.test(block.data?.radius)
            ? block.data.radius
            : "4px";
          const width = block.data?.width || "auto";

          html += `<div class="wp-block-custom-button-wrapper"><a class="wp-block-custom-button" href="${btnLink}" target="_blank" rel="noopener" style="display:inline-block; color:${txtColor}; background-color:${bgColor}; border-radius:${radius}; width:${width}; padding:10px 20px; text-decoration:none; font-weight:600; text-align:center;">${btnText}</a></div>`;
          break;

        case "contact-form":
          if (block.data?.formId && block.data?.plugin) {
            html += `<div class="wp-block-contact-form">${window.formProvider?.getShortcode(block.data.formId) || ""}</div>`;
          }
          break;

        case "accordion":
          if (block.data?.items?.length) {
            html += `<div class="wp-block-accordion">`;
            for (const item of block.data.items) {
              const question = securityUtils.escapeHtml(item.question || "");
              const answer = securityUtils.sanitizeInlineHtml(
                item.answer || "",
              );
              html += `
                <details>
                  <summary>${question}</summary>
                  <div class="accordion-content">${answer}</div>
                </details>
              `;
            }
            html += `</div>`;
          }
          break;

        case "list":
          if (block.data?.items?.length) {
            const tag = block.data.style === "ordered" ? "ol" : "ul";
            const items = block.data.items
              .map((item) => {
                const text =
                  typeof item === "string"
                    ? item
                    : item?.content || item?.text || "";
                return `<li>${securityUtils.sanitizeInlineHtml(text)}</li>`;
              })
              .join("");
            html += `<${tag}>${items}</${tag}>`;
          }
          break;

        case "quote":
          const quoteText = securityUtils.sanitizeInlineHtml(
            block.data?.text || "",
          );
          const quoteCaption = securityUtils.sanitizeInlineHtml(
            block.data?.caption || "",
          );
          html += `<blockquote><p>${quoteText}</p>${quoteCaption ? `<cite>${quoteCaption}</cite>` : ""}</blockquote>`;
          break;

        case "code":
          html += `<pre><code>${securityUtils.escapeHtml(block.data?.code || "")}</code></pre>`;
          break;

        case "delimiter":
          html += "<hr>";
          break;

        case "embed":
          if (block.data?.embed) {
            html += `<div class="embed"><iframe src="${securityUtils.sanitizeUrl(block.data.embed)}" frameborder="0"></iframe></div>`;
          }
          break;
      }
    } catch (error) {
      console.error(`Error processing block type ${block.type}:`, error);
    }
  }
  return html;
}

// Upload pending images to WordPress (delegated to ImageUploader)
async function uploadPendingImages(editorData) {
  return imageUploader.uploadPendingImages(editorData);
}

// Function to handle featured image upload (delegated to ImageUploader)
async function uploadFeaturedImage(file) {
  return imageUploader.uploadFeaturedImage(file);
}

/**
 * Create or Update a post in WordPress
 * SEO meta is handled dynamically based on detected plugin (Yoast or Rank Math)
 * @param {Object} htmlContent - Sanitized HTML
 * @param {Object} postData - { title, excerpt, status, slug, yoast }
 * @param {number|null} featuredImageId
 * @param {number|null} postId - If provided, updates existing post
 */
async function postToWordPress(
  htmlContent,
  postData,
  featuredImageId = null,
  postId = null,
  type = "post",
) {
  try {
    const token = tokenManagerMultiSite.getToken();
    if (!token) throw new Error("Authentication required.");

    const config = getActiveConfig();

    // Validate status (removed trailing spaces bug)
    const validStatuses = ["publish", "draft", "pending", "private", "future"];
    const targetStatus = validStatuses.includes(postData.status)
      ? postData.status
      : "draft";

    // Auto-generate slug if not provided (CRUD: Create default)
    const slug =
      postData.slug ||
      (postData.title ? generateSlug(postData.title) : "untitled");

    // Build base payload
    const payload = {
      title: securityUtils.escapeHtml(postData.title || "Untitled"),
      slug: slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
      content: htmlContent,
      status: targetStatus,
      excerpt: securityUtils.escapeHtml(postData.excerpt || ""),
      featured_media: featuredImageId || 0,
    };

    // Merge SEO meta fields (Yoast + Rank Math compatibility)
    if (postData.seoMeta) {
      payload.meta = { ...(payload.meta || {}), ...postData.seoMeta };
    }

    // Add Yoast-specific fields if provided (backward compatibility)
    if (postData.yoast) {
      payload.meta = {
        ...(payload.meta || {}),
        _yoast_wpseo_focuskw: postData.yoast.focusKeyword || "",
        _yoast_wpseo_metadesc:
          postData.yoast.metaDescription || postData.excerpt || "",
        _yoast_wpseo_title: postData.yoast.title || postData.title || "",
      };
      // Optional yoast_head_json for newer plugin versions
      if (postData.yoast.title || postData.yoast.metaDescription) {
        payload.yoast_head_json = {
          title: postData.yoast.title,
          description: postData.yoast.metaDescription,
        };
      }
    }

    if (postData.pageMeta) {
      payload.meta = {
        ...payload.meta,
        ...postData.pageMeta,
      };
    }

    // Determine correct endpoint based on content type
    const endpoint = postId
      ? `${config.WORDPRESS_API}/${type === "page" ? "pages" : "posts"}/${postId}`
      : `${config.WORDPRESS_API}/${type === "page" ? "pages" : "posts"}`;

    const response = await fetch(endpoint, {
      method: "POST", // WP REST accepts POST for both create & update
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WordPress API error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error posting to WordPress:", error);
    throw error;
  }
}

// Authentication with WordPress (delegated to AuthManager)
async function authenticateWithWordPress(username, applicationPassword) {
  return authManager.authenticate(username, applicationPassword);
}

// Check user capabilities (delegated to AuthManager)
async function checkUserCapability(capability) {
  return authManager.checkCapability(capability);
}

function getAdvancedYoastData() {
  return {
    focusKeyword: document.getElementById("postKeyword")?.value || "",
    metaDescription: document.getElementById("postExcerpt")?.value || "",
    title: document.getElementById("postTitle")?.value || "",

    // Canonical URL
    canonical: document.getElementById("yoastCanonical")?.value || "",

    // Meta Robots
    metaRobotsNoindex:
      document.getElementById("yoastNoindex")?.checked || false,
    metaRobotsNofollow:
      document.getElementById("yoastNofollow")?.checked || false,

    // Open Graph
    ogTitle: document.getElementById("yoastOgTitle")?.value || "",
    ogDescription: document.getElementById("yoastOgDescription")?.value || "",
    ogImage: document.getElementById("yoastOgImage")?.value || "",

    // Twitter
    twitterTitle: document.getElementById("yoastTwitterTitle")?.value || "",
    twitterDescription:
      document.getElementById("yoastTwitterDescription")?.value || "",
    twitterImage: document.getElementById("yoastTwitterImage")?.value || "",
  };
}

// Function to test if Yoast SEO is available on the WordPress site
async function checkYoastAvailability() {
  try {
    const token = tokenManagerMultiSite.getToken();
    if (!token) {
      throw new Error("Authentication required");
    }

    const config = getActiveConfig();

    // Try to fetch a post and check for Yoast meta
    const response = await fetch(`${config.WORDPRESS_API}/posts?per_page=1`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to check Yoast availability");
    }

    const posts = await response.json();

    if (posts.length > 0) {
      const hasYoast =
        posts[0].yoast_head_json !== undefined || posts[0].meta !== undefined;
      console.log("Yoast SEO plugin detected:", hasYoast);
      return hasYoast;
    }

    return false;
  } catch (error) {
    console.error("Error checking Yoast availability:", error);
    return false;
  }
}

// Initialize Editor.js with proper configuration
async function initializeEditor() {
  try {
    // Check if we have any sites configured
    const sites = siteManager.getSites();

    if (sites.length === 0) {
      // First time user - show add site modal
      const siteAdded = await showAddSiteModal();
      if (!siteAdded) {
        throw new Error(
          "You need to add at least one WordPress site to continue",
        );
      }
    }

    // Check if we have an active site
    let activeSite = siteManager.getActiveSite();

    if (!activeSite && sites.length > 0) {
      // Set first site as active
      siteManager.setActiveSite(sites[0].id);
      activeSite = sites[0];
    }

    // Validate authentication for active site
    const isAuthenticated = await tokenManagerMultiSite.validateToken();

    if (!isAuthenticated) {
      const authenticated = await showLoginModal();
      if (!authenticated) {
        throw new Error("Authentication required to use the editor");
      }
    }

    if (siteManager.getActiveSite()) {
      // Detect SEO plugin once and cache result
      const config = getActiveConfig();
      const token = tokenManagerMultiSite.getToken();
      seoUtils.detectPlugin(config.WORDPRESS_API, token).then((plugin) => {
        detectedSeoPlugin = plugin;
        console.log(`✅ SEO plugin detected: ${plugin || "none"}`);
      });

      // Initialize FormProvider for contact form detection
      window.formProvider = new FormProvider(config.WORDPRESS_API, token);
      // Pre‑fetch the form list silently
      window.formProvider
        .detect()
        .catch((e) => console.warn("Form detection failed:", e));

      // Non-blocking cache pre-fetch
      setTimeout(async () => {
        try {
          const manager = createPostManager();
          await manager.fetchPosts({
            per_page: 10,
            useCache: true,
            fields: "minimal",
          });
          console.log("✅ Library cache warmed");
        } catch (e) {
          // Silent fail - cache warm-up is optional
        }
      }, 2000);
    }

    // Create site switcher UI
    createSiteSwitcher();

    const editor = new EditorJS({
      holder: "editorjs",
      autofocus: true,
      placeholder: "Start writing your content here...",
      tools: {
        header: {
          class: Header,
          inlineToolbar: ["bold", "italic", "link", "ColorPicker"],
          config: {
            placeholder: "Enter a header",
            levels: [1, 2, 3, 4, 5, 6],
            defaultLevel: 2,
          },
        },
        paragraph: {
          class: Paragraph,
          inlineToolbar: ["bold", "italic", "link", "ColorPicker"],
        },
        image: {
          class: ImageTool,
          config: {
            uploader: {
              async uploadByFile(file) {
                try {
                  imageUtils.validateImageFile(file);

                  const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                  });

                  const fileId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                  if (!window.pendingUploads) {
                    window.pendingUploads = new Map();
                  }
                  window.pendingUploads.set(fileId, file);

                  return {
                    success: 1,
                    file: {
                      url: base64,
                      id: fileId,
                      pending: true,
                    },
                  };
                } catch (error) {
                  console.error("Image upload error:", error);
                  return {
                    success: 0,
                    error: error.message,
                  };
                }
              },

              async uploadByUrl(url) {
                const sanitizedUrl = securityUtils.sanitizeUrl(url);
                if (!sanitizedUrl) {
                  return {
                    success: 0,
                    error: "Invalid URL",
                  };
                }

                return {
                  success: 1,
                  file: {
                    url: sanitizedUrl,
                    pending: false,
                  },
                };
              },
            },
          },
        },
        ColorPicker: {
          class: ColorPicker,
          inlineToolbar: true,
          sanitize: {
            span: {
              style: {
                color: true, // ✅ Only allow color property
              },
            },
          },
        },
        columns: {
          class: ColumnsBlock, // Custom block defined in ./blocks/ColumnsBlock.js
          inlineToolbar: true,
        },
        "custom-button": {
          class: CustomButtonBlock,
          inlineToolbar: true,
        },
        "contact-form": {
          class: ContactFormBlock,
          config: {
            formProvider: window.formProvider,
          },
        },
        accordion: {
          class: AccordionBlock,
          inlineToolbar: true,
        },
        "button-inline": ButtonInlineTool,
        list: {
          class: List,
          inlineToolbar: ["bold", "italic", "link", "ColorPicker"],
        },
        quote: {
          class: Quote,
          inlineToolbar: true,
        },
        linkTool: {
          class: LinkTool,
          config: {
            endpoint: "https://api.linkpreview.net/?key=demo&q=",
          },
        },
        embed: {
          class: Embed,
          inlineToolbar: true,
          config: {
            services: {
              youtube: true,
              vimeo: true,
              coub: true,
              twitter: true,
              instagram: true,
              facebook: true,
            },
          },
        },
        underline: Underline,
        marker: {
          class: Marker,
        },
        inlineCode: InlineCode,
        delimiter: Delimiter,
      },
      data: loadFromLocalStorage() || getDefaultData(),

      // UPDATED: onChange with word count AND SEO
      onChange: debounce(() => {
        hasUnsavedChanges = true; // Set dirty flag on any change

        editor
          .save()
          .then((outputData) => {
            saveToLocalStorage(outputData);

            // Update word count
            const stats = wordCounter.getStats(outputData);

            // Calculate SEO score
            const title = document.getElementById("postTitle")?.value || "";
            const keyword = document.getElementById("postKeyword")?.value || "";
            const excerpt = document.getElementById("postExcerpt")?.value || "";
            const seoScore = seoAnalyzer.analyze(
              outputData,
              title,
              excerpt,
              keyword,
            );

            // Update display with both stats and SEO
            updateWordCountWithSEO(stats, seoScore);
          })
          .catch((error) => console.error("Auto-save failed:", error));
      }, 1000),

      // UPDATED: onReady with word count and SEO initialization
      onReady: () => {
        console.log("Editor.js is ready");

        // Create word count display
        createWordCountDisplay();

        // Create page options section
        createPageOptionsSection();

        // Create post link widget
        createPostLinkWidget();

        // Get initial stats and SEO score
        editor
          .save()
          .then((data) => {
            const stats = wordCounter.getStats(data);
            const title = document.getElementById("postTitle")?.value || "";
            const keyword = document.getElementById("postKeyword")?.value || "";
            const excerpt = document.getElementById("postExcerpt")?.value || "";
            const seoScore = seoAnalyzer.analyze(data, title, excerpt, keyword);

            updateWordCountWithSEO(stats, seoScore);
          })
          .catch((err) => {
            console.error("Failed to get initial stats:", err);
          });
      },
    });

    // ========================================
    // STEP B: Paste normalization handler
    // Intercepts paste events and cleans HTML from Word, LibreOffice, ChatGPT
    // ========================================
    editor.onPaste = async (event) => {
      try {
        const originalHTML = event.detail.data.innerHTML;
        if (originalHTML) {
          const cleanHTML = cleanPastedHTML(originalHTML);
          event.detail.data.innerHTML = cleanHTML;
        }
      } catch (error) {
        console.warn("Paste sanitization failed:", error);
        // Fail gracefully - let original paste through
      }
    };

    setupEventHandlers(editor);

    // Check if Yoast is available
    const hasYoast = await checkYoastAvailability();
    if (hasYoast) {
      console.log("✅ Yoast SEO plugin is active. Meta fields will be synced.");
    } else {
      console.warn(
        "⚠️ Yoast SEO plugin not detected. Meta fields may not work.",
      );
    }

    // Store editor instance globally
    window.editorInstance = editor;

    return editor;
  } catch (error) {
    console.error("Failed to initialize editor:", error);
    document.getElementById("editorjs").innerHTML = `
      <div class="error-message">
        <h3>Failed to load editor</h3>
        <p>${error.message}</p>
        <button onclick="location.reload()">Retry</button>
      </div>
    `;
    return null;
  }
}

// Helper functions
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function loadFromLocalStorage() {
  try {
    const savedData = localStorage.getItem("editorjs-content");
    if (!savedData) return null;

    const parsed = JSON.parse(savedData);
    // Validate structure
    if (parsed && parsed.blocks && Array.isArray(parsed.blocks)) {
      return parsed;
    }
    return null;
  } catch (e) {
    console.error("Failed to load from localStorage:", e);
    localStorage.removeItem("editorjs-content");
    return null;
  }
}

function saveToLocalStorage(data) {
  try {
    localStorage.setItem("editorjs-content", JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save to localStorage:", e);
  }
}

// Default content for new posts/pages
function getDefaultData() {
  return {
    time: new Date().getTime(),
    blocks: [
      {
        type: "header",
        data: {
          text: "Welcome to the Editor",
          level: 1,
        },
      },
      {
        type: "paragraph",
        data: {
          text: "Start writing your content here...",
        },
      },
    ],
  };
}

/**
 * Load an existing WordPress post/page into Editor.js and populate sidebar
 * @param {Object} post - Sanitized post object from PostManager/PageManager
 */
async function loadPostIntoEditor(post) {
  if (!window.editorInstance) {
    console.warn("Editor not ready");
    return;
  }

  try {
    // 1. Set content type from loaded post
    currentEditingType = post.type === "page" ? "page" : "post";
    updateContentTypeIndicator(currentEditingType);

    // 2. Clear editor safely (render() replaces content, clear() causes race condition)
    const converter = new HtmlToEditorJs();
    let editorData = converter.convert(post.contentRaw || "");
    if (editorData.blocks.length === 0) {
      editorData = getDefaultData();
    }
    await window.editorInstance.render(editorData);

    // 3. Populate sidebar fields with null checks
    const fields = [
      { id: "postTitle", value: post.titleRaw || "" },
      { id: "postExcerpt", value: post.excerptRaw || "" },
      { id: "postSlug", value: post.slug || "" },
      { id: "postStatus", value: post.status || "draft" },
    ];
    fields.forEach(({ id, value }) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });

    // 4. Update post link in sidebar
    updateSidebarPostLink(post.link || null);

    console.log(`Loaded post ID ${post.id} into editor:`, {
      title: post.titleRaw,
      slug: post.slug,
      status: post.status,
      link: post.link,
    });

    // 5. Load SEO Keyword (Supports Yoast & Rank Math)
    const keywordInput = document.getElementById("postKeyword");
    if (keywordInput && post.meta) {
      keywordInput.value = (
        post.meta._yoast_wpseo_focuskw ||
        post.meta.rank_math_focus_keyword ||
        post.yoast_head_json?.focus_keyword ||
        ""
      ).trim();
    }

    // ✅ NEW: Load Page Options (Check meta values for "1" or true)
    if (currentEditingType === "page") {
      console.log(
        "Current editing type: Page. Checking page options meta:",
        post.meta,
      );

      const section = document.getElementById("page-options-section");
      const seaInput = document.getElementById("seaPageToggle");
      const fullWidthInput = document.getElementById("fullWidthToggle");

      if (section) section.style.display = "block";

      if (seaInput) {
        seaInput.checked =
          post.meta._is_sea_page == 1 || post.meta._is_sea_page === "1";
      }
      if (fullWidthInput) {
        fullWidthInput.checked =
          post.meta._full_width_page == 1 || post.meta._full_width_page === "1";
      }
    }
    updatePageOptionsVisibility();

    // 7. Activate edit mode UI & switch view
    editingPostId = post.id;
    updateEditModeUI(true);
    switchView("editor");

    // 8. Trigger SEO/Word count update after DOM settles
    setTimeout(() => {
      if (window.editorInstance) {
        window.editorInstance.save().then((data) => {
          const stats = wordCounter.getStats(data);
          const title = document.getElementById("postTitle")?.value || "";
          const keyword = document.getElementById("postKeyword")?.value || "";
          const excerpt = document.getElementById("postExcerpt")?.value || "";
          const seoScore = seoAnalyzer.analyze(data, title, excerpt, keyword);
          updateWordCountWithSEO(stats, seoScore);
        });
      }
    }, 500);
  } catch (error) {
    console.error("Failed to load post into editor:", error);
    alert(`Could not load post content: ${error.message}`);
  }
}

/**
 * Setup Cancel Edit Button (binds to existing #cancelEditBtn in index.html)
 */
function setupCancelEditButton() {
  const cancelBtn = document.getElementById("cancelEditBtn");
  if (!cancelBtn) return;

  cancelBtn.addEventListener("click", () => {
    if (confirm("Cancel editing? Unsaved changes will be lost.")) {
      editingPostId = null;
      updateEditModeUI(false);

      // Clear editor & sidebar
      window.editorInstance?.clear();
      clearSidebarFields();

      localStorage.removeItem("editorjs-content");
    }
  });
}

/**
 * Toggle UI elements based on create vs edit mode
 * @param {boolean} isEditing
 */
function updateEditModeUI(isEditing) {
  const saveBtn = document.getElementById("saveBtn");
  const cancelBtn = document.getElementById("cancelEditBtn");
  if (!saveBtn || !cancelBtn) return;

  if (isEditing) {
    saveBtn.innerHTML = '<i class="fas fa-check"></i>';
    saveBtn.title = "Update Post";
    cancelBtn.style.display = "flex";
  } else {
    saveBtn.innerHTML = '<i class="fab fa-wordpress"></i>';
    saveBtn.title = "Publish to WordPress";
    cancelBtn.style.display = "none";
  }
}

// Update the login modal to include Application Password instructions (delegated to AuthManager)
async function showLoginModal() {
  return authManager.showLoginModal();
}

// Add logout functionality (delegated to AuthManager)
function addLogoutButton() {
  authManager.addLogoutButton();
}

// Word Count Utility
const wordCounter = {
  /**
   * Extract plain text from HTML string
   */
  stripHtml: (html) => {
    if (!html) return "";
    const temp = document.createElement("div");
    temp.innerHTML = html;
    return temp.textContent || temp.innerText || "";
  },

  /**
   * Count words in a text string
   */
  countWords: (text) => {
    if (!text || typeof text !== "string") return 0;

    // Remove extra whitespace and trim
    const cleaned = text.trim().replace(/\s+/g, " ");

    // If empty after cleaning, return 0
    if (!cleaned) return 0;

    // Split by spaces and filter out empty strings
    const words = cleaned.split(" ").filter((word) => word.length > 0);

    return words.length;
  },

  /**
   * Count characters (including spaces)
   */
  countCharacters: (text) => {
    if (!text || typeof text !== "string") return 0;
    return text.length;
  },

  /**
   * Count characters (excluding spaces)
   */
  countCharactersNoSpaces: (text) => {
    if (!text || typeof text !== "string") return 0;
    return text.replace(/\s/g, "").length;
  },

  /**
   * Estimate reading time in minutes
   */
  estimateReadingTime: (wordCount) => {
    const wordsPerMinute = 200; // Average reading speed
    const minutes = Math.ceil(wordCount / wordsPerMinute);
    return minutes;
  },

  /**
   * Extract text from Editor.js blocks
   */
  extractTextFromBlocks: (blocks) => {
    if (!Array.isArray(blocks)) return "";

    let allText = "";

    for (const block of blocks) {
      if (!block || !block.data) continue;

      switch (block.type) {
        case "header":
        case "paragraph":
          allText += wordCounter.stripHtml(block.data.text || "") + " ";
          break;

        case "list":
          if (Array.isArray(block.data.items)) {
            block.data.items.forEach((item) => {
              const itemText =
                typeof item === "string"
                  ? item
                  : item?.content || item?.text || "";
              allText += wordCounter.stripHtml(itemText) + " ";
            });
          }
          break;

        case "quote":
          allText += wordCounter.stripHtml(block.data.text || "") + " ";
          allText += wordCounter.stripHtml(block.data.caption || "") + " ";
          break;

        case "code":
          // Optionally include code in word count
          allText += (block.data.code || "") + " ";
          break;

        // Image captions
        case "image":
          allText += wordCounter.stripHtml(block.data.caption || "") + " ";
          break;
      }
    }

    return allText.trim();
  },

  /**
   * Get comprehensive statistics from Editor.js data
   */
  getStats: (editorData) => {
    if (!editorData || !editorData.blocks) {
      return {
        words: 0,
        characters: 0,
        charactersNoSpaces: 0,
        readingTime: 0,
        blocks: 0,
      };
    }

    const text = wordCounter.extractTextFromBlocks(editorData.blocks);
    const words = wordCounter.countWords(text);

    return {
      words: words,
      characters: wordCounter.countCharacters(text),
      charactersNoSpaces: wordCounter.countCharactersNoSpaces(text),
      readingTime: wordCounter.estimateReadingTime(words),
      blocks: editorData.blocks.length,
    };
  },
};

// Create and insert word count display
function createWordCountDisplay() {
  // Initialize with default values
  const initialSeoScore = {
    overall: 0,
    suggestions: [],
  };

  const color = seoAnalyzer.getScoreColor(initialSeoScore.overall);

  const wordCountHTML = `
  <div class="config-section stats-section" id="word-count-section">
    <h3>Statistics</h3>
    <div id="word-count-container" class="word-count-container">
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-icon">
            <i class="fas fa-font"></i>
          </div>
          <div class="stat-content">
            <div class="stat-value" id="word-count-words">0</div>
            <div class="stat-label">Words</div>
          </div>
        </div>

        <div class="stat-box">
          <div class="stat-icon">
            <i class="fas fa-clock"></i>
          </div>
          <div class="stat-content">
            <div class="stat-value" id="word-count-reading">0 min</div>
            <div class="stat-label">Read Time</div>
          </div>
        </div>
      </div>
    </div>

    <div class="seo-compact">
      <div class="seo-header">
        <span class="seo-label">
          <i class="fas fa-search"></i> SEO Score (still in test mode)
        </span>
        <button id="seo-details-toggle" class="expand-btn" title="Details">
          <i class="fas fa-chevron-down"></i>
        </button>
      </div>
      <div class="seo-bar-container">
        <div class="seo-bar">
          <div class="seo-bar-fill" id="seo-bar-fill" style="width: 0%; background: ${color};"></div>
        </div>
        <div class="seo-score-text">
          <span id="seo-score-value">0</span>/100
        </div>
      </div>
    </div>

    <div id="seo-details" class="seo-details-dropdown" style="display: none;">
      <div id="seo-suggestions-container">
        <div class="no-suggestions">Start writing to see SEO suggestions.</div>
      </div>
      <div class="extra-stats" id="word-count-details">
        <div class="extra-stat">
          <span>Characters:</span>
          <strong id="word-count-chars">0</strong>
        </div>
        <div class="extra-stat">
          <span>No spaces:</span>
          <strong id="word-count-chars-no-space">0</strong>
        </div>
        <div class="extra-stat">
          <span>Blocks:</span>
          <strong id="word-count-blocks">0</strong>
        </div>
      </div>
    </div>
  </div>
  `;

  const sidebarContainer = document.getElementById("sidebar-post-config");
  if (sidebarContainer) {
    sidebarContainer.insertAdjacentHTML("afterbegin", wordCountHTML);
  }

  // Add toggle functionality
  const toggleBtn = document.getElementById("seo-details-toggle");
  const details = document.getElementById("seo-details");

  if (toggleBtn && details) {
    toggleBtn.addEventListener("click", () => {
      const isVisible = details.style.display !== "none";
      details.style.display = isVisible ? "none" : "block";
      toggleBtn.querySelector("i").className = isVisible
        ? "fas fa-chevron-down"
        : "fas fa-chevron-up";
    });
  }
}

// Update word count display
function updateWordCount(stats) {
  document.getElementById("word-count-words").textContent =
    stats.words.toLocaleString();
  document.getElementById("word-count-chars").textContent =
    stats.characters.toLocaleString();
  document.getElementById("word-count-chars-no-space").textContent =
    stats.charactersNoSpaces.toLocaleString();
  document.getElementById("word-count-blocks").textContent = stats.blocks;

  const readingTimeText =
    stats.readingTime === 1 ? "1 min" : `${stats.readingTime} min`;
  document.getElementById("word-count-reading").textContent = readingTimeText;
}

/**
 * Creates the Post/Page URL widget at the top of the sidebar
 */
function createPostLinkWidget() {
  const sidebarContainer = document.getElementById("sidebar-post-config");
  if (!sidebarContainer) return;

  const widgetHTML = `
    <div class="config-section sidebar-post-link-section">
      <label>Permalink</label>
      <div class="sidebar-post-link-container" id="postLinkContainer">
        <a href="#" target="_blank" id="postLink" class="sidebar-post-link disabled" title="Click to copy URL">Not published yet</a>
        <button id="copyPostLinkBtn" class="copy-link-btn" title="Copy to clipboard" disabled>
          <i class="fas fa-copy"></i>
        </button>
      </div>
    </div>
  `;

  sidebarContainer.insertAdjacentHTML("afterbegin", widgetHTML);

  // Event delegation: Click container/link to copy
  const container = document.getElementById("postLinkContainer");
  container?.addEventListener("click", async (e) => {
    e.preventDefault();
    const linkEl = document.getElementById("postLink");
    const btnEl = document.getElementById("copyPostLinkBtn");
    const url = linkEl?.getAttribute("data-url");

    if (!url || linkEl.classList.contains("disabled")) return;

    try {
      await navigator.clipboard.writeText(url);

      // Visual feedback
      const originalIcon = btnEl.innerHTML;
      btnEl.innerHTML = '<i class="fas fa-check"></i>';
      btnEl.classList.add("copied");
      linkEl.textContent = "Copied!";
      linkEl.style.color = "var(--success)";

      setTimeout(() => {
        btnEl.innerHTML = originalIcon;
        btnEl.classList.remove("copied");
        linkEl.textContent = new URL(url).pathname;
        linkEl.style.color = "";
      }, 1500);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
      linkEl.textContent = "Copy failed";
      setTimeout(() => {
        linkEl.textContent = new URL(url).pathname;
      }, 1000);
    }
  });
}

/**
 * Updates the sidebar permalink widget state
 * @param {string|null} url - The published post/page URL
 */
function updateSidebarPostLink(url) {
  const linkEl = document.getElementById("postLink");
  const btnEl = document.getElementById("copyPostLinkBtn");
  if (!linkEl || !btnEl) return;

  if (url && securityUtils.sanitizeUrl(url)) {
    const safeUrl = securityUtils.sanitizeUrl(url);
    linkEl.href = safeUrl;
    linkEl.textContent = new URL(safeUrl).pathname;
    linkEl.setAttribute("data-url", safeUrl);
    linkEl.classList.remove("disabled");
    btnEl.disabled = false;
    btnEl.title = "Copy URL to clipboard";
  } else {
    linkEl.href = "#";
    linkEl.textContent = "Not published yet";
    linkEl.removeAttribute("data-url");
    linkEl.classList.add("disabled");
    btnEl.disabled = true;
    btnEl.title = "URL unavailable until published";
  }
}

/**
 * Injects Page Options (SEA & Full-Width toggles) into the sidebar.
 * Visibility is dynamically controlled based on post/page type.
 */
function createPageOptionsSection() {
  const sidebar = document.getElementById("sidebar-post-config");
  if (!sidebar || document.getElementById("page-options-section")) return;

  const section = document.createElement("div");
  section.className = "config-section";
  section.id = "page-options-section";
  section.style.display = "none"; // Hidden by default

  section.innerHTML = `
    <h3>Page Options</h3>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="seaPageToggle"> SEA Landing Page
      </label>
      <small style="color:var(--text-muted);font-size:10px;">Triggers custom CSS via WP Code</small>
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="fullWidthToggle"> Full-Width Layout
      </label>
      <small style="color:var(--text-muted);font-size:10px;">Removes sidebar via theme template</small>
    </div>
  `;
  sidebar.appendChild(section);
}

function updatePageOptionsVisibility() {
  const section = document.getElementById("page-options-section");
  if (!section) return;
  section.style.display = currentEditingType === "page" ? "block" : "none";
}

// Create site switcher UI (delegated to AuthManager)
function createSiteSwitcher() {
  authManager.createSiteSwitcher();
}

// Handle site switching (delegated to AuthManager)
async function handleSiteSwitch(event) {
  return authManager.handleSiteSwitch(event);
}

// Show add site modal (delegated to AuthManager)
async function showAddSiteModal() {
  return authManager.showAddSiteModal();
}

// Show manage sites modal (delegated to AuthManager)
function showManageSitesModal() {
  authManager.showManageSitesModal();
}

// ====================================
// SEO SCORE CALCULATOR
// ====================================

const seoAnalyzer = {
  analyze: (editorData, title = "", excerpt = "", keyword = "") => {
    const text = wordCounter.extractTextFromBlocks(editorData.blocks || []);
    const hasContent = text.trim().length > 0;
    const hasKeyword = keyword.trim().length > 0;

    if (!hasContent || !hasKeyword) {
      return {
        overall: 0,
        breakdown: {},
        suggestions: [
          {
            type: "setup",
            severity: "warning",
            message: hasKeyword
              ? "Add content to calculate SEO score"
              : "Add a target keyword and content to calculate an SEO score",
          },
        ],
        keyword: keyword,
        isEmpty: true,
      };
    }

    const scores = {
      titleScore: seoAnalyzer.analyzeTitleScore(title, keyword),
      contentLengthScore: seoAnalyzer.analyzeContentLength(editorData),
      headingStructureScore: seoAnalyzer.analyzeHeadings(editorData, keyword),
      keywordPlacementScore: seoAnalyzer.analyzeKeywordPlacement(
        editorData,
        keyword,
        title,
      ),
      keywordDensityScore: seoAnalyzer.analyzeKeywordDensity(
        editorData,
        keyword,
      ),
      imageOptimizationScore: seoAnalyzer.analyzeImages(editorData),
      excerptScore: seoAnalyzer.analyzeExcerpt(excerpt, keyword),
      readabilityScore: seoAnalyzer.analyzeReadability(editorData),
    };

    const weights = {
      titleScore: 0.25,
      keywordPlacementScore: 0.2,
      headingStructureScore: 0.15,
      contentLengthScore: 0.15,
      keywordDensityScore: 0.1,
      excerptScore: 0.1,
      imageOptimizationScore: 0.05,
      readabilityScore: 0.1,
    };

    let totalScore = 0;
    Object.keys(scores).forEach((key) => {
      totalScore += scores[key] * weights[key];
    });

    return {
      overall: Math.round(totalScore),
      breakdown: scores,
      suggestions: seoAnalyzer.getSuggestions(
        scores,
        editorData,
        title,
        excerpt,
        keyword,
      ),
      keyword: keyword,
      isEmpty: false,
    };
  },

  analyzeTitleScore: (title, keyword) => {
    if (!title) return 0;
    const length = title.length;
    const hasKeyword =
      keyword && title.toLowerCase().includes(keyword.toLowerCase());

    let baseScore = 0;
    if (length >= 50 && length <= 60) baseScore = 100;
    else if (length >= 40 && length <= 70) baseScore = 80;
    else if (length >= 30 && length <= 80) baseScore = 60;
    else if (length > 0) baseScore = 40;

    // Bonus for keyword in title
    return hasKeyword ? baseScore : baseScore * 0.7;
  },

  analyzeContentLength: (editorData) => {
    const words = wordCounter.getStats(editorData).words;
    if (words < 300) return 20;
    if (words < 600) return 60;
    if (words < 1200) return 100;
    if (words < 2000) return 90;
    return 80;
  },

  analyzeHeadings: (editorData, keyword) => {
    const headings = editorData.blocks.filter((b) => b.type === "header");
    if (headings.length === 0) return 20;

    const h1s = headings.filter((h) => h.data.level === 1);
    if (h1s.length !== 1) return 30;

    const h1Text = h1s[0].data.text || "";
    const keywordInH1 =
      keyword && h1Text.toLowerCase().includes(keyword.toLowerCase());
    return keywordInH1 ? 100 : 60;
  },

  analyzeKeywordDensity: (editorData, keyword) => {
    const text = wordCounter.extractTextFromBlocks(editorData.blocks);
    const wordCount = wordCounter.countWords(text);
    const occurrences = seoAnalyzer.countKeywordOccurrences(text, keyword);

    if (wordCount < 300) return 40;

    const density = (occurrences / wordCount) * 100;
    if (density < 0.3) return 40;
    if (density >= 0.3 && density <= 1.5) return 100;
    if (density > 1.5 && density <= 2.5) return 60;
    return 20;
  },

  countKeywordOccurrences: (text, keyword) => {
    if (!keyword) return 0;
    const lowerText = text.toLowerCase();
    const escapedKeyword = keyword
      .toLowerCase()
      .replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escapedKeyword}\\b`, "gi");
    const matches = lowerText.match(regex);
    return matches ? matches.length : 0;
  },

  analyzeKeywordPlacement: (editorData, keyword, title) => {
    const text = wordCounter
      .extractTextFromBlocks(editorData.blocks)
      .toLowerCase();
    const lowerKeyword = keyword.toLowerCase();

    let score = 0;
    if (title.toLowerCase().includes(lowerKeyword)) score += 50;

    const first100Words = text.split(" ").slice(0, 100).join(" ");
    if (first100Words.includes(lowerKeyword)) score += 50;

    return score;
  },

  analyzeImages: (editorData) => {
    const images = editorData.blocks.filter((b) => b.type === "image");
    if (images.length === 0) return 50;

    let score = 0;
    images.forEach((img) => {
      if (img.data?.caption) score += 50 / images.length;
      if (img.data?.alt) score += 50 / images.length;
    });

    return Math.min(100, Math.round(score));
  },

  analyzeExcerpt: (excerpt, keyword) => {
    if (!excerpt) return 0;
    const length = excerpt.length;
    const hasKeyword =
      keyword && excerpt.toLowerCase().includes(keyword.toLowerCase());

    let baseScore = 0;
    if (length >= 120 && length <= 160) baseScore = 100;
    else if (length >= 100 && length <= 180) baseScore = 80;
    else if (length >= 50) baseScore = 60;
    else baseScore = 30;

    return hasKeyword ? baseScore : baseScore * 0.8;
  },

  analyzeReadability: (editorData) => {
    const text = wordCounter.extractTextFromBlocks(editorData.blocks);
    const sentences = text.split(/[.!?]/).filter(Boolean);
    const words = text.split(/\s+/).filter(Boolean);

    if (sentences.length === 0) return 50;

    const avgSentenceLength = words.length / sentences.length;
    if (avgSentenceLength <= 20) return 100;
    if (avgSentenceLength <= 25) return 70;
    return 40;
  },

  getSuggestions: (scores, editorData, title, excerpt, keyword) => {
    const suggestions = [];

    if (scores.titleScore < 80) {
      suggestions.push({
        type: "title",
        severity: "warning",
        message:
          keyword && !title.toLowerCase().includes(keyword.toLowerCase())
            ? `Include your keyword "${keyword}" in the title (50-60 chars ideal)`
            : "Title should be 50-60 characters for optimal SEO",
      });
    }

    if (scores.contentLengthScore < 60) {
      const currentWords = wordCounter.getStats(editorData).words;
      suggestions.push({
        type: "content",
        severity: "warning",
        message: `Add more content. Aim for 1000+ words (currently ${currentWords})`,
      });
    }

    if (scores.headingStructureScore < 60) {
      suggestions.push({
        type: "headings",
        severity: "info",
        message: keyword
          ? `Use one H1 heading with your keyword "${keyword}"`
          : "Use proper heading structure (H1, H2, H3)",
      });
    }

    if (scores.keywordDensityScore < 70) {
      const text = wordCounter.extractTextFromBlocks(editorData.blocks);
      const occurrences = seoAnalyzer.countKeywordOccurrences(text, keyword);
      suggestions.push({
        type: "keyword",
        severity: "warning",
        message: `Keyword "${keyword}" appears ${occurrences} times. Aim for 0.5-1.5% density`,
      });
    }

    if (scores.imageOptimizationScore < 70) {
      suggestions.push({
        type: "images",
        severity: "info",
        message: "Add alt text and captions to images",
      });
    }

    if (scores.excerptScore < 60) {
      suggestions.push({
        type: "excerpt",
        severity: "warning",
        message:
          keyword &&
          excerpt &&
          !excerpt.toLowerCase().includes(keyword.toLowerCase())
            ? `Include "${keyword}" in excerpt (120-160 chars)`
            : "Add a meta description of 120-160 characters",
      });
    }

    return suggestions;
  },

  getScoreColor: (score) => {
    if (score >= 80) return "#2ecc71";
    if (score >= 60) return "#f39c12";
    return "#e74c3c";
  },

  getScoreLabel: (score) => {
    if (score >= 80) return "Excellent";
    if (score >= 60) return "Good";
    if (score >= 40) return "Fair";
    return "Needs Work";
  },
};

// Add SEO score to word count display
function updateWordCountWithSEO(stats, seoScore) {
  updateWordCount(stats);

  if (seoScore) {
    const scoreValue = document.getElementById("seo-score-value");
    const scoreFill = document.getElementById("seo-bar-fill");
    const suggestionsContainer = document.getElementById(
      "seo-suggestions-container",
    );

    if (scoreValue) {
      scoreValue.textContent = seoScore.overall;
    }

    if (scoreFill) {
      const color = seoAnalyzer.getScoreColor(seoScore.overall);
      scoreFill.style.width = `${seoScore.overall}%`;
      scoreFill.style.background = color;
    }

    if (suggestionsContainer) {
      if (seoScore.suggestions.length > 0) {
        suggestionsContainer.innerHTML = `
          <div class="seo-suggestions">
            <div class="suggestions-title">Suggestions:</div>
            ${seoScore.suggestions
              .map(
                (s) => `
              <div class="suggestion-item ${s.severity}">
                <i class="fas fa-${s.severity === "warning" ? "exclamation-triangle" : "info-circle"}"></i>
                <span>${s.message}</span>
              </div>
            `,
              )
              .join("")}
          </div>
        `;
      } else {
        suggestionsContainer.innerHTML = `
          <div class="no-suggestions">Great! No major SEO issues found.</div>
        `;
      }
    }
  }
}

function setupEventHandlers(editor) {
  // Featured Image Upload Handler - Now just stores the file for later
  const featuredImageInput = document.getElementById("featuredImageUpload");
  window.featuredImageFile = null;

  if (featuredImageInput) {
    featuredImageInput.addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (!file) return;

      // Store the file for later upload during save
      window.featuredImageFile = file;

      console.log("Featured image selected, will upload on save:", file.name);
    });
  }

  // NEW: Listen to title and excerpt changes for SEO recalculation
  const updateSEO = debounce(() => {
    if (window.editorInstance) {
      window.editorInstance.save().then((data) => {
        const stats = wordCounter.getStats(data);
        const title = document.getElementById("postTitle")?.value || "";
        const keyword = document.getElementById("postKeyword")?.value || "";
        const excerpt = document.getElementById("postExcerpt")?.value || "";
        const seoScore = seoAnalyzer.analyze(data, title, excerpt, keyword);

        updateWordCountWithSEO(stats, seoScore);
      });
    }
  }, 1000);

  document.getElementById("postTitle")?.addEventListener("input", updateSEO);
  document.getElementById("postExcerpt")?.addEventListener("input", updateSEO);

  // Save button handler (Create & Update)
  document
    .getElementById("saveBtn")
    ?.addEventListener("click", async function () {
      const btn = this;
      const isUpdate = !!editingPostId;
      const isPage = currentEditingType === "page";
      const originalIcon = isUpdate
        ? '<i class="fas fa-check"></i>'
        : '<i class="fab fa-wordpress"></i>';

      try {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;
        btn.title = isUpdate ? "Updating..." : "Publishing...";

        // 1. Upload featured image if selected
        let featuredImageId = null;
        if (window.featuredImageFile) {
          try {
            const uploadResult = await uploadFeaturedImage(
              window.featuredImageFile,
            );
            if (uploadResult.success) featuredImageId = uploadResult.id;
          } catch (error) {
            console.warn(
              "Featured image upload failed, continuing without it:",
              error,
            );
          }
        }

        // 2. Get & process editor data
        const outputData = await window.editorInstance.save();

        console.log(
          "🔍 FULL EDITOR DATA:",
          JSON.stringify(outputData, null, 2),
        );

        // Find blocks with colored text
        outputData.blocks.forEach((block, idx) => {
          if (
            block.data?.text?.includes("style") ||
            block.data?.text?.includes("span")
          ) {
            console.log(
              `🎨 Block ${idx} (${block.type}) has styled content:`,
              block.data.text,
            );
          }
        });

        const updatedData = await uploadPendingImages(outputData);
        const filteredData = {
          ...updatedData,
          blocks: updatedData.blocks.filter((block) => {
            if (!block?.data) return false;
            if (block.type === "paragraph") {
              const text = block.data.text?.trim() || "";
              return text.length > 0 && !/^[\s<br\/>]*$/.test(text);
            }
            return true; // Keep non-paragraph blocks as-is
          }),
        };
        const htmlContent = await convertEditorJsToHTML(filteredData);

        // 3. Collect form data
        const title = document.getElementById("postTitle")?.value || "Untitled";
        const excerpt = document.getElementById("postExcerpt")?.value || "";
        const status = document.getElementById("postStatus")?.value || "draft";
        const keyword = document.getElementById("postKeyword")?.value || "";
        let slug = document.getElementById("postSlug")?.value?.trim();
        if (!slug && title) {
          slug = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        }

        // 4. Build payload with SEO plugin support
        const payload = {
          title,
          slug,
          content: htmlContent,
          status,
          excerpt,
          featured_media: featuredImageId || 0,
        };

        payload.meta = payload.meta || {}; // Ensure meta object exists

        if (keyword) {
          payload.meta._yoast_wpseo_focuskw = keyword;
          payload.meta.rank_math_focus_keyword = keyword;
        }
        if (excerpt) {
          payload.meta._yoast_wpseo_metadesc = excerpt;
          payload.meta._yoast_wpseo_title = title;
        }

        // ✅ NEW: Capture Page Options
        if (currentEditingType === "page") {
          payload.meta = {
            ...(payload.meta || {}),
            _is_sea_page: document.getElementById("seaPageToggle")?.checked
              ? 1
              : 0,
            _full_width_page: document.getElementById("fullWidthToggle")
              ?.checked
              ? 1
              : 0,
          };
        }

        // 5. API Call (WP REST uses POST for both create & update)
        const config = getActiveConfig();
        const token = tokenManagerMultiSite.getToken();
        const baseEndpoint = isPage
          ? `${config.WORDPRESS_API}/pages`
          : `${config.WORDPRESS_API}/posts`;
        const targetUrl = editingPostId
          ? `${baseEndpoint}/${editingPostId}`
          : baseEndpoint;

        const response = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`WordPress API ${response.status}: ${errText}`);
        }

        const result = await response.json();

        // 6. Success UI & State Management
        btn.innerHTML = '<i class="fas fa-check"></i>';
        btn.title = "Success!";
        alert(
          `✅ ${isPage ? "Page" : "Post"} ${isUpdate ? "updated" : "published"} successfully!`,
        );

        // If it was a new item, lock to edit mode & persist type
        // ✅ NEW: Clear editor & reset state after successful publish/update
        resetEditorState();

        window.featuredImageFile = null;
        const featInput = document.getElementById("featuredImageUpload");
        if (featInput) featInput.value = "";
      } catch (error) {
        console.error("Publish/Update failed:", error);
        btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
        btn.title = "Failed";
        alert(`❌ Operation failed: ${error.message}`);
      } finally {
        setTimeout(() => {
          const isUpdateNow = !!editingPostId;
          btn.innerHTML = isUpdateNow
            ? '<i class="fas fa-check"></i>'
            : '<i class="fab fa-wordpress"></i>';
          btn.disabled = false;
          btn.title = isUpdateNow ? "Update Post" : "Publish to WordPress";
        }, 2000);
      }
    });

  // Clear button handler
  document.getElementById("clearBtn")?.addEventListener("click", function () {
    if (
      confirm(
        "Are you sure you want to clear the editor? All unsaved content will be lost.",
      )
    ) {
      editor.clear();

      // Clear sidebar fields
      clearSidebarFields();

      localStorage.removeItem("editorjs-content");

      // Also clear featured image
      window.featuredImageFile = null;
      if (featuredImageInput) {
        featuredImageInput.value = "";
      }

      setTimeout(() => {
        editor.blocks.insert("paragraph", {
          text: "Editor cleared. Start typing your new content here...",
        });
      }, 100);
    }
  });

  // Toolbar buttons
  const toolbarHandlers = {
    "heading-btn": () =>
      editor.blocks.insert("header", { text: "New Heading", level: 2 }),

    // FIXED: Triggers Editor.js native image upload dialog
    "image-btn": () => editor.blocks.insert("image"),

    // FIXED: Inserts a LinkTool block (resolves URL via configured endpoint)
    "link-btn": () => editor.blocks.insert("linkTool"),

    "list-btn": () =>
      editor.blocks.insert("list", {
        style: "unordered",
        items: ["Item 1", "Item 2"],
      }),

    "quote-btn": () =>
      editor.blocks.insert("quote", { text: "Enter quote", caption: "Author" }),
  };

  Object.entries(toolbarHandlers).forEach(([id, handler]) => {
    document.getElementById(id)?.addEventListener("click", handler);
  });
}

// Export functions (maintain backward compatibility)
window.siteManager = siteManager;
window.getActiveConfig = getActiveConfig;
window.tokenManagerMultiSite = tokenManagerMultiSite;
window.createSiteSwitcher = createSiteSwitcher;
window.seoAnalyzer = seoAnalyzer;
window.updateWordCountWithSEO = updateWordCountWithSEO;

// Expose managers for external access
window.authManager = authManager;
window.imageUploader = imageUploader;

// Network Status Indicator
function updateNetworkStatus() {
  const statusBar = document.querySelector(".status-bar");
  if (!navigator.onLine) {
    if (statusBar) {
      statusBar.style.background = "#e74c3c";
      statusBar.innerHTML = `<span>⚠️ Offline Mode - Changes saved locally</span>`;
    }
  } else {
    if (statusBar) {
      statusBar.style.background = "var(--accent-color)";
      // Restore original content or just "Online"
      statusBar.innerHTML = `<span>✅ Online</span>`;
    }
  }
}

window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);
updateNetworkStatus(); // Init

// ✅ NEW: Handle app/window close with unsaved guard
// window.addEventListener("beforeunload", (e) => {
//   if (hasUnsavedChanges) {
//     e.preventDefault();
//     e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
//   } else {
//     resetEditorState();
//   }
// });

// Main Initialization
document.addEventListener("DOMContentLoaded", () => {
  // Theme Toggle Injection
  const header = document.querySelector(".app-header");
  if (header) {
    const toggle = document.createElement("button");
    toggle.className = "theme-toggle";
    toggle.innerHTML = `<i class="fas fa-moon"></i> <span id="theme-label">Dark Mode</span>`;
    toggle.addEventListener("click", () => {
      const isDark =
        document.documentElement.getAttribute("data-theme") === "dark";
      document.documentElement.setAttribute(
        "data-theme",
        isDark ? "light" : "dark",
      );
      document.getElementById("theme-label").textContent = isDark
        ? "Light Mode"
        : "Dark Mode";
      localStorage.setItem("theme", isDark ? "light" : "dark");
    });
    header.appendChild(toggle);
    const saved = localStorage.getItem("theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved);
    document.getElementById("theme-label").textContent =
      saved === "dark" ? "Dark Mode" : "Light Mode";
  }

  // ✅ Auto-update listener using exposed API
  if (window.electronAPI) {
    // Listen for update available
    window.electronAPI.onUpdateAvailable(() => {
      console.log("📦 Update available event received"); // ADD THIS
      showToast("📦 Update available! Downloading in background...", "info");
    });

    // Listen for update downloaded
    window.electronAPI.onUpdateDownloaded(() => {
      showUpdatePrompt();
    });

    // Listen for errors
    window.electronAPI.onUpdateError((error) => {
      console.error("🛑 Update error:", error); // ADD THIS
      const msg =
        typeof error === "string"
          ? error
          : error?.message || JSON.stringify(error) || "Unknown error";

      console.warn("⚠️ Auto-update blocked:", msg);
      showToast(`⚠️ Update failed: ${msg}`, "warning");
    });

    // Optional: Check for updates on load
    window.electronAPI.checkForUpdates();
  }

  // View Toggles
  document
    .getElementById("view-editor-btn")
    ?.addEventListener("click", () => switchView("editor"));
  document
    .getElementById("view-library-btn")
    ?.addEventListener("click", () => switchView("library"));

  if (typeof EditorJS === "undefined") {
    console.error("Editor.js missing");
    return;
  }
  initializeEditor().then((editor) => {
    if (editor) {
      /* Add logout if needed */
      addLogoutButton();
    }
  });
  setupCancelEditButton();
});

// Helper: Show non-blocking toast notification
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span><button class="toast-close">&times;</button>`;
  toast.style.cssText = `
    position: fixed; bottom: 40px; right: 20px; 
    background: ${type === "warning" ? "#f39c12" : type === "error" ? "#e74c3c" : "#007acc"};
    color: white; padding: 12px 20px; border-radius: 6px; 
    display: flex; align-items: center; gap: 12px; z-index: 9999;
    animation: slideIn 0.3s ease;
  `;
  document.body.appendChild(toast);

  toast
    .querySelector(".toast-close")
    ?.addEventListener("click", () => toast.remove());
  setTimeout(() => toast.remove(), 5000);
}

// Helper: Show restart prompt when update is ready
function showUpdatePrompt() {
  if (document.getElementById("update-prompt")) return; // Avoid duplicates

  const prompt = document.createElement("div");
  prompt.id = "update-prompt";
  prompt.className = "update-prompt";
  prompt.innerHTML = `
    <div class="update-prompt-content">
      <p>✅ New version downloaded!</p>
      <div class="update-prompt-actions">
        <button id="restart-now-btn" class="btn-primary">Restart Now</button>
        <button id="restart-later-btn" class="btn-secondary">Later</button>
      </div>
    </div>
  `;
  prompt.style.cssText = `
    position: fixed; bottom: 20px; right: 20px;
    background: var(--bg-secondary); border: 1px solid var(--border-color);
    border-radius: 8px; padding: 16px; z-index: 10000;
    box-shadow: var(--shadow-md);
  `;
  document.body.appendChild(prompt);

  document.getElementById("restart-now-btn")?.addEventListener("click", () => {
    window.electronAPI?.restartApp();
  });

  document
    .getElementById("restart-later-btn")
    ?.addEventListener("click", () => {
      prompt.remove();
    });
}

// TODO: Consider adding a schedule publish feature to allow users to set a future date/time for publishing posts.
// TODO: Add support for custom taxonomies (categories, tags) when creating posts.
// TODO: Optimize image uploads by resizing/compressing images before uploading to WordPress.
// TODO: Consider adding keyboard shortcuts for common actions (save, publish, insert block types).
// TODO: Consider adding support for custom CSS classes on blocks for advanced styling options.
// TODO: Consider adding a feature to insert galleries of images.
// TODO: Consider adding video upload support directly to WordPress media library.
// TODO: Consider adding drag-and-drop support for reordering blocks within the editor.
// TODO: Consider adding generate with ai feature to help users create content faster.
// TODO: Consider adding improve with ai feature to help users enhance existing content.
// TODO: Consider adding a "Preview" feature that allows users to see how their post will look before publishing.
// TODO: Consider adding multi-user support with role-based access control.
// TODO: Consider adding autosave versioning to allow users to revert to previous versions of their content.
// TODO: Consider adding localization support to make the editor usable in multiple languages.
