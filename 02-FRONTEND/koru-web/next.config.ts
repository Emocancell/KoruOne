
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/auth/:path*",
        destination: "http://127.0.0.1:8081/auth/:path*",
      },
      {
        source: "/api/redis-control/:path*",
        destination: "http://127.0.0.1:8082/api/redis/:path*",
      },
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8080/api/:path*",
      },
      {
        source: "/health",
        destination: "http://127.0.0.1:8080/health",
      },
    ];
  },
};

export default nextConfig;
