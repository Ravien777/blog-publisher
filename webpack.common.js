const path = require("path");

module.exports = {
  target: "electron-renderer",

  entry: "./src/app.js",

  output: {
    filename: "renderer.js",
    path: path.resolve(__dirname, "dist"),
    publicPath: "./",
    clean: true,
  },

  module: {
    rules: [
      {
        test: /\.css$/,
      },
    ],
  },

  resolve: {
    extensions: [".js"],
  },
};
