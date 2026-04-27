/**
 * PostManager.js
 * Handles WordPress post/page fetching, validation, sanitization, and pagination.
 * Designed as a standalone, testable OOP class that reuses existing auth/config patterns.
 */

import { cache } from "../utils/CacheManagers.js";

export class PostManager {
  /**
   * @param {string} apiUrl - Base WordPress REST API URL
   * @param {string} authToken - Base64 encoded Basic Auth token
   */
  constructor(apiUrl, authToken) {
    if (!apiUrl || typeof apiUrl !== "string") {
      throw new TypeError("WordPress API URL is required and must be a string");
    }
    if (!authToken || typeof authToken !== "string") {
      throw new TypeError(
        "Authentication token is required and must be a string",
      );
    }

    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.authToken = authToken;
    this.defaultHeaders = {
      "Content-Type": "application/json",
      Authorization: `Basic ${authToken}`,
    };
  }

  /**
   * Fetch posts with caching support
   * @param {Object} options - { status, per_page, page, order, orderby, search, type, useCache }
   * @returns {Promise<{posts: Array, pagination: Object}>}
   */
  async fetchPosts(options = {}) {
    const {
      status = "any",
      per_page = 20,
      page = 1,
      order = "desc",
      orderby = "date",
      search = "",
      type = "post",
      useCache = true, // NEW: enable caching by default
      fields = "minimal", // NEW: 'minimal' | 'full'
    } = options;

    this.validateFetchOptions({ status, per_page, page, order, orderby, type });

    // Cache key generation
    const cacheKey = `posts_list_${type}`;
    const cacheParams = { status, per_page, page, order, orderby, search };

    // Try cache first
    if (useCache) {
      const cached = cache.get(cacheKey, cacheParams);
      if (cached) {
        console.log(`[Cache HIT] ${cacheKey}`, cached.pagination);
        return cached;
      }
    }

    // Build API params - request minimal fields for list view
    const params = new URLSearchParams({
      context: fields === "full" ? "edit" : "view",
      status,
      per_page: String(per_page),
      page: String(page),
      order,
      orderby,
      type,
      ...(search.trim() ? { search: search.trim() } : {}),
      _fields:
        fields === "minimal"
          ? "id,title,type,date,modified,status,link,slug,excerpt,featured_media" // ✅ Added 'type'
          : undefined,
    });

    const url = `${this.apiUrl}/posts?${params.toString()}`;
    const response = await this.safeFetch(url, {
      method: "GET",
      headers: this.defaultHeaders,
      // Add cache-busting header if needed
      cache: useCache ? "force-cache" : "no-store",
    });

    const pagination = {
      currentPage: page,
      per_page,
      totalPages: parseInt(response.headers.get("X-WP-TotalPages") || "1", 10),
      totalPosts: parseInt(response.headers.get("X-WP-Total") || "0", 10),
    };

    const rawData = await response.json();
    const result = { posts: this.sanitizePostData(rawData), pagination };

    // Cache successful responses (list view only, not full edit data)
    if (useCache && fields === "minimal") {
      cache.set(cacheKey, result, 2 * 60 * 1000); // 2 min cache for lists
      console.log(`[Cache SET] ${cacheKey}`);
    }

    return result;
  }
  /**
   * Fetch single post with cache bypass (always fresh for editing)
   * @param {number} postId
   * @returns {Promise<Object>}
   */
  async fetchPostById(postId) {
    if (!Number.isInteger(postId) || postId < 1) {
      throw new TypeError("Valid post ID is required");
    }
    // ✅ Added 'type' to _fields
    const url = `${this.apiUrl}/posts/${postId}?context=edit&_fields=id,title,type,slug,content,excerpt,status,modified,author,featured_media,meta,yoast_head_json`;
    const response = await this.safeFetch(url, {
      method: "GET",
      headers: this.defaultHeaders,
      cache: "no-store",
    });
    const rawData = await response.json();
    return this.sanitizePostData([rawData])[0];
  }

