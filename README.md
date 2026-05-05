# Blog Publisher

A desktop application for creating, editing, and publishing WordPress blog posts and pages with a rich Editor.js content editor.

## Key Features

- Electron desktop app for Windows, Linux, and macOS
- Visual content editing powered by Editor.js
- Support for posts and pages
- WordPress REST API integration with Basic Auth / Application Password support
- Draft, publish, pending, and private status workflows
- Featured image upload and media handling
- SEO metadata fields with Yoast SEO and Rank Math compatibility
- Post/page library with search, pagination, status filters, and type switching
- Local site configuration and multi-site switching via saved site credentials
- Cache-backed post listing for faster browsing

## Built With

- Electron
- Webpack
- Editor.js
- WordPress REST API
- Vanilla JavaScript/CSS

## Getting Started

### Prerequisites

- Node.js 18+ or compatible version
- npm
- A WordPress site with Application Passwords enabled for your user account

### Install Dependencies

```bash
npm install
```

### Run in Development

```bash
npm run dev
```

To run the Electron app after rebuilding in development mode:

```bash
npm start
```

### Build for Production

```bash
npm run build
```

This command bundles the application and packages installers using `electron-builder`. Output artifacts are written to the `release/` directory.

## Application Usage

1. Start the app and configure a WordPress site.
2. Enter site URL, username, and application password.
3. Use the library view to browse posts or pages.
4. Create a new post/page or edit an existing one.
5. Add rich content blocks, images, embeds, links, lists, quotes, and more.
6. Set post status, featured image, slug, excerpt, and SEO keyword.
7. Publish directly to WordPress or save drafts.

## Project Structure

- `main.js` - Electron main process entry point
- `preload.js` - Preload script for secure renderer access
- `index.html` - App shell and UI markup
- `src/` - Application source code
  - `app.js` - Main renderer logic and feature orchestration
  - `style.css` - App styles
  - `blocks/` - Custom Editor.js block definitions
  - `components/` - UI components like library and post list
  - `managers/` - WordPress API and page/post managers
  - `services/` - Auth, image upload, and form handling
  - `tools/` - Editor.js inline tools
  - `utils/` - Caching and helper utilities
- `webpack.*.js` - Build configuration files
- `package.json` - App metadata, dependencies, build and run scripts

## Release Artifacts

The repository includes built release artifacts under `release/`, such as:

- Linux AppImage
- Windows installers and portable packages
- Build metadata and update manifests

## Notes

- The app uses WordPress Basic Authentication via application passwords.
- Featured image uploads are limited by WordPress configuration and supported image types.
- SEO keyword fields are designed to work with Yoast SEO and Rank Math plugin metadata.

## License

This project does not include a license file. Add one if you would like to clarify reuse terms.
