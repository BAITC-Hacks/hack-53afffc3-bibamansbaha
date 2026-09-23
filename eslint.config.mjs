import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([...nextVitals,...nextTs,globalIgnores(['.next/**','.private/**','.agents/**','.claude/**','.tmp/**','node_modules/**']),{rules:{'@next/next/no-img-element':'off'}}]);
