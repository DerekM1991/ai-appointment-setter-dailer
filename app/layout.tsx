import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://odin-ai-dialer.derekmerf.chatgpt.site"),
  title: "ODIN AI Appointment Dialer",
  description:
    "A compliance-first AI calling and appointment scheduling workspace for ODIN Asset Manager.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "ODIN AI Appointment Dialer",
    description: "Compliance-first calling. Outlook-ready scheduling.",
    images: [{ url: "/og.png", width: 1731, height: 909 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ODIN AI Appointment Dialer",
    description: "Compliance-first calling. Outlook-ready scheduling.",
    images: ["/og.png"],
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
