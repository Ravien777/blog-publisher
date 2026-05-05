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

    // Try WPForms first - check both REST API versions and endpoint styles
    try {
      let res = null;
      let data = null;
      
      // First try the standard wpforms/v1 endpoint
      res = await fetch(`${this.apiUrl}/wpforms/v1/forms?per_page=50`, {
        headers: this.headers,
      });
      console.log("WPForms /v1 response status:", res.status);
      
      // If v1 fails with 404, try alternative endpoint structure
      if (!res.ok && res.status === 404) {
        console.log("WPForms /v1 not found, trying /v2...");
        res = await fetch(`${this.apiUrl}/wpforms/v2/forms?per_page=50`, {
          headers: this.headers,
        });
        console.log("WPForms /v2 response status:", res.status);
      }
      
      // If still 404, try rest_route style (some servers require this)
      if (!res.ok && res.status === 404) {
        console.log("WPForms /v2 not found, trying rest_route style...");
        const restRoute = encodeURIComponent('/wpforms/v1/forms');
        res = await fetch(`${this.apiUrl}/wp-json?rest_route=${restRoute}&per_page=50`, {
          headers: this.headers,
        });
        console.log("WPForms rest_route response status:", res.status);
      }
      
      if (res.ok) {
        data = await res.json();
        console.log("WPForms raw response:", data);
        
        // Handle different response structures
        let formsArray = [];
        if (Array.isArray(data)) {
          formsArray = data;
        } else if (data.forms && Array.isArray(data.forms)) {
          formsArray = data.forms;
        } else if (data.data && Array.isArray(data.data)) {
          formsArray = data.data;
        } else if (typeof data === 'object' && data !== null) {
          // Some APIs return objects with numeric keys
          formsArray = Object.values(data).filter(item => item.id || item.name);
        }
        
        console.log("WPForms extracted array:", formsArray);
        if (formsArray.length > 0) {
          this.plugin = "wpforms";
          this.forms = formsArray.map((f) => ({
            id: f.id,
            title: f.name || f.title || `Form #${f.id}`,
          }));
          console.log("WPForms forms loaded:", this.forms);
        }
      } else {
        console.warn("WPForms API returned non-OK status:", res.status);
      }
    } catch (error) {
      console.warn("WPForms detection failed:", error.message);
    }

    if (!this.plugin) {
      // Try CF7 with multiple endpoint styles
      try {
        let res = await fetch(
          `${this.apiUrl}/contact-form-7/v1/contact-forms?per_page=100`,
          { headers: this.headers },
        );
        console.log("CF7 /v1 response status:", res.status);
        
        // If v1 fails with 404, try rest_route style
        if (!res.ok && res.status === 404) {
          console.log("CF7 /v1 not found, trying rest_route style...");
          const restRoute = encodeURIComponent('/contact-form-7/v1/contact-forms');
          res = await fetch(`${this.apiUrl}/wp-json?rest_route=${restRoute}&per_page=100`, {
            headers: this.headers,
          });
          console.log("CF7 rest_route response status:", res.status);
        }
        
        if (res.ok) {
          const data = await res.json();
          console.log("CF7 raw response:", data);
          
          // Handle different response structures for CF7
          let formsArray = [];
          if (Array.isArray(data)) {
            formsArray = data;
          } else if (data.contact_forms && Array.isArray(data.contact_forms)) {
            formsArray = data.contact_forms;
          } else if (data.data && Array.isArray(data.data)) {
            formsArray = data.data;
          } else if (typeof data === 'object' && data !== null) {
            formsArray = Object.values(data).filter(item => item.id);
          }
          
          console.log("CF7 extracted array:", formsArray);
          if (formsArray.length > 0) {
            this.plugin = "cf7";
            this.forms = formsArray.map((f) => ({
              id: f.id,
              title: f.title?.rendered || f.title || `Form #${f.id}`,
            }));
            console.log("CF7 forms loaded:", this.forms);
          }
        } else {
          console.warn("CF7 API returned non-OK status:", res.status);
        }
      } catch (error) {
        console.warn("CF7 detection failed:", error.message);
      }
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
