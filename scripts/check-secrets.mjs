import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const paths=execFileSync('git',['diff','--cached','--name-only'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
const env=fs.existsSync('.env.local')?fs.readFileSync('.env.local','utf8'):'';
const secrets=[...env.matchAll(/^(?:OPENAI_API_KEY|EKT_API_PASSWORD)=(.+)$/gm)].map(m=>m[1].trim()).filter(x=>x.length>5);
let failures=0;
for(const path of paths){if(/(^|\/)(\.env(?:\..*)?|\.private|uploads|snapshots)(\/|$)/i.test(path)&&path!=='.env.example'){console.error('Forbidden path:',path);failures++;continue;}let data;try{data=execFileSync('git',['show',`:${path}`],{encoding:'utf8',maxBuffer:10_000_000});}catch{continue;}if(secrets.some(s=>data.includes(s))||/sk-proj-[A-Za-z0-9_-]{20,}/.test(data)||/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/.test(data)){console.error('Possible secret in:',path);failures++;}}
if(failures)process.exit(1);console.log(`Staged secret check passed: ${paths.length} paths.`);
