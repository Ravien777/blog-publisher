/**
 * ContactFormBlock.js
 * Editor.js block that allows selection of a contact form from installed plugin.
 * Uses synchronous render() and reads the provider from window.formProvider.
 */
export class ContactFormBlock {
  static get toolbox() {
    return {
      title: "Contact Form",
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 6 10-6"/></svg>`,
    };
  }

  constructor({ data, api, readOnly }) {
    this.api = api;
    this.readOnly = readOnly;

    // Always take the provider from window, no config dependency
    const provider =
      (typeof window !== "undefined" && window.formProvider) || null;

    if (
      provider &&
      typeof provider.getPlugin === "function" &&
      typeof provider.getForms === "function"
    ) {
      this.formProvider = provider;
    } else {
      this.formProvider = null;
      console.warn("ContactFormBlock: FormProvider not available or invalid");
    }

    this.data = {
      plugin:
        data.plugin || (this.formProvider ? this.formProvider.getPlugin() : ""),
      formId: data.formId || null,
      formTitle: data.formTitle || "",
    };
    this.wrapper = null;
  }

  render() {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("cdx-contact-form-wrapper");

    if (!this.formProvider) {
      this.wrapper.innerHTML =
        "<p>🔌 Form provider not available. Please authenticate first.</p>";
      return this.wrapper;
    }

    // Show a placeholder while forms are loaded
    this.wrapper.innerHTML = "<p>⏳ Loading forms...</p>";
    this._populateSelect();
    return this.wrapper;
  }

  async _populateSelect() {
    try {
      await this.formProvider.detect();
      const forms = this.formProvider.getForms();
      const plugin = this.formProvider.getPlugin();

      if (!forms || forms.length === 0) {
        this.wrapper.innerHTML =
          "<p>No forms found. Install WPForms or Contact Form 7.</p>";
        return;
      }

      const select = document.createElement("select");
      select.disabled = this.readOnly;

      forms.forEach((form) => {
        const option = document.createElement("option");
        option.value = form.id;
        option.textContent = form.title || `Form #${form.id}`;
        if (this.data.formId == form.id) option.selected = true;
        select.appendChild(option);
      });

      if (!this.data.formId && forms.length > 0) {
        select.value = forms[0].id;
        this.data.formId = forms[0].id;
        this.data.formTitle = forms[0].title || "";
        this.data.plugin = plugin;
      }

      select.addEventListener("change", (e) => {
        this.data.formId = e.target.value;
        const selected = forms.find((f) => f.id == e.target.value);
        this.data.formTitle = selected?.title || "";
        this.data.plugin = plugin;
      });

      const label = document.createElement("label");
      label.style.display = "block";
      label.style.marginBottom = "6px";
      label.textContent = "Choose a contact form:";
      label.appendChild(select);

      this.wrapper.innerHTML = "";
      this.wrapper.appendChild(label);
    } catch (error) {
      console.error("ContactFormBlock: failed to load forms", error);
      this.wrapper.innerHTML = `<p>❌ Error loading forms: ${error.message}</p>`;
    }
  }

  save() {
    return this.data;
  }

  static get isReadOnlySupported() {
    return true;
  }
}
