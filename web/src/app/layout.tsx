import type { Metadata } from "next";
import "./globals.css";
import { ControlAccessProvider } from "@/contexts/ControlAccessContext";

export const metadata: Metadata = {
  title: "Lie Hard Game Show",
  description: "Operator Panel & Display",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ControlAccessProvider>{children}</ControlAccessProvider>
      </body>
    </html>
  );
}
