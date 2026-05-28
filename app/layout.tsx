import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PRISMATICA",
  description: "Open source PRISMA review platform."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
