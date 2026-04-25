export class PostItem {
  constructor(post, onEdit, onDelete, canDelete) {
    this.post = post;
    this.onEdit = onEdit;
    this.onDelete = onDelete;
    this.canDelete = canDelete;
  }

  render() {
    const el = document.createElement("div");
    el.className = "post-item";
    el.dataset.postId = this.post.id;

    // Status Badge
    const statusEl = document.createElement("span");
    statusEl.className = `post-status-badge status-${this.post.status}`;
    statusEl.textContent =
      this.post.status.charAt(0).toUpperCase() + this.post.status.slice(1);
    el.appendChild(statusEl);

    // Content Info
    const infoDiv = document.createElement("div");
    infoDiv.className = "post-info";

    const title = document.createElement("h3");
    title.className = "post-title";
    title.textContent = this.post.title;
    title.addEventListener("click", () => this.onEdit(this.post)); // Click title to edit
    infoDiv.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "post-meta";
    meta.textContent = `Modified: ${new Date(this.post.modified).toLocaleDateString()}`;
    infoDiv.appendChild(meta);

    el.appendChild(infoDiv);

    // Actions
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "post-actions";

    // Status Selector
    const statusSelect = document.createElement("select");
    statusSelect.className = "post-status-select";
    statusSelect.value = this.post.status;

    ["publish", "draft", "pending", "private"].forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.text = status.charAt(0).toUpperCase() + status.slice(1);
      statusSelect.appendChild(option);
    });

    statusSelect.addEventListener("change", (e) => {
      this.onStatusChange(this.post, e.target.value);
    });
    actionsDiv.appendChild(statusSelect);

    // Delete Button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-action btn-delete";
    deleteBtn.innerHTML = `<i class="fas fa-trash"></i>`;
    deleteBtn.title = "Move to Trash";
    deleteBtn.addEventListener("click", () => this.onDelete(this.post));
    actionsDiv.appendChild(deleteBtn);

    el.appendChild(actionsDiv);
    return el;
  }
}
