import { PostList } from "./PostList.js";
import { PostPagination } from "./PostPagination.js";
import { cache } from "../utils/CacheManagers.js";

export class LibraryView {
  constructor(container, managers, onEditPost) {
    this.container = container;
    this.managers = managers; // { post: PostManager, page: PageManager }
    this.onEditPost = onEditPost;
    this.state = {
      currentPage: 1,
      filters: { status: "any", search: "" },
      type: "post",
      isLoading: false,
    };

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

  get currentManager() {
    return this.managers[this.state.type];
  }

  get cacheKeyPrefix() {
    return this.state.type === "page" ? "pages_list" : "posts_list";
  }

  bindEvents() {
    const searchInput = this.container.querySelector("#lib-search");
    const statusFilter = this.container.querySelector("#lib-status-filter");
    const refreshBtn = this.container.querySelector("#lib-refresh");
    const typeBtns = this.container.querySelectorAll(".type-toggle-btn");

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

    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        cache.invalidate(this.cacheKeyPrefix);
        this.load({ useCache: false });
      });
    }

    typeBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.type === this.state.type) return;

        typeBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        cache.invalidate(this.cacheKeyPrefix);

        this.state.type = btn.dataset.type;
        this.state.currentPage = 1;
        this.load();
      });
    });
  }

  async load(options = {}) {
    const { useCache = true, fields = "minimal" } = options;
    if (this.state.isLoading) return;
    this.state.isLoading = true;
    this.postList.showLoading();

    try {
      const result = await this.currentManager.fetchPosts({
        page: this.state.currentPage,
        status: this.state.filters.status,
        search: this.state.filters.search,
        type: this.state.type,
        useCache,
        fields,
      });

      this.postList.render(
        result.posts,
        (post) => this.handleEdit(post),
        (post) => this.handleDelete(post),
        (post, newStatus) => this.handleStatusChange(post, newStatus),
      );

      this.pagination.render(result.pagination);

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

  async handleEdit(minimalPost) {
    const itemEl = this.container.querySelector(
      `[data-post-id="${minimalPost.id}"]`,
    );
    const originalTitle = itemEl?.querySelector(".post-title")?.textContent;
    if (itemEl) {
      itemEl.style.opacity = "0.6";
      itemEl.querySelector(".post-title").textContent = "Loading...";
    }

    try {
      const fullPost = await this.currentManager.fetchPostById(minimalPost.id);
      if (itemEl) {
        itemEl.style.opacity = "1";
        itemEl.querySelector(".post-title").textContent = originalTitle;
      }
      this.onEditPost(fullPost);
    } catch (error) {
      console.error("Failed to load for editing:", error);
      alert(`Could not load content: ${error.message}`);
      if (itemEl) {
        itemEl.style.opacity = "1";
        itemEl.querySelector(".post-title").textContent = originalTitle;
      }
    }
  }

  async handleStatusChange(post, newStatus) {
    try {
      await this.currentManager.updatePostStatus(post.id, newStatus);
      this.currentManager.invalidatePostCache(post.id);
      this.load();
    } catch (error) {
      alert(`Failed to update status: ${error.message}`);
      this.load();
    }
  }

  async handleDelete(post) {
    if (!confirm(`Move "${post.title}" to trash?`)) return;
    try {
      await this.currentManager.deletePost(post.id);
      this.currentManager.invalidatePostCache(post.id);
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

  clearCache() {
    cache.invalidate(this.cacheKeyPrefix);
  }
}
