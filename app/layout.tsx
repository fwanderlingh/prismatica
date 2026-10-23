import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "PRISMATICA",
  description: "Open source PRISMA review platform."
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const palette = cookieStore.get("prismatica_palette")?.value === "paper" ? "paper" : "teal";
  const savedTheme = cookieStore.get("prismatica_theme")?.value;
  const theme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : undefined;

  return (
    <html lang="en" data-palette={palette} data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
