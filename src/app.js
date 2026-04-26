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

import "./style.css";

import { HtmlToEditorJs } from "./converters/HtmlToEditorJs.js";
import { PostManager } from "./managers/PostManager.js";
import { PageManager } from "./managers/PageManager.js";
import { LibraryView } from "./components/LibraryView.js";
import { CacheManager, cache } from "./utils/CacheManagers.js";

// Track if we're editing an existing post
let editingPostId = null;

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
    ];
    const allowedAttributes = {
      a: ["href", "target", "rel"],
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

              // Special handling for href
              if (attr === "href") {
                value = securityUtils.sanitizeUrl(value);
                if (!value) continue;
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
    return regex.test(dataUrl.split(",")[0]);
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
  console.log("🔧 Blog Publisher cache utils available: window.bpCache");
}

// ====================================
// MULTI-SITE MANAGEMENT
// ====================================

const siteManager = {
  /**
   * Get all saved sites
   */
  getSites: () => {
    try {
      const sites = localStorage.getItem("wp_sites");
      return sites ? JSON.parse(sites) : [];
    } catch (e) {
      console.error("Failed to load sites:", e);
      return [];
    }
  },

  /**
   * Save a site configuration
   */
  saveSite: (site) => {
    const sites = siteManager.getSites();
    const existingIndex = sites.findIndex((s) => s.id === site.id);

    if (existingIndex >= 0) {
      sites[existingIndex] = site;
    } else {
      sites.push(site);
    }

    localStorage.setItem("wp_sites", JSON.stringify(sites));
  },

  /**
   * Remove a site
   */
  removeSite: (siteId) => {
    const sites = siteManager.getSites();
    const filtered = sites.filter((s) => s.id !== siteId);
    localStorage.setItem("wp_sites", JSON.stringify(filtered));
  },

  /**
   * Get current active site
   */
  getActiveSite: () => {
    const siteId = sessionStorage.getItem("active_site_id");
    if (!siteId) return null;

    const sites = siteManager.getSites();
    return sites.find((s) => s.id === siteId) || null;
  },

  /**
   * Set active site
   */
  setActiveSite: (siteId) => {
    sessionStorage.setItem("active_site_id", siteId);
  },

  /**
   * Create a new site object
   */
  createSite: (name, url, username, token) => {
    return {
      id: `site-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: name,
      url: url,
      username: username,
      token: token,
      createdAt: new Date().toISOString(),
    };
  },
};

// Configuration - should be loaded from environment in production
const getActiveConfig = () => {
  const activeSite = siteManager.getActiveSite();

  if (activeSite) {
    return {
      WORDPRESS_API: `${activeSite.url}/wp-json/wp/v2`,
      WORDPRESS_SITE_URL: activeSite.url,
      MAX_IMAGE_SIZE: 5242880,
      ALLOWED_IMAGE_TYPES: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
    };
  }

  // Fallback to default
  return {
    WORDPRESS_API: "https://unabo.be/wp-json/wp/v2",
    WORDPRESS_SITE_URL: "https://unabo.be",
    MAX_IMAGE_SIZE: 5242880,
    ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  };
};

// PostManager factory - reuses existing config & auth systems
function createPostManager() {
  const config = getActiveConfig();
  const token = tokenManagerMultiSite.getToken();

  if (!config.WORDPRESS_API)
    throw new Error("No active WordPress site configured");
  if (!token) throw new Error("Authentication required. Please login first.");

  return new PostManager(config.WORDPRESS_API, token);
}

let libraryViewInstance = null;

function initLibraryView() {
  const container = document.getElementById("library-view");
  if (!container) return;

  // Ensure single instance per session
  if (!window.libraryInstance) {
    const config = getActiveConfig();
    const token = tokenManagerMultiSite.getToken();
    if (!config.WORDPRESS_API || !token) return; // Safety check

    // Instantiate both managers with shared config/auth
    const postManager = new PostManager(config.WORDPRESS_API, token);
    const pageManager = new PageManager(config.WORDPRESS_API, token);

    window.libraryInstance = new LibraryView(
      container,
      { post: postManager, page: pageManager }, // Manager map
      (post) => {
        switchView("editor");
        loadPostIntoEditor(post);
      },
    );
  } else {
    // Refresh data when switching back to library
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

// Enhanced token manager for Application Passwords
const tokenManagerMultiSite = {
  getToken: () => {
    const activeSite = siteManager.getActiveSite();
    return activeSite ? activeSite.token : "";
  },

  setToken: (token) => {
    const activeSite = siteManager.getActiveSite();
    if (activeSite) {
      activeSite.token = token;
      siteManager.saveSite(activeSite);
    }
  },

  clearToken: () => {
    const activeSite = siteManager.getActiveSite();
    if (activeSite) {
      activeSite.token = "";
      siteManager.saveSite(activeSite);
    }
  },

  validateToken: async () => {
    const token = tokenManagerMultiSite.getToken();
    if (!token) return false;

    const config = getActiveConfig();
    try {
      const response = await fetch(
        `${config.WORDPRESS_SITE_URL}/wp-json/wp/v2/users/me`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${token}`,
            "Content-Type": "application/json",
          },
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  },
};

// Image processing utilities
const imageUtils = {
  base64ToBlob: (base64Data) => {
    const parts = base64Data.split(";base64,");
    const contentType = parts[0].split(":")[1];
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);

    for (let i = 0; i < rawLength; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }

    return new Blob([uInt8Array], { type: contentType });
  },

  validateImageFile: (file) => {
    const CONFIG = getActiveConfig();
    if (!CONFIG.ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error(
        `Invalid image type. Allowed: ${CONFIG.ALLOWED_IMAGE_TYPES.join(", ")}`,
      );
    }

    if (file.size > CONFIG.MAX_IMAGE_SIZE) {
      alert("The image is too large. Maximum size is 5MB.");
      throw new Error(
        `Image too large. Maximum size: ${
          CONFIG.MAX_IMAGE_SIZE / 1024 / 1024
        }MB`,
      );
    }

    return true;
  },
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
          html += `<p>${paragraphText.replace(/\n/g, "<br>")}</p>`;
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

            html += `<figure class="wp-block-image">
              <img src="${cleanUrl}" alt="${alt}" ${srcset} sizes="(max-width: 768px) 100vw, 1200px" loading="lazy" />
              ${caption ? `<figcaption>${caption}</figcaption>` : ""}
            </figure>`;
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

// Upload pending images to WordPress
async function uploadPendingImages(editorData) {
  if (!window.pendingUploads || window.pendingUploads.size === 0) {
    return editorData;
  }

  const token = tokenManagerMultiSite.getToken(); // UPDATED
  if (!token) {
    throw new Error("Authentication required");
  }

  const config = getActiveConfig(); // UPDATED
  const updatedData = JSON.parse(JSON.stringify(editorData));

  for (let i = 0; i < updatedData.blocks.length; i++) {
    const block = updatedData.blocks[i];

    if (block.type === "image" && block.data?.file?.pending) {
      const fileId = block.data.file.id;
      const file = window.pendingUploads.get(fileId);

      if (file) {
        try {
          console.log(
            `Uploading image to ${config.WORDPRESS_SITE_URL}: ${file.name}`,
          );

          const formData = new FormData();
          formData.append("file", file);

          const uploadResponse = await fetch(`${config.WORDPRESS_API}/media`, {
            method: "POST",
            headers: {
              Authorization: `Basic ${token}`,
            },
            body: formData,
          });

          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(
              `Upload failed: ${uploadResponse.status} - ${errorText}`,
            );
          }

          const mediaData = await uploadResponse.json();

          block.data.file = {
            url: mediaData.source_url,
            id: mediaData.id,
            pending: false,
            sizes: mediaData.media_details?.sizes || {},
          };

          window.pendingUploads.delete(fileId);

          console.log(`Image uploaded successfully: ${mediaData.source_url}`);
        } catch (error) {
          console.error(`Failed to upload image ${fileId}:`, error);
          throw new Error(`Failed to upload image: ${error.message}`);
        }
      }
    }
  }

  return updatedData;
}

