/**
 * AuthManager.js
 * Handles multi-site configuration, authentication, token management, and capability checks.
 */
export class AuthManager {
  getSites() {
    try {
      const sites = localStorage.getItem("wp_sites");
      return sites ? JSON.parse(sites) : [];
    } catch (e) {
      console.error("Failed to load sites:", e);
      return [];
    }
  }

  saveSite(site) {
    const sites = this.getSites();
    const existingIndex = sites.findIndex((s) => s.id === site.id);
    if (existingIndex >= 0) {
      sites[existingIndex] = site;
    } else {
      sites.push(site);
    }
    localStorage.setItem("wp_sites", JSON.stringify(sites));
  }

  removeSite(siteId) {
    const sites = this.getSites();
    const filtered = sites.filter((s) => s.id !== siteId);
    localStorage.setItem("wp_sites", JSON.stringify(filtered));
  }

  getActiveSite() {
    const siteId = sessionStorage.getItem("active_site_id");
    if (!siteId) return null;
    const sites = this.getSites();
    return sites.find((s) => s.id === siteId) || null;
  }

  setActiveSite(siteId) {
    sessionStorage.setItem("active_site_id", siteId);
  }

  createSite(name, url, username, token) {
    return {
      id: `site-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: name,
      url: url,
      username: username,
      token: token,
      createdAt: new Date().toISOString(),
    };
  }

  getToken() {
    const activeSite = this.getActiveSite();
    return activeSite ? activeSite.token : "";
  }

  setToken(token) {
    const activeSite = this.getActiveSite();
    if (activeSite) {
      activeSite.token = token;
      this.saveSite(activeSite);
    }
  }

  clearToken() {
    const activeSite = this.getActiveSite();
    if (activeSite) {
      activeSite.token = "";
      this.saveSite(activeSite);
    }
  }

  async validateToken() {
    const token = this.getToken();
    if (!token) return false;
    const config = this.getActiveConfig();
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
  }

  getActiveConfig() {
    const activeSite = this.getActiveSite();
    if (activeSite) {
      return {
        WORDPRESS_API: `${activeSite.url}/wp-json`,
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
    return {
      WORDPRESS_API: "https://unabo.be/wp-json",
      WORDPRESS_SITE_URL: "https://unabo.be",
      MAX_IMAGE_SIZE: 5242880,
      ALLOWED_IMAGE_TYPES: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
    };
  }

  async authenticate(username, applicationPassword) {
    try {
      const token = btoa(`${username}:${applicationPassword}`);
      const CONFIG = this.getActiveConfig();
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
      this.setToken(token);
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
      return { success: false, error: error.message };
    }
  }

  async checkCapability(capability) {
    try {
      const token = this.getToken();
      if (!token) return false;
      const config = this.getActiveConfig();
      const response = await fetch(
        `${config.WORDPRESS_SITE_URL}/wp-json/wp/v2/users/me?context=edit`,
        {
          headers: {
            Authorization: `Basic ${token}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (!response.ok) {
        console.error("Failed to fetch user data: ", response.status);
        return false;
      }
      const userData = await response.json();
      if (userData.roles && userData.roles.length > 0) {
        const userRole = userData.roles[0];
        const publishingRoles = ["administrator", "editor", "author"];
        if (capability === "publish_posts") {
          return publishingRoles.includes(userRole);
        }
        if (capability === "edit_posts") {
          const editingRoles = [
            "administrator",
            "editor",
            "author",
            "contributor",
          ];
          return editingRoles.includes(userRole);
        }
      }
      return false;
    } catch (error) {
      console.error("Error checking capability:", error);
      return false;
    }
  }

