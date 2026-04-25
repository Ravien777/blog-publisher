export class PostPagination {
  constructor(container, onPageChange) {
    this.container = container;
    this.onPageChange = onPageChange;
  }

  render(pagination) {
    if (!pagination || pagination.totalPages <= 1) {
      this.container.innerHTML = "";
      return;
    }

    this.container.innerHTML = `
      <div class="pagination-controls">
        <button class="btn-pagination" data-page="prev" ${pagination.currentPage === 1 ? "disabled" : ""}>
          <i class="fas fa-chevron-left"></i> Previous
        </button>
        <span class="pagination-info">Page ${pagination.currentPage} of ${pagination.totalPages} (${pagination.totalPosts} total)</span>
        <button class="btn-pagination" data-page="next" ${pagination.currentPage === pagination.totalPages ? "disabled" : ""}>
          Next <i class="fas fa-chevron-right"></i>
        </button>
      </div>
    `;

    this.container.querySelectorAll(".btn-pagination").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const action = e.currentTarget.dataset.page;
        const newPage =
          action === "prev"
            ? pagination.currentPage - 1
            : pagination.currentPage + 1;
        this.onPageChange(newPage);
      });
    });
  }
}
