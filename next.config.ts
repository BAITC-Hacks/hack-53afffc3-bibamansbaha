import type { NextConfig } from 'next';
const config: NextConfig = { distDir:process.env.NEXT_DIST_DIR??'.next',serverExternalPackages: ['pdfjs-dist', 'exceljs', 'yauzl','@napi-rs/canvas'], devIndicators: false };
export default config;
