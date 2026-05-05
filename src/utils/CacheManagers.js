/**
 * CacheManager.js
 * Lightweight localStorage cache with TTL, namespace isolation, and auto-invalidation.
 * Designed for WordPress post/page list caching in WP Post Manager.
 */
export class CacheManager {
  constructor(namespace = "bp_cache", defaultTTL = 5 * 60 * 1000) {
    this.namespace = namespace;
    this.defaultTTL = defaultTTL; // 5 minutes default
    this.prefix = `${namespace}_`;
  }

  /**
   * Generate cache key from namespace + identifiers
   * @param {string} key
   * @param {Object} params - Optional query params for key differentiation
   * @returns {string}
   */
  _makeKey(key, params = {}) {
    const paramString = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    return `${this.prefix}${key}${paramString ? `?${paramString}` : ""}`;
  }

  /**
   * Set cache entry with optional TTL
   * @param {string} key
   * @param {*} value
   * @param {number} ttl - milliseconds
   */
  set(key, value, ttl = this.defaultTTL) {
    try {
      const entry = {
        value,
        timestamp: Date.now(),
        ttl,
        expiresAt: Date.now() + ttl,
      };
      localStorage.setItem(this._makeKey(key), JSON.stringify(entry));
    } catch (e) {
      // Fallback silently on quota errors
      console.warn("CacheManager: localStorage write failed", e);
    }
  }

  /**
   * Get cached value if not expired
   * @param {string} key
   * @param {Object} params
   * @returns {*}
   */
  get(key, params = {}) {
    try {
      const raw = localStorage.getItem(this._makeKey(key, params));
      if (!raw) return null;

      const entry = JSON.parse(raw);
      if (Date.now() > entry.expiresAt) {
        this.delete(key, params);
        return null;
      }
      return entry.value;
    } catch {
      return null;
    }
  }

  /**
   * Delete cache entry
   * @param {string} key
   * @param {Object} params
   */
  delete(key, params = {}) {
    try {
      localStorage.removeItem(this._makeKey(key, params));
    } catch (e) {
      console.warn("CacheManager: delete failed", e);
    }
  }

  /**
   * Invalidate all cache entries matching a pattern
   * @param {string} pattern - e.g., 'posts_list' to clear all post list caches
   */
  invalidate(pattern) {
    try {
      const keys = Object.keys(localStorage).filter((k) =>
        k.startsWith(`${this.prefix}${pattern}`),
      );
      keys.forEach((k) => localStorage.removeItem(k));
    } catch (e) {
      console.warn("CacheManager: bulk invalidate failed", e);
    }
  }

  /**
   * Clear entire cache namespace
   */
  clear() {
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith(this.prefix)) {
          localStorage.removeItem(k);
        }
      });
    } catch (e) {
      console.warn("CacheManager: clear failed", e);
    }
  }

  /**
   * Check if entry exists and is fresh
   * @param {string} key
   * @param {Object} params
   * @returns {boolean}
   */
  has(key, params = {}) {
    return this.get(key, params) !== null;
  }
}

// Export singleton instance for common use
export const cache = new CacheManager("blog_publisher");
