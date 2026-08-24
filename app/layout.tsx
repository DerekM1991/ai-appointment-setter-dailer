import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ODIN AI Appointment Dialer",
  description:
    "A compliance-first AI calling and appointment scheduling workspace for ODIN Asset Manager.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
