/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "shop.nijisanji.jp" },
      { protocol: "https", hostname: "cdn.shopify.com" }
    ]
  }
};
export default nextConfig;
