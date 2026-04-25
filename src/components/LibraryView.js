import { PostList } from "./PostList.js";
import { PostPagination } from "./PostPagination.js";

export class LibraryView {
  constructor(container, postManager, onEditPost) {
    this.container = container;
    this.postManager = postManager;
    this.onEditPost = onEditPost;

    this.state = {
      currentPage: 1,
      filters: { status: "any", search: "" },
      type: "post", // Default to posts
    };

    this.postList = new PostList(
      this.container.querySelector(".post-list-wrapper"),
    );
    this.pagination = new PostPagination(
      this.container.querySelector(".pagination-wrapper"),
      this.goToPage.bind(this),
    );

    this.bindEvents();
    this.load(); // Initial load
  }

  bindEvents() {
    // Search & Status Filter
    const searchInput = this.container.querySelector("#lib-search");
    const statusFilter = this.container.querySelector("#lib-status-filter");
    const refreshBtn = this.container.querySelector("#lib-refresh");
    const typeToggle = this.container.querySelector(".type-toggle"); // New element

    if (searchInput) {
      let timeout;
      searchInput.addEventListener("input", (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          this.state.filters.search = e.target.value;
          this.state.currentPage = 1;
          this.load();
        }, 400);
      });
    }

    if (statusFilter) {
      statusFilter.addEventListener("change", (e) => {
        this.state.filters.status = e.target.value;
        this.state.currentPage = 1;
        this.load();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => this.load());
    }

    // New: Type Toggle (Posts vs Pages)
    const typeBtns = this.container.querySelectorAll(".type-toggle-btn");
    typeBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.type === this.state.type) return; // Already active

        typeBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        this.state.type = btn.dataset.type;
        this.state.currentPage = 1;
        this.load();
      });
    });
  }

  async load() {
    this.postList.showLoading();
    try {
      const result = await this.postManager.fetchPosts({
        page: this.state.currentPage,
        status: this.state.filters.status,
        search: this.state.filters.search,
        type: this.state.type, // Now passing 'page' or 'post'
      });

      this.postList.render(
        result.posts,
        (post) => this.onEditPost(post),
        (post) => this.handleDelete(post),
        (post, newStatus) => this.handleStatusChange(post, newStatus),
      );

      this.pagination.render(result.pagination);

      // Update UI title based on type
      const titleEl = this.container.querySelector(".library-header h2");
      if (titleEl) {
        titleEl.textContent =
          this.state.type === "page" ? "Pages Library" : "Posts Library";
      }
    } catch (error) {
      this.postList.showError(error.message);
    }
  }

  async handleStatusChange(post, newStatus) {
    try {
      // Optimistic update? Or wait for server.
      // Let's wait for server to avoid "stuck" state on failure.
      await this.postManager.updatePostStatus(post.id, newStatus);
      this.load(); // Refresh to get server response (dates, etc)
    } catch (error) {
      alert(`Failed to update status: ${error.message}`);
      this.load(); // Revert state by reloading
    }
  }

  async handleDelete(post) {
    if (!confirm(`Move "${post.title}" to trash?`)) return;

    try {
      await this.postManager.deletePost(post.id);
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
}