  /**
   * Invalidate post-related cache after mutation
   * @param {number} postId
   * @param {string} type - 'post' | 'page'
   */
  invalidatePostCache(postId, type = "post") {
    // Invalidate list caches for this post type
    cache.invalidate(`posts_list_${type}`);

    // Invalidate specific post cache if it exists
    cache.delete(`post_${postId}`);

    console.log(`[Cache INVALIDATED] post #${postId} (${type})`);
  }

  /**
   * Sanitize & validate raw WP API response before exposing to UI
   * @param {Array} posts
   * @returns {Array}
   */
  sanitizePostData(posts) {
    if (!Array.isArray(posts)) return [];

    return posts
      .map((post) => {
        if (!post || typeof post.id !== "number") return null;

        const validStatuses = [
          "publish",
          "draft",
          "pending",
          "private",
          "trash",
          "future",
        ];
        const status = validStatuses.includes(post.status)
          ? post.status
          : "draft";

        return {
          id: post.id,
          title: this.escapeHtml(post.title?.rendered || "Untitled"),
          titleRaw: post.title?.raw || "",
          date: post.date || "",
          modified: post.modified || "",
          status,
          link: post.link || "",
          type: post.type || "post",
          author: post.author || 0,
          featured_media: post.featured_media || 0,
          slug: post.slug || "",
          excerpt: this.escapeHtml(post.excerpt?.rendered || ""),
          excerptRaw: post.excerpt?.raw || "",
          contentRaw: post.content?.raw || "", // Preserved for Editor.js conversion (Step 3)
          meta: post.meta || {},
          yoast_head_json: post.yoast_head_json || null,
        };
      })
      .filter(Boolean);
  }

  /**
   * Validate query parameters
   * @private
   */
  validateFetchOptions(opts) {
    const validStatuses = [
      "any",
      "publish",
      "future",
      "draft",
      "pending",
      "private",
      "trash",
    ];
    const validOrders = ["asc", "desc"];
    const validOrderby = ["date", "id", "include", "title", "slug", "modified"];

    if (!validStatuses.includes(opts.status))
      throw new TypeError("Invalid status");
    if (opts.per_page < 1 || opts.per_page > 100)
      throw new TypeError("per_page must be 1-100");
    if (opts.page < 1) throw new TypeError("page must be >= 1");
    if (!validOrders.includes(opts.order)) throw new TypeError("Invalid order");
    if (!validOrderby.includes(opts.orderby))
      throw new TypeError("Invalid orderby");
  }

  /**
   * Secure fetch wrapper with structured error handling
   * @private
   */
  async safeFetch(url, options) {
    const response = await fetch(url, options);

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        errorMsg = errorData.message || errorData.data?.details || errorMsg;
      } catch {
        const text = await response.text();
        errorMsg = text || errorMsg;
      }
      throw new Error(`WordPress API Error: ${errorMsg}`);
    }

    return response;
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} text
   * @returns {string}
   */
  escapeHtml(text) {
    if (!text || typeof text !== "string") return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Soft delete a post (moves to trash)
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  async deletePost(id) {
    if (!Number.isInteger(id) || id < 1)
      throw new TypeError("Valid post ID required");

    const response = await this.safeFetch(`${this.apiUrl}/posts/${id}`, {
      method: "DELETE",
      headers: this.defaultHeaders,
    });
    return response.ok;
  }

  /**
   * Update post fields
   * @param {number} id
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async updatePost(id, data) {
    if (!Number.isInteger(id) || id < 1)
      throw new TypeError("Valid post ID required");
    if (!data || typeof data !== "object")
      throw new TypeError("Valid update data required");

    const response = await this.safeFetch(`${this.apiUrl}/posts/${id}`, {
      method: "POST",
      headers: this.defaultHeaders,
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async updatePostStatus(id, status) {
    if (!Number.isInteger(id)) throw new TypeError("Valid ID required");
    const validStatuses = ["publish", "draft", "pending", "private"];
    if (!validStatuses.includes(status)) throw new TypeError("Invalid status");

    return this.updatePost(id, { status });
  }
}
