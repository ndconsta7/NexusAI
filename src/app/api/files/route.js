import {createHmac,timingSafeEqual} from 'crypto';
import {NextResponse} from 'next/server';
export const runtime='nodejs';
export const maxDuration=30;
function valid(token){const secret=process.env.NEXUS_SESSION_SECRET;if(!secret||!token)return false;const [p,s]=token.split('.');if(!p||!s||Number(p)<Date.now())return false;const a=Buffer.from(s),b=Buffer.from(createHmac('sha256',secret).update(p).digest('hex'));return a.length===b.length&&timingSafeEqual(a,b)}
export async function POST(req){
try{
if(!valid(req.cookies.get('nexus_session')?.value))return NextResponse.json({error:'Entre novamente para enviar arquivos.'},{status:401});
const key=process.env.GEMINI_API_KEY;if(!key)return NextResponse.json({error:'GEMINI_API_KEY não configurada.'},{status:503});
const {name,mimeType,size}=await req.json();
const allowed=/^(image\/(jpeg|png|webp|heic|heif|gif)|video\/(mp4|mpeg|quicktime|webm|x-msvideo|x-flv|3gpp)|audio\/(mpeg|mp3|wav|aiff|aac|ogg|flac|mp4|webm)|application\/(pdf|json|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|text\/(plain|csv|markdown|html|css|javascript|xml|rtf))$/i;
if(typeof name!=='string'||name.length>240||!allowed.test(mimeType)||!Number.isFinite(size)||size<=0||size>2*1024*1024*1024)return NextResponse.json({error:'Formato não suportado ou arquivo acima de 2 GB.'},{status:400});
const start=await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files?key='+encodeURIComponent(key),{method:'POST',headers:{'X-Goog-Upload-Protocol':'resumable','X-Goog-Upload-Command':'start','X-Goog-Upload-Header-Content-Length':String(size),'X-Goog-Upload-Header-Content-Type':mimeType,'Content-Type':'application/json'},body:JSON.stringify({file:{display_name:name}})});
if(!start.ok){const detail=await start.text();return NextResponse.json({error:'O Gemini não aceitou o arquivo: '+detail.slice(0,250)},{status:502})}
const uploadUrl=start.headers.get('x-goog-upload-url');if(!uploadUrl)return NextResponse.json({error:'O Gemini não retornou a sessão de envio.'},{status:502});
return NextResponse.json({uploadUrl});
}catch{return NextResponse.json({error:'Não foi possível iniciar o envio do arquivo.'},{status:500})}
}