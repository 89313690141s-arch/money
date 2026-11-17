import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Личные финансы",
    short_name: "Финансы",
    description: "Бюджет, долги и накопления",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f6fa",
    theme_color: "#385de0",
    icons: [
      {src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
      {src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
