import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OrbitCompute — AI data centers in orbit",
  description:
    "Interactive engineering simulation of orbital AI compute: orbits, eclipse, power, thermal rejection, workloads and communications.",
};

export const viewport: Viewport = { themeColor: "#05070a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
