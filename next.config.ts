import type { NextConfig } from 'next';
const config: NextConfig = { serverExternalPackages: ['pdfjs-dist', 'exceljs', 'yauzl'], devIndicators: false };
export default config;