// Function to handle featured image upload
async function uploadFeaturedImage(file) {
  try {
    const token = tokenManagerMultiSite.getToken();
    if (!token) {
      throw new Error("Authentication required. Please login first.");
    }

    const config = getActiveConfig();

    // Validate the image file
    imageUtils.validateImageFile(file);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", file.name);
    formData.append("alt_text", file.name);

    const response = await fetch(`${config.WORDPRESS_API}/media`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Featured image upload failed: ${response.status} - ${errorText}`,
      );
    }

    const mediaData = await response.json();

    return {
      success: true,
      id: mediaData.id,
      url: mediaData.source_url,
      data: mediaData,
    };
  } catch (error) {
    console.error("Featured image upload error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Post to WordPress
async function postToWordPress(htmlContent, postData, featuredImageId = null) {
  try {
    const token = tokenManagerMultiSite.getToken();
    if (!token) throw new Error("Authentication required.");

    const config = getActiveConfig();
    const canPublish = await checkUserCapability("publish_posts");

    // Build basic payload
    const payload = {
      title: securityUtils.escapeHtml(postData.title || "Untitled"),
      slug: (postData.slug || postData.title || "untitled")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
      content: htmlContent,
      status: ["publish", "draft", "pending"].includes(postData.status)
        ? postData.status
        : "draft",
      excerpt: securityUtils.escapeHtml(postData.excerpt || ""),
      featured_media: featuredImageId || 0,
    };

    // Add Yoast SEO meta fields (standard WP REST way)
    if (postData.yoast) {
      // Note: Requires Yoast SEO plugin to be active on the target site.
      // If meta fields are private, this will be ignored by WP API.
      payload.meta = {
        _yoast_wpseo_focuskw: postData.yoast.focusKeyword || "",
        _yoast_wpseo_metadesc:
          postData.yoast.metaDescription || postData.excerpt || "",
        _yoast_wpseo_title: postData.yoast.title || postData.title || "",
      };

      // Optional: Attempt yoast_head_json if supported by plugin version
      try {
        payload.yoast_head_json = {
          title: postData.yoast.title,
          description: postData.yoast.metaDescription,
        };
      } catch (e) {
        // Ignore if structure fails
      }
    }

    const response = await fetch(`${config.WORDPRESS_API}/posts`, {
      method: "POST",
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

// Authentication with WordPress
async function authenticateWithWordPress(username, applicationPassword) {
  try {
    const token = btoa(`${username}:${applicationPassword}`);

    const CONFIG = getActiveConfig();

    const response = await fetch(
      `${CONFIG.WORDPRESS_SITE_URL}/wp-json/wp/v2/users/me`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Invalid username or application password");
      }
      throw new Error(
        `Authentication failed: ${response.status} ${response.statusText}`,
      );
    }

    const userData = await response.json();

    tokenManagerMultiSite.setToken(token);
    return {
      success: true,
      user: {
        id: userData.id,
        name: userData.name,
        username: userData.username,
        capabilities: userData.capabilities || {},
      },
    };
  } catch (error) {
    console.error("Authentication error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Check user capabilities
async function checkUserCapability(capability) {
  try {
    const token = tokenManagerMultiSite.getToken();
    if (!token) return false;
    const config = getActiveConfig();

    const response = await fetch(
      `${config.WORDPRESS_SITE_URL}/wp-json/wp/v2/users/me?context=edit`,
      {
        headers: {
          Authorization: `Basic ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) return false;

    const userData = await response.json();
    const roles = userData.roles || [];

    // Role-based checks
    if (capability === "publish_posts") {
      return ["administrator", "editor", "author"].some((r) =>
        roles.includes(r),
      );
    }
    if (capability === "edit_posts") {
      return ["administrator", "editor", "author", "contributor"].some((r) =>
        roles.includes(r),
      );
    }
    return false;
  } catch (error) {
    console.error("Error checking capability:", error);
    return false;
  }
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
          inlineToolbar: true,
          config: {
            placeholder: "Enter a header",
            levels: [1, 2, 3, 4, 5, 6],
            defaultLevel: 2,
          },
        },
        paragraph: {
          class: Paragraph,
          inlineToolbar: true,
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
        list: {
          class: List,
          inlineToolbar: true,
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
    // 1. Convert WP HTML to Editor.js JSON
    const converter = new HtmlToEditorJs();
    let editorData = converter.convert(post.contentRaw || "");

    // render() automatically replaces existing content.
    // Calling clear() before render() causes a race condition in Editor.js
    // where internal block removal promises conflict with new block insertion.
    if (editorData.blocks.length === 0) {
      editorData = getDefaultData();
    }

    // 2. Render blocks in Editor.js (replaces content safely)
    await window.editorInstance.render(editorData);

    // 3. Safely populate sidebar fields (prevents null crashes)
    const titleEl = document.getElementById("postTitle");
    if (titleEl) titleEl.value = post.titleRaw || "";

    const excerptEl = document.getElementById("postExcerpt");
    if (excerptEl) excerptEl.value = post.excerptRaw || "";

    const slugEl = document.getElementById("postSlug");
    if (slugEl) slugEl.value = post.slug || "";

    const statusEl = document.getElementById("postStatus");
    if (statusEl) statusEl.value = post.status || "draft";

    // 4. Activate edit mode UI
    editingPostId = post.id;
    updateEditModeUI(true);

    // 5. Switch to editor view
    switchView("editor");

    // 6. Trigger SEO/Word count update after DOM settles
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
      const titleEl = document.getElementById("postTitle");
      if (titleEl) titleEl.value = "";
      const excerptEl = document.getElementById("postExcerpt");
      if (excerptEl) excerptEl.value = "";
      const slugEl = document.getElementById("postSlug");
      if (slugEl) slugEl.value = "";

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
    // Edit Mode
    saveBtn.innerHTML = '<i class="fas fa-check"></i>';
    saveBtn.title = "Update Post";
    cancelBtn.style.display = "flex"; // Show icon button
  } else {
    // Create Mode
    saveBtn.innerHTML = '<i class="fab fa-wordpress"></i>';
    saveBtn.title = "Publish to WordPress";
    cancelBtn.style.display = "none"; // Hide icon button
  }
}

