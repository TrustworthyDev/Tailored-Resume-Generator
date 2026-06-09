/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

module.exports = {
  output: "export",
  distDir: "out",
  images: { unoptimized: true },
  // Make asset paths relative so Electron can load them over file://
  assetPrefix: isProd ? "." : "",
  reactStrictMode: true,
};