  showLoginModal() {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "wp-login-modal";
      modal.innerHTML = `<div class="modal-overlay">
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
      </div>`;
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
          const result = await this.authenticate(username, appPassword);
          if (result.success) {
            this.setToken(btoa(`${username}:${appPassword}`));
            showLoginStatus("Login successful!", "success");
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
      loginCancel.addEventListener("click", () => {
        document.body.removeChild(modal);
        resolve(false);
      });
      modalClose.addEventListener("click", () => {
        document.body.removeChild(modal);
        resolve(false);
      });
      modal.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !isLoggingIn) handleLogin();
      });
      setTimeout(() => document.getElementById("login-username").focus(), 100);
    });
  }

  async showAddSiteModal() {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "wp-login-modal";
      modal.innerHTML = `<div class="modal-overlay">
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
      </div>`;
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
          const token = btoa(`${username}:${appPassword}`);
          const response = await fetch(`${url}/wp-json/wp/v2/users/me`, {
            method: "GET",
            headers: {
              Authorization: `Basic ${token}`,
              "Content-Type": "application/json",
            },
          });
          if (!response.ok)
            throw new Error(
              "Authentication failed. Please check your credentials.",
            );

          const site = this.createSite(name, url, username, token);
          this.saveSite(site);
          this.setActiveSite(site.id);
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

  showManageSitesModal() {
    const sites = this.getSites();
    const activeSite = this.getActiveSite();
    const modal = document.createElement("div");
    modal.className = "wp-login-modal";
    modal.innerHTML = `<div class="modal-overlay">
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
                  ${activeSite && activeSite.id === site.id ? "" : `<button class="btn-sm btn-switch" data-site-id="${site.id}"><i class="fas fa-exchange-alt"></i> Switch</button>`}
                  <button class="btn-sm btn-danger btn-delete" data-site-id="${site.id}"><i class="fas fa-trash"></i> Delete</button>
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
    </div>`;
    document.body.appendChild(modal);

    const closeModal = () => document.body.removeChild(modal);
    modal.querySelector(".modal-close").addEventListener("click", closeModal);
    modal
      .querySelector("#close-manage-modal")
      .addEventListener("click", closeModal);

    modal.querySelectorAll(".btn-switch").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const siteId = e.currentTarget.dataset.siteId;
        if (confirm("Switch to this site?")) {
          this.setActiveSite(siteId);
          location.reload();
        }
      });
    });

    modal.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const siteId = e.currentTarget.dataset.siteId;
        const site = sites.find((s) => s.id === siteId);
        if (confirm(`Delete "${site.name}"? This action cannot be undone.`)) {
          this.removeSite(siteId);
          if (activeSite && activeSite.id === siteId) {
            sessionStorage.removeItem("active_site_id");
            location.reload();
          } else {
            closeModal();
            this.showManageSitesModal();
          }
        }
      });
    });
  }

  async handleSiteSwitch(event) {
    const siteId = event.target.value;
    if (
      confirm("Switch to this site? Any unsaved changes will be kept locally.")
    ) {
      this.setActiveSite(siteId);
      location.reload();
    } else {
      const activeSite = this.getActiveSite();
      if (activeSite) event.target.value = activeSite.id;
    }
  }

  createSiteSwitcher() {
    const sites = this.getSites();
    const activeSite = this.getActiveSite();
    const siteSwitcherHTML = `<div id="site-switcher-container" class="site-switcher-container">
      <div class="site-switcher-content">
        <i class="fas fa-globe"></i>
        <select id="site-selector" class="site-selector">
          ${sites.map((site) => `<option value="${site.id}" ${activeSite && activeSite.id === site.id ? "selected" : ""}>${site.name} (${site.url})</option>`).join("")}
        </select>
        <button id="manage-sites-btn" class="manage-sites-btn" title="Manage sites"><i class="fas fa-cog"></i></button>
        <button id="add-site-btn" class="add-site-btn" title="Add new site"><i class="fas fa-plus"></i></button>
      </div>
    </div>`;
    const toolbar = document.querySelector(".editor-toolbar") || document.body;
    toolbar.insertAdjacentHTML("afterbegin", siteSwitcherHTML);

    document
      .getElementById("site-selector")
      ?.addEventListener("change", (e) => this.handleSiteSwitch(e));
    document
      .getElementById("manage-sites-btn")
      ?.addEventListener("click", () => this.showManageSitesModal());
    document
      .getElementById("add-site-btn")
      ?.addEventListener("click", () => this.showAddSiteModal());
  }

  addLogoutButton() {
    const toolbar = document.querySelector(".editor-toolbar");
    if (!toolbar) return;
    const logoutBtn = document.createElement("button");
    logoutBtn.id = "logout-btn";
    logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
    logoutBtn.className = "logout-button";
    logoutBtn.addEventListener("click", async () => {
      if (confirm("Are you sure you want to logout?")) {
        this.clearToken();
        location.reload();
      }
    });
    toolbar.appendChild(logoutBtn);
  }
}
