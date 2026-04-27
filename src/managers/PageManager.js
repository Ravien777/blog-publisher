/**
 * PageManager.js
 * Handles WordPress Pages fetching, validation, sanitization, and caching.
 * Extends PostManager to reuse auth, sanitization, and error handling.
 */
import { PostManager } from "./PostManager.js";
import { cache } from "../utils/CacheManagers.js";

export class PageManager extends PostManager {
  constructor(apiUrl, authToken) {
    super(apiUrl, authToken);
  }

  async fetchPosts(options = {}) {
    const {
      status = "any",
      per_page = 20,
      page = 1,
      order = "desc",
      orderby = "date",
      search = "",
      useCache = true,
      fields = "minimal",
    } = options;

    // Reuse parent validation (ignore type param for pages endpoint)
    this.validateFetchOptions({
      status,
      per_page,
      page,
      order,
      orderby,
      type: "any",
    });

    const cacheKey = "pages_list";
    const cacheParams = { status, per_page, page, order, orderby, search };

    if (useCache) {
      const cached = cache.get(cacheKey, cacheParams);
      if (cached) return cached;
    }

    const params = new URLSearchParams({
      context: fields === "full" ? "edit" : "view",
      status,
      per_page: String(per_page),
      page: String(page),
      order,
      orderby,
      ...(search?.trim() ? { search: search.trim() } : {}),
      _fields:
        fields === "minimal"
          ? "id,title,date,modified,status,link,slug,excerpt,featured_media"
          : undefined,
    });

    const url = `${this.apiUrl}/pages?${params.toString()}`;
    const response = await this.safeFetch(url, {
      method: "GET",
      headers: this.defaultHeaders,
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

    if (useCache && fields === "minimal") {
      cache.set(cacheKey, result, 2 * 60 * 1000);
    }

    return result;
  }

  async fetchPostById(postId) {
    if (!Number.isInteger(postId) || postId < 1)
      throw new TypeError("Valid page ID is required");

    // ✅ Added 'type' to _fields
    const url = `${this.apiUrl}/pages/${postId}?context=edit&_fields=id,title,type,slug,content,excerpt,status,modified,author,featured_media,meta,yoast_head_json`;
    const response = await this.safeFetch(url, {
      method: "GET",
      headers: this.defaultHeaders,
      cache: "no-store",
    });
    const rawData = await response.json();
    return this.sanitizePostData([rawData])[0];
  }

  invalidatePostCache(postId) {
    cache.invalidate("pages_list");
    cache.delete(`page_${postId}`);
  }

  async deletePost(id) {
    if (!Number.isInteger(id) || id < 1)
      throw new TypeError("Valid page ID required");
    const response = await this.safeFetch(`${this.apiUrl}/pages/${id}`, {
      method: "DELETE",
      headers: this.defaultHeaders,
    });
    return response.ok;
  }

  async updatePost(id, data) {
    if (!Number.isInteger(id) || id < 1)
      throw new TypeError("Valid page ID required");
    if (!data || typeof data !== "object")
      throw new TypeError("Valid update data required");
    const response = await this.safeFetch(`${this.apiUrl}/pages/${id}`, {
      method: "POST",
      headers: this.defaultHeaders,
      body: JSON.stringify(data),
    });
    return response.json();
  }
}
