import { PostItem } from "./PostItem.js";

export class PostList {
  constructor(container) {
    this.container = container;
  }

  showLoading() {
    this.container.innerHTML = `<div class="loading-state"><i class="fas fa-circle-notch fa-spin"></i> Loading posts...</div>`;
  }

  showEmpty() {
    this.container.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>No posts found matching your filters.</p></div>`;
  }

  showError(message) {
    this.container.innerHTML = `<div class="error-state"><i class="fas fa-exclamation-circle"></i><p>${this.escapeHtml(message)}</p></div>`;
  }

  render(posts, onEdit, onDelete, canDelete) {
    if (!posts || posts.length === 0) {
      this.showEmpty();
      return;
    }

    this.container.innerHTML = "";
    const list = document.createElement("div");
    list.className = "post-items-list";

    posts.forEach((post) => {
      const item = new PostItem(post, onEdit, onDelete, canDelete);
      list.appendChild(item.render());
    });

    this.container.appendChild(list);
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }
}
