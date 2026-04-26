import { PostList } from "./PostList.js";
import { PostPagination } from "./PostPagination.js";
import { cache } from "../utils/CacheManagers.js";

export class LibraryView {
  constructor(container, postManager, onEditPost) {
    this.container = container;
    this.postManager = postManager;
    this.onEditPost = onEditPost;

    this.state = {
      currentPage: 1,
      filters: { status: "any", search: "" },
      type: "post",
      isLoading: false,
    };

    // Debounce timers
    this._searchTimer = null;
    this._filterTimer = null;

    this.postList = new PostList(
      this.container.querySelector(".post-list-wrapper"),
    );
    this.pagination = new PostPagination(
      this.container.querySelector(".pagination-wrapper"),
      this.goToPage.bind(this),
    );

    this.bindEvents();
    this.load();
  }

  bindEvents() {
    const searchInput = this.container.querySelector("#lib-search");
    const statusFilter = this.container.querySelector("#lib-status-filter");
    const refreshBtn = this.container.querySelector("#lib-refresh");
    const typeBtns = this.container.querySelectorAll(".type-toggle-btn");

    // Debounced search (400ms)
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => {
          this.state.filters.search = e.target.value;
          this.state.currentPage = 1;
          this.load();
        }, 400);
      });
    }

    // Debounced status filter (200ms for faster response)
    if (statusFilter) {
      statusFilter.addEventListener("change", (e) => {
        clearTimeout(this._filterTimer);
        this._filterTimer = setTimeout(() => {
          this.state.filters.status = e.target.value;
          this.state.currentPage = 1;
          this.load();
        }, 200);
      });
    }

    // Refresh button bypasses cache
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        // Clear relevant cache before reload
        cache.invalidate(`posts_list_${this.state.type}`);
        this.load({ useCache: false });
      });
    }

    // Type toggle with cache invalidation on switch
    typeBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.type === this.state.type) return;

        typeBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        // Invalidate cache when switching post/page types
        cache.invalidate(`posts_list_${this.state.type}`);

        this.state.type = btn.dataset.type;
        this.state.currentPage = 1;
        this.load();
      });
    });
  }

  /**
   * Load posts with caching and lazy field selection
   * @param {Object} options - { useCache, fields }
   */
  async load(options = {}) {
    const { useCache = true, fields = "minimal" } = options;

    if (this.state.isLoading) return;
    this.state.isLoading = true;

    this.postList.showLoading();

    try {
      const result = await this.postManager.fetchPosts({
        page: this.state.currentPage,
        status: this.state.filters.status,
        search: this.state.filters.search,
        type: this.state.type,
        useCache,
        fields, // 'minimal' for list, 'full' for edit prep
      });

      this.postList.render(
        result.posts,
        (post) => this.handleEdit(post), // NEW: lazy-load full content on edit
        (post) => this.handleDelete(post),
        (post, newStatus) => this.handleStatusChange(post, newStatus),
      );

      this.pagination.render(result.pagination);

      // Update UI title
      const titleEl = this.container.querySelector(".library-header h2");
      if (titleEl) {
        titleEl.textContent =
          this.state.type === "page" ? "Pages Library" : "Posts Library";
      }
    } catch (error) {
      console.error("Library load error:", error);
      this.postList.showError(error.message);
    } finally {
      this.state.isLoading = false;
    }
  }

  /**
   * Handle edit click: lazy-load full post data before opening editor
   * @param {Object} minimalPost - Post with minimal fields from list
   */
  async handleEdit(minimalPost) {
    // Show loading state on the item
    const itemEl = this.container.querySelector(
      `[data-post-id="${minimalPost.id}"]`,
    );
    const originalTitle = itemEl?.querySelector(".post-title")?.textContent;

    if (itemEl) {
      itemEl.style.opacity = "0.6";
      itemEl.querySelector(".post-title").textContent = "Loading...";
    }

    try {
      // Fetch FULL post data only when editing (lazy load)
      const fullPost = await this.postManager.fetchPostById(minimalPost.id);

      // Restore UI
      if (itemEl) {
        itemEl.style.opacity = "1";
        itemEl.querySelector(".post-title").textContent = originalTitle;
      }

      // Pass full post to editor loader
      this.onEditPost(fullPost);
    } catch (error) {
      console.error("Failed to load post for editing:", error);
      alert(`Could not load post content: ${error.message}`);

      // Restore UI on error
      if (itemEl) {
        itemEl.style.opacity = "1";
        itemEl.querySelector(".post-title").textContent = originalTitle;
      }
    }
  }

  async handleStatusChange(post, newStatus) {
    try {
      await this.postManager.updatePostStatus(post.id, newStatus);

      // Invalidate cache for this post type after mutation
      this.postManager.invalidatePostCache(post.id, this.state.type);

      // Reload list to reflect changes
      this.load();
    } catch (error) {
      alert(`Failed to update status: ${error.message}`);
      this.load(); // Revert UI state
    }
  }

  async handleDelete(post) {
    if (!confirm(`Move "${post.title}" to trash?`)) return;

    try {
      await this.postManager.deletePost(post.id);

      // Invalidate cache after deletion
      this.postManager.invalidatePostCache(post.id, this.state.type);

      // Reload list
      this.load();
    } catch (error) {
      alert(`Failed to delete: ${error.message}`);
    }
  }

  goToPage(page) {
    if (page < 1) return;
    this.state.currentPage = page;
    this.load();
  }

  /**
   * Manual cache clear (for debug/dev)
   */
  clearCache() {
    cache.invalidate(`posts_list_${this.state.type}`);
    console.log(`[Cache CLEARED] posts_list_${this.state.type}`);
  }
}
