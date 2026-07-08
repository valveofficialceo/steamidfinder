import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steam ID Finder — Поиск свободных Steam ID",
  description: "Инструмент для поиска свободных коротких Steam Custom URL идентификаторов",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-[#1b2838] text-[#c7d5e0] antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
