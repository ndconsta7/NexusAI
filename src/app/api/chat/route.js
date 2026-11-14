import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const maxDuration = 60;
function valid(token) {
  const secret = process.env.NEXUS_SESSION_SECRET;
  if (!secret || !token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || Number(payload) < Date.now()) return false;
  const a = Buffer.from(signature), b = Buffer.from(createHmac('sha256', secret).update(payload).digest('hex'));
  return a.length === b.length && timingSafeEqual(a, b);
}
const SYSTEM = 'Você é a Nexus AI, uma assistente avançada, prestativa e tecnicamente competente. Responda em português brasileiro por padrão. Você é especialista em programação, arquitetura de software, análise de arquivos, imagens, vídeos, documentos, pesquisa e resolução de problemas. Quando o usuário pedir para criar ou alterar um site, produza uma solução completa e funcional em HTML, CSS e JavaScript, preferencialmente em um único bloco de código identificado como html para que a interface possa exibir uma prévia executável. Não substitua código por explicações vagas. Inclua responsividade, acessibilidade e boas práticas. Quando receber arquivos, imagens, áudio, vídeo ou documentos, analise o conteúdo enviado. Nunca diga que abriu ou analisou um arquivo se ele não estiver anexado. Não invente testes, resultados, acessos, commits ou ações externas.';
export async function POST(req) {
  try {
    if (!valid(req.cookies.get('nexus_session')?.value)) return NextResponse.json({error:'Sessão expirada. Entre novamente.'},{status:401});
    const key = process.env.GEMINI_API_KEY;
    if (!key) return NextResponse.json({error:'GEMINI_API_KEY não está configurada na Vercel.'},{status:503});
    const body = await req.json();
    const {message,history=[],files=[],model='gemini-3.8-flash'} = body;
    if (typeof message !== 'string' || !message.trim() || message.length > 30000 || !Array.isArray(history) || !Array.isArray(files) || files.length > 5) {
      return NextResponse.json({error:'Mensagem ou anexos inválidos.'},{status:400});
    }
    const allowed = ['gemini-3.8-flash','gemini-4-carbon'];
    const selected = allowed.includes(model) ? model : 'gemini-3.8-flash';
    const contents = history.slice(-20).map(item => ({role:item.role==='model'?'model':'user',parts:[{text:String(item.text||'').slice(0,30000)}]}));
    const parts = [{text:message}];
    for (const file of files) {
      if (typeof file.uri !== 'string' || !/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/files\/[a-z0-9-]+$/i.test(file.uri) ||
          typeof file.name !== 'string' || !/^files\/[a-z0-9-]+$/i.test(file.name) || typeof file.mimeType !== 'string') {
        return NextResponse.json({error:'Referência de arquivo inválida.'},{status:400});
      }
      parts.push({fileData:{mimeType:file.mimeType,fileUri:file.uri}});
    }
    contents.push({role:'user',parts});
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+selected+':generateContent?key='+encodeURIComponent(key), {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({systemInstruction:{parts:[{text:SYSTEM}]},contents,generationConfig:{temperature:0.7,maxOutputTokens:8192}}),
      signal:AbortSignal.timeout(55000)
    });
    const data = await response.json();
    if (!response.ok) return NextResponse.json({error:data?.error?.message||'O serviço Gemini retornou um erro.'},{status:response.status>=500?502:response.status});
    const text = (data.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought&&p.text).map(p=>p.text).join('\n').trim();
    if (!text) return NextResponse.json({error:'A IA não retornou texto. Tente novamente.'},{status:502});
    return NextResponse.json({text,model:selected});
  } catch (error) {
    return NextResponse.json({error:error?.name==='TimeoutError'?'A resposta demorou demais. Tente novamente.':'Falha ao conversar com a Nexus. Tente novamente.'},{status:500});
  }
}