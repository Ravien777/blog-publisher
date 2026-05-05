/**
 * FormProvider.js
 * Detects active form plugin (WPForms / CF7) and fetches the list of forms.
 */
export class FormProvider {
  constructor(apiUrl, token) {
    if (!apiUrl || !token) throw new Error("API URL and token are required");
    this.apiUrl = apiUrl;
    this.token = token;
    this.plugin = null; // 'wpforms' | 'cf7' | null
    this.forms = [];
    this.loaded = false;
    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Basic ${this.token}`,
    };
  }

  async detect() {
    if (this.loaded) return;

    // Try WPForms first
    try {
      const res = await fetch(`${this.apiUrl}/wpforms/v1/forms?per_page=50`, {
        headers: this.headers,
      });
      if (res.ok) {
        const data = await res.json();
        const formsArray = Array.isArray(data) ? data : (data.forms || []);
        if (formsArray.length > 0) {
          this.plugin = "wpforms";
          this.forms = formsArray.map((f) => ({
            id: f.id,
            title: f.name || f.title || `Form #${f.id}`,
          }));
        }
      }
    } catch {}

    if (!this.plugin) {
      // Try CF7
      try {
        const res = await fetch(
          `${this.apiUrl}/contact-form-7/v1/contact-forms?per_page=100`,
          { headers: this.headers },
        );
        if (res.ok) {
          const data = await res.json();
          const formsArray = Array.isArray(data) ? data : [];
          if (formsArray.length > 0) {
            this.plugin = "cf7";
            this.forms = formsArray.map((f) => ({
              id: f.id,
              title: f.title?.rendered || f.title || `Form #${f.id}`,
            }));
          }
        }
      } catch {}
    }
    this.loaded = true;
  }

  getPlugin() {
    return this.plugin;
  }

  getForms() {
    return this.forms;
  }

  /**
   * Returns a shortcode string for the given form ID.
   * @param {string|number} formId
   * @returns {string}
   */
  getShortcode(formId) {
    if (this.plugin === "wpforms") {
      return `[wpforms id="${formId}"]`;
    } else if (this.plugin === "cf7") {
      return `[contact-form-7 id="${formId}"]`;
    }
    return "";
  }
}
