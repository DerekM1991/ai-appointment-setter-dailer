import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://odin-ai-dialer.derekmerf.chatgpt.site"),
  title: "AI Appointment Setter",
  description:
    "A reusable, compliance-first AI calling and Outlook appointment scheduling workspace.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "AI Appointment Setter",
    description: "Compliance-first calling. Outlook-ready scheduling.",
    images: [{ url: "/og-generic.png", width: 1731, height: 909 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Appointment Setter",
    description: "Compliance-first calling. Outlook-ready scheduling.",
    images: ["/og-generic.png"],
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
