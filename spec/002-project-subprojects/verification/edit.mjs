import fs from 'node:fs';import path from 'node:path';
export const root='D:/movieAgent/libtv-studio';
export const base='D:/movieAgent/spec/002-project-subprojects/verification';
export const read=p=>fs.readFileSync(path.join(root,p),'utf8');
export function write(p,s){const target=path.join(root,p);const old=path.join(base,'before',p);if(fs.existsSync(target)&&!fs.existsSync(old)){fs.mkdirSync(path.dirname(old),{recursive:true});fs.copyFileSync(target,old);}fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,s);}
export function replace(p,a,b){const s=read(p);if(!s.includes(a))throw Error('anchor missing '+p+' '+a.slice(0,90));write(p,s.replace(a,b));}
export function save(p,s){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}