// Update the login modal to include Application Password instructions
async function showLoginModal() {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "wp-login-modal";
    modal.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3>WordPress Login</h3>
            <button class="modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label for="login-username">Username</label>
              <input type="text" id="login-username" placeholder="Your WordPress username" autocomplete="username">
            </div>
            <div class="form-group">
              <label for="login-app-password">Application Password</label>
              <input type="password" id="login-app-password" placeholder="Your 24-character application password" autocomplete="current-password">
              <small class="hint">This is NOT your regular WordPress password</small>
            </div>
            <div class="form-group remember-me">
              <label>
                <input type="checkbox" id="login-remember"> Remember me (not recommended on shared computers)
              </label>
            </div>
            <div class="form-actions">
              <button id="login-submit" class="btn-primary">
                <span class="btn-text">Login</span>
                <span class="spinner" style="display: none;">⌛</span>
              </button>
              <button id="login-cancel" class="btn-secondary">Cancel</button>
            </div>
            <div class="login-status" id="login-status"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const loginSubmit = document.getElementById("login-submit");
    const loginCancel = document.getElementById("login-cancel");
    const modalClose = modal.querySelector(".modal-close");
    const loginStatus = document.getElementById("login-status");

    let isLoggingIn = false;

    const handleLogin = async () => {
      if (isLoggingIn) return;

      const username = document.getElementById("login-username").value.trim();
      const appPassword = document
        .getElementById("login-app-password")
        .value.trim();
      const remember = document.getElementById("login-remember").checked;

      if (!username || !appPassword) {
        showLoginStatus(
          "Please enter both username and application password",
          "error",
        );
        return;
      }

      isLoggingIn = true;
      loginSubmit.disabled = true;
      loginSubmit.querySelector(".btn-text").textContent = "Logging in...";
      loginSubmit.querySelector(".spinner").style.display = "inline-block";

      try {
        const result = await authenticateWithWordPress(username, appPassword);

        if (result.success) {
          // Store token with remember preference
          tokenManagerMultiSite.setToken(
            btoa(`${username}:${appPassword}`),
            remember,
          );
          showLoginStatus("Login successful!", "success");

          // Close modal after brief delay
          setTimeout(() => {
            document.body.removeChild(modal);
            resolve(true);
          }, 1000);
        } else {
          showLoginStatus(result.error || "Login failed", "error");
          isLoggingIn = false;
          loginSubmit.disabled = false;
          loginSubmit.querySelector(".btn-text").textContent = "Login";
          loginSubmit.querySelector(".spinner").style.display = "none";
        }
      } catch (error) {
        showLoginStatus(error.message || "An error occurred", "error");
        isLoggingIn = false;
        loginSubmit.disabled = false;
        loginSubmit.querySelector(".btn-text").textContent = "Login";
        loginSubmit.querySelector(".spinner").style.display = "none";
      }
    };

    const showLoginStatus = (message, type) => {
      loginStatus.textContent = message;
      loginStatus.className = `login-status ${type}`;
      loginStatus.style.display = "block";
    };

    loginSubmit.addEventListener("click", handleLogin);

    const handleCancel = () => {
      document.body.removeChild(modal);
      resolve(false);
    };

    loginCancel.addEventListener("click", handleCancel);
    modalClose.addEventListener("click", handleCancel);

    // Handle Enter key
    modal.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !isLoggingIn) {
        handleLogin();
      }
    });

    // Auto-focus username field
    setTimeout(() => {
      document.getElementById("login-username").focus();
    }, 100);
  });
}

