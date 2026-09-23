import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'EKT — ассистент по подбору', description: 'Подбор электротехники по спецификации, фото и описанию. Проверенное предложение и сохранённая корзина.', icons: { icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='8' fill='%232c738f'/%3E%3Ctext x='11' y='29' fill='white' font-family='sans-serif' font-weight='bold' font-size='32'%3Ee%3C/text%3E%3C/svg%3E" } };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
