import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "我買 - 彩虹社周邊收藏",
    short_name: "我買",
    description: "我的彩虹社周邊訂單記錄",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#1f2937",
    orientation: "portrait",
    icons: [
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
