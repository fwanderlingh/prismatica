/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "130.251.6.30", "192.168.122.1", "172.17.0.1"],
  output: "export",
  trailingSlash: true
};

export default nextConfig;