// Add logout functionality
function addLogoutButton() {
  const toolbar = document.querySelector(".editor-toolbar");
  if (!toolbar) return;

  const logoutBtn = document.createElement("button");
  logoutBtn.id = "logout-btn";
  logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
  logoutBtn.className = "logout-button";
  logoutBtn.addEventListener("click", async () => {
    if (confirm("Are you sure you want to logout?")) {
      tokenManagerMultiSite.clearToken();
      location.reload(); // Reload to show login modal
    }
  });

  toolbar.appendChild(logoutBtn);
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

// Create site switcher UI
function createSiteSwitcher() {
  const sites = siteManager.getSites();
  const activeSite = siteManager.getActiveSite();

  const siteSwitcherHTML = `
    <div id="site-switcher-container" class="site-switcher-container">
      <div class="site-switcher-content">
        <i class="fas fa-globe"></i>
        <select id="site-selector" class="site-selector">
          ${sites
            .map(
              (site) => `
            <option value="${site.id}" ${activeSite && activeSite.id === site.id ? "selected" : ""}>
              ${site.name} (${site.url})
            </option>
          `,
            )
            .join("")}
        </select>
        <button id="manage-sites-btn" class="manage-sites-btn" title="Manage sites">
          <i class="fas fa-cog"></i>
        </button>
        <button id="add-site-btn" class="add-site-btn" title="Add new site">
          <i class="fas fa-plus"></i>
        </button>
      </div>
    </div>
  `;

  const toolbar = document.querySelector(".editor-toolbar") || document.body;
  toolbar.insertAdjacentHTML("afterbegin", siteSwitcherHTML);

  // Event listeners
  document
    .getElementById("site-selector")
    ?.addEventListener("change", handleSiteSwitch);
  document
    .getElementById("manage-sites-btn")
    ?.addEventListener("click", showManageSitesModal);
  document
    .getElementById("add-site-btn")
    ?.addEventListener("click", showAddSiteModal);
}

// Handle site switching
async function handleSiteSwitch(event) {
  const siteId = event.target.value;

  if (
    confirm("Switch to this site? Any unsaved changes will be kept locally.")
  ) {
    siteManager.setActiveSite(siteId);
    location.reload(); // Reload to apply new site config
  } else {
    // Revert selection
    const activeSite = siteManager.getActiveSite();
    if (activeSite) {
      event.target.value = activeSite.id;
    }
  }
}

// Show add site modal
async function showAddSiteModal() {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "wp-login-modal";
    modal.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Add New WordPress Site</h3>
            <button class="modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label for="site-name">Site Name</label>
              <input type="text" id="site-name" placeholder="My Blog" autocomplete="off">
              <small class="hint">A friendly name for this site</small>
            </div>
            <div class="form-group">
              <label for="site-url">Site URL</label>
              <input type="url" id="site-url" placeholder="https://example.com" autocomplete="url">
              <small class="hint">Your WordPress site URL (without trailing slash)</small>
            </div>
            <div class="form-group">
              <label for="site-username">Username</label>
              <input type="text" id="site-username" placeholder="admin" autocomplete="username">
            </div>
            <div class="form-group">
              <label for="site-app-password">Application Password</label>
              <input type="password" id="site-app-password" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" autocomplete="current-password">
              <small class="hint">24-character application password from WordPress</small>
            </div>
            <div class="form-actions">
              <button id="add-site-submit" class="btn-primary">
                <span class="btn-text">Add Site & Login</span>
                <span class="spinner" style="display: none;">⌛</span>
              </button>
              <button id="add-site-cancel" class="btn-secondary">Cancel</button>
            </div>
            <div class="login-status" id="add-site-status"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const submitBtn = document.getElementById("add-site-submit");
    const cancelBtn = document.getElementById("add-site-cancel");
    const closeBtn = modal.querySelector(".modal-close");
    const statusEl = document.getElementById("add-site-status");

    const handleSubmit = async () => {
      const name = document.getElementById("site-name").value.trim();
      const url = document
        .getElementById("site-url")
        .value.trim()
        .replace(/\/$/, "");
      const username = document.getElementById("site-username").value.trim();
      const appPassword = document
        .getElementById("site-app-password")
        .value.trim();

      if (!name || !url || !username || !appPassword) {
        showStatus("Please fill in all fields", "error");
        return;
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        showStatus("Please enter a valid URL", "error");
        return;
      }

      submitBtn.disabled = true;
      submitBtn.querySelector(".btn-text").textContent =
        "Testing connection...";
      submitBtn.querySelector(".spinner").style.display = "inline-block";

      try {
        // Test authentication
        const token = btoa(`${username}:${appPassword}`);
        const response = await fetch(`${url}/wp-json/wp/v2/users/me`, {
          method: "GET",
          headers: {
            Authorization: `Basic ${token}`,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(
            "Authentication failed. Please check your credentials.",
          );
        }

        // Create and save site
        const site = siteManager.createSite(name, url, username, token);
        siteManager.saveSite(site);
        siteManager.setActiveSite(site.id);

        showStatus("Site added successfully!", "success");

        setTimeout(() => {
          document.body.removeChild(modal);
          location.reload();
        }, 1000);
      } catch (error) {
        showStatus(error.message, "error");
        submitBtn.disabled = false;
        submitBtn.querySelector(".btn-text").textContent = "Add Site & Login";
        submitBtn.querySelector(".spinner").style.display = "none";
      }
    };

    const showStatus = (message, type) => {
      statusEl.textContent = message;
      statusEl.className = `login-status ${type}`;
      statusEl.style.display = "block";
    };

    const handleCancel = () => {
      document.body.removeChild(modal);
      resolve(false);
    };

    submitBtn.addEventListener("click", handleSubmit);
    cancelBtn.addEventListener("click", handleCancel);
    closeBtn.addEventListener("click", handleCancel);

    modal.addEventListener("keypress", (e) => {
      if (e.key === "Enter") handleSubmit();
    });
  });
}

// Show manage sites modal
function showManageSitesModal() {
  const sites = siteManager.getSites();
  const activeSite = siteManager.getActiveSite();

  const modal = document.createElement("div");
  modal.className = "wp-login-modal";
  modal.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header">
          <h3>Manage WordPress Sites</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="sites-list">
            ${
              sites.length === 0
                ? '<p class="no-sites">No sites configured yet.</p>'
                : sites
                    .map(
                      (site) => `
              <div class="site-item ${activeSite && activeSite.id === site.id ? "active" : ""}" data-site-id="${site.id}">
                <div class="site-info">
                  <div class="site-name">
                    ${site.name}
                    ${activeSite && activeSite.id === site.id ? '<span class="active-badge">Active</span>' : ""}
                  </div>
                  <div class="site-url">${site.url}</div>
                  <div class="site-meta">Username: ${site.username}</div>
                </div>
                <div class="site-actions">
                  ${
                    activeSite && activeSite.id === site.id
                      ? ""
                      : `
                    <button class="btn-sm btn-switch" data-site-id="${site.id}">
                      <i class="fas fa-exchange-alt"></i> Switch
                    </button>
                  `
                  }
                  <button class="btn-sm btn-danger btn-delete" data-site-id="${site.id}">
                    <i class="fas fa-trash"></i> Delete
                  </button>
                </div>
              </div>
            `,
                    )
                    .join("")
            }
          </div>
          <div class="form-actions" style="margin-top: 20px;">
            <button id="close-manage-modal" class="btn-primary">Close</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => document.body.removeChild(modal);

  modal.querySelector(".modal-close").addEventListener("click", closeModal);
  modal
    .querySelector("#close-manage-modal")
    .addEventListener("click", closeModal);

  // Switch site handlers
  modal.querySelectorAll(".btn-switch").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const siteId = e.currentTarget.dataset.siteId;
      if (confirm("Switch to this site?")) {
        siteManager.setActiveSite(siteId);
        location.reload();
      }
    });
  });

  // Delete site handlers
  modal.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const siteId = e.currentTarget.dataset.siteId;
      const site = sites.find((s) => s.id === siteId);

      if (confirm(`Delete "${site.name}"? This action cannot be undone.`)) {
        siteManager.removeSite(siteId);

        // If deleting active site, clear active and reload
        if (activeSite && activeSite.id === siteId) {
          sessionStorage.removeItem("active_site_id");
          location.reload();
        } else {
          closeModal();
          showManageSitesModal(); // Refresh the modal
        }
      }
    });
  });
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
    const lowerKeyword = keyword.toLowerCase();
    const regex = new RegExp(`\\b${lowerKeyword}\\b`, "gi");
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
  let featuredImageFile = null;

  if (featuredImageInput) {
    featuredImageInput.addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (!file) return;

      // Store the file for later upload during save
      featuredImageFile = file;

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

  // Save button handler (updated to handle featured image upload)
  document
    .getElementById("saveBtn")
    ?.addEventListener("click", async function () {
      const button = this;
      const originalText = button.innerHTML;
      try {
        button.innerHTML = " Processing...";
        button.disabled = true;

        // 1. Upload featured image if selected
        let featuredImageId = null;
        if (window.featuredImageFile) {
          try {
            console.log(
              "Uploading featured image:",
              window.featuredImageFile.name,
            );
            const uploadResult = await uploadFeaturedImage(
              window.featuredImageFile,
            );
            if (uploadResult.success) {
              featuredImageId = uploadResult.id;
            } else {
              throw new Error(uploadResult.error);
            }
          } catch (error) {
            alert(`Warning: Featured image failed. ${error.message}`);
          }
        }

        // 2. Get & process editor data
        const outputData = await window.editorInstance.save();
        const updatedData = await uploadPendingImages(outputData);
        const htmlContent = await convertEditorJsToHTML(updatedData);

        // 3. Collect post data
        const postInfo = {
          title: document.getElementById("postTitle")?.value || "Untitled",
          excerpt: document.getElementById("postExcerpt")?.value || "",
          status: document.getElementById("postStatus")?.value || "draft",
          slug: document.getElementById("postSlug")?.value || "",
          yoast: getAdvancedYoastData(),
        };

        if (editingPostId) {
          // ✅ UPDATE EXISTING POST
          const config = getActiveConfig();
          const token = tokenManagerMultiSite.getToken();
          const manager = new PostManager(`${config.WORDPRESS_API}`, token);

          await manager.updatePost(editingPostId, {
            title: postInfo.title,
            slug: postInfo.slug,
            content: htmlContent,
            status: postInfo.status,
            excerpt: postInfo.excerpt,
            featured_media: featuredImageId || 0,
          });

          alert(`Post #${editingPostId} updated successfully!`);
        } else {
          // ✅ CREATE NEW POST (Existing Flow)
          await postToWordPress(htmlContent, postInfo, featuredImageId);
          alert("Post published successfully!");
        }

        // Reset state on success
        editingPostId = null;
        updateEditModeUI(false);
        saveToLocalStorage(updatedData);

        // Clear temp files
        if (window.pendingUploads) window.pendingUploads.clear();
        window.featuredImageFile = null;
        const featInput = document.getElementById("featuredImageUpload");
        if (featInput) featInput.value = "";

        button.innerHTML = " Success!";
        setTimeout(() => {
          button.innerHTML = editingPostId
            ? " Update Post"
            : " Publish to WordPress";
          button.style.background = editingPostId
            ? "linear-gradient(to right, #2ecc71, #27ae60)"
            : "linear-gradient(to right, #4a6cf7, #6a11cb)";
          button.disabled = false;
        }, 2000);
      } catch (error) {
        console.error("Publish/Update failed:", error);
        button.innerHTML = " Failed";
        button.style.background = "linear-gradient(to right, #e74c3c, #c0392b)";
        button.disabled = false;
        alert(`Operation failed: ${error.message}`);
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
      localStorage.removeItem("editorjs-content");

      // Also clear featured image
      featuredImageFile = null;
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

// Export functions
window.siteManager = siteManager;
window.getActiveConfig = getActiveConfig;
window.tokenManagerMultiSite = tokenManagerMultiSite;
window.createSiteSwitcher = createSiteSwitcher;
window.seoAnalyzer = seoAnalyzer;
window.updateWordCountWithSEO = updateWordCountWithSEO;

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

// TODO: Consider adding a schedule publish feature to allow users to set a future date/time for publishing posts.
// TODO: Implement better error handling and user feedback for network issues during API calls.
// TODO: Add support for custom taxonomies (categories, tags) when creating posts.
// TODO: Consider adding integration with popular SEO plugins to help users optimize their content for search engines.
// TODO: Optimize image uploads by resizing/compressing images before uploading to WordPress.
// TODO: Consider adding keyboard shortcuts for common actions (save, publish, insert block types).
// TODO: Consider adding support for custom CSS classes on blocks for advanced styling options.
// TODO: Consider adding a way to view and manage previously published posts directly from the editor interface.
// TODO: Consider adding a feature to insert galleries of images.
// TODO: Consider adding video upload support directly to WordPress media library.
// TODO: Consider adding drag-and-drop support for reordering blocks within the editor.
// TODO: Consider adding generate with ai feature to help users create content faster.
// TODO: Consider adding improve with ai feature to help users enhance existing content.
// TODO: Consider adding a "Preview" feature that allows users to see how their post will look before publishing.
// TODO: Consider adding multi-user support with role-based access control.
// TODO: Consider adding autosave versioning to allow users to revert to previous versions of their content.
// TODO: Consider adding localization support to make the editor usable in multiple languages.
