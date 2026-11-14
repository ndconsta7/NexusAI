import {createHmac,timingSafeEqual} from 'crypto';
import {NextResponse} from 'next/server';
export const runtime='nodejs';
export const maxDuration=30;
function valid(token){const secret=process.env.NEXUS_SESSION_SECRET;if(!secret||!token)return false;const [p,s]=token.split('.');if(!p||!s||Number(p)<Date.now())return false;const a=Buffer.from(s),b=Buffer.from(createHmac('sha256',secret).update(p).digest('hex'));return a.length===b.length&&timingSafeEqual(a,b)}
export async function POST(req){
try{
if(!valid(req.cookies.get('nexus_session')?.value))return NextResponse.json({error:'Sessão inválida.'},{status:401});
const url=req.headers.get('x-nexus-upload-url'),offset=req.headers.get('x-nexus-offset'),final=req.headers.get('x-nexus-final')==='1',mime=req.headers.get('x-nexus-mime')||'application/octet-stream';
let parsed;try{parsed=new URL(url)}catch{return NextResponse.json({error:'Sessão de upload inválida.'},{status:400})}
if(parsed.protocol!=='https:'||parsed.hostname!=='generativelanguage.googleapis.com'||!parsed.pathname.startsWith('/upload/v1beta/files')||! /^\d+$/.test(offset||''))return NextResponse.json({error:'Sessão de upload inválida.'},{status:400});
const bytes=await req.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>4*1024*1024)return NextResponse.json({error:'Bloco inválido.'},{status:413});
const upstream=await fetch(url,{method:'POST',headers:{'Content-Length':String(bytes.byteLength),'X-Goog-Upload-Offset':offset,'X-Goog-Upload-Command':final?'upload, finalize':'upload','Content-Type':mime},body:bytes});
const raw=await upstream.text();let data={};try{data=JSON.parse(raw)}catch{}
if(!upstream.ok)return NextResponse.json({error:data.error?.message||'Falha durante o envio ao Google.'},{status:502});
if(!final)return NextResponse.json({ok:true});
const file=data.file||data;if(!file.name||!file.uri)return NextResponse.json({error:'O Gemini não retornou os dados do arquivo finalizado.'},{status:502});
return NextResponse.json({name:file.name,uri:file.uri,mimeType:file.mimeType||mime});
}catch{return NextResponse.json({error:'Erro ao transferir o bloco do arquivo.'},{status:500})}
}