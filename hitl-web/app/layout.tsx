import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkPublishableKey } from "../lib/clerk_env";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wewebplus HITL",
  description: "Answer Wewebplus approval gates.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider publishableKey={clerkPublishableKey()}>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
