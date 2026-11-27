import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "opsRUN",
  description: "Operations console",
};

export default function RootLayout({ children, ventana }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* La Job window encima del tablero (ruta interceptada, OPR-26). */}
        {ventana}
      </body>
    </html>
  );
}
