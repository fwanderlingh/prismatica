/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "130.251.6.30", "192.168.122.1", "172.17.0.1"],
  experimental: {
    // PDF uploads use base64 JSON (~4/3 the file size). Allow the admin UI's
    // 100 MB maximum plus encoding overhead; the API enforces the saved file limit.
    proxyClientMaxBodySize: "150mb"
  }
};

export default nextConfig;
