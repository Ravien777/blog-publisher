/**
 * ImageUploader.js
 * Handles image validation, base64 conversion, and WordPress media uploads.
 */
export class ImageUploader {
  constructor(authManager) {
    this.authManager = authManager;
  }

  base64ToBlob(base64Data) {
    const parts = base64Data.split(";base64,");
    const contentType = parts[0].split(":")[1];
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for (let i = 0; i < rawLength; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], { type: contentType });
  }

  validateImageFile(file) {
    const CONFIG = this.authManager.getActiveConfig();
    if (!CONFIG.ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error(
        `Invalid image type. Allowed: ${CONFIG.ALLOWED_IMAGE_TYPES.join(", ")}`,
      );
    }
    if (file.size > CONFIG.MAX_IMAGE_SIZE) {
      alert("The image is too large. Maximum size is 5MB.");
      throw new Error(
        `Image too large. Maximum size: ${CONFIG.MAX_IMAGE_SIZE / 1024 / 1024}MB`,
      );
    }
    return true;
  }

  async uploadPendingImages(editorData) {
    if (!window.pendingUploads || window.pendingUploads.size === 0)
      return editorData;

    const token = tokenManagerMultiSite.getToken();
    if (!token) throw new Error("Authentication required");
    const config = getActiveConfig();
    const updatedData = JSON.parse(JSON.stringify(editorData));

    // Recursive helper to find and upload pending images anywhere in the block tree
    const uploadInBlock = async (block) => {
      if (block.type === "image" && block.data?.file?.pending) {
        const fileId = block.data.file.id;
        const file = window.pendingUploads.get(fileId);
        if (file) {
          try {
            const formData = new FormData();
            formData.append("file", file);
            const res = await fetch(`${config.WORDPRESS_API}/media`, {
              method: "POST",
              headers: { Authorization: `Basic ${token}` },
              body: formData,
            });
            if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
            const media = await res.json();
            block.data.file = {
              url: media.source_url,
              id: media.id,
              pending: false,
              sizes: media.media_details?.sizes || {},
            };
            window.pendingUploads.delete(fileId);
          } catch (err) {
            console.error("Nested image upload failed:", err);
          }
        }
      }
      // Recurse into columns
      if (block.type === "columns" && block.data?.items) {
        for (const col of block.data.items) {
          if (col.blocks) {
            for (const nested of col.blocks) {
              await uploadInBlock(nested);
            }
          }
        }
      }
    };

    for (const block of updatedData.blocks) {
      await uploadInBlock(block);
    }
    return updatedData;
  }

  async uploadFeaturedImage(file) {
    try {
      const token = this.authManager.getToken();
      if (!token)
        throw new Error("Authentication required. Please login first.");
      const config = this.authManager.getActiveConfig();
      this.validateImageFile(file);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", file.name);
      formData.append("alt_text", file.name);
      const response = await fetch(`${config.WORDPRESS_API}/media`, {
        method: "POST",
        headers: { Authorization: `Basic ${token}` },
        body: formData,
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Featured image upload failed: ${response.status} - ${errorText}`,
        );
      }
      const mediaData = await response.json();
      return {
        success: true,
        id: mediaData.id,
        url: mediaData.source_url,
        data: mediaData,
      };
    } catch (error) {
      console.error("Featured image upload error:", error);
      return { success: false, error: error.message };
    }
  }
}
