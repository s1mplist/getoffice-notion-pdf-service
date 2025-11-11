import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GetOffice PDF Service",
  description: "PDF generation service for Notion pages",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}