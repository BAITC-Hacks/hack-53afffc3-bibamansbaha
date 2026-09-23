import type { NextConfig } from 'next';
const config: NextConfig = { distDir:process.env.NEXT_DIST_DIR??'.next',serverExternalPackages: ['pdfjs-dist', 'exceljs', 'yauzl','@napi-rs/canvas'], outputFileTracingIncludes:{'/api/*':['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs']}, devIndicators: false };
export default config;
