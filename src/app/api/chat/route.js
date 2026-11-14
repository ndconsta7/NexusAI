import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

function valid(token) {
  const secret = process.env.NEXUS_SESSION_SECRET;
  if (!secret || !token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || Number(payload) < Date.now()) return false;
  const a = Buffer.from(signature);
  const b = Buffer.from(createHmac('sha256', secret).update(payload).digest('hex'));
  return a.length === b.length && timingSafeEqual(a, b);
}

const SYSTEM = 'Você é a Nexus AI, uma assistente avançada, prestativa e tecnicamente competente. Responda em português brasileiro por padrão. Você é especialista em programação, arquitetura de software, análise de arquivos, imagens, vídeos, documentos, pesquisa e resolução de problemas. Quando o usuário pedir para criar ou alterar um site, produza uma solução completa e funcional em HTML, CSS e JavaScript, preferencialmente em um único bloco de código identificado como html para que a interface possa exibir uma prévia executável. Não substitua código por explicações vagas. Inclua responsividade, acessibilidade e boas práticas. Quando receber arquivos, imagens, áudio, vídeo ou documentos, analise o conteúdo enviado. Nunca diga que abriu ou analisou um arquivo se ele não estiver anexado. Não invente testes, resultados, acessos, commits ou ações externas.';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function generate(modelId, key, requestBody, timeoutMs = 18000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(modelId) +
        ':generateContent?key=' + encodeURIComponent(key),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        signal: controller.signal,
        cache: 'no-store'
      }
    );
    const data = await response.json().catch(() => ({}));
    return { response, data, timedOut: false };
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      return { response: null, data: {}, timedOut: true };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req) {
  if (!valid(req.cookies.get('nexus_session')?.value)) {
    return NextResponse.json({ error: 'Sessão expirada. Entre novamente.' }, { status: 401 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não está configurada na Vercel.' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const { message, history = [], files = [], model = 'gemini-3.8-flash' } = body || {};
    if (typeof message !== 'string' || !message.trim() || message.length > 30000 ||
        !Array.isArray(history) || !Array.isArray(files) || files.length > 5) {
      return NextResponse.json({ error: 'Mensagem ou anexos inválidos.' }, { status: 400 });
    }

    const allowed = ['gemini-3.8-flash', 'gemini-4-carbon'];
    const selected = allowed.includes(model) ? model : 'gemini-3.8-flash';
    const contents = history.slice(-12).map(item => ({
      role: item.role === 'model' ? 'model' : 'user',
      parts: [{ text: String(item.text || '').slice(0, 16000) }]
    }));
    const parts = [{ text: message }];
    for (const file of files) {
      if (typeof file.uri !== 'string' ||
          !/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/files\/[a-z0-9-]+$/i.test(file.uri) ||
          typeof file.name !== 'string' || !/^files\/[a-z0-9-]+$/i.test(file.name) ||
          typeof file.mimeType !== 'string') {
        return NextResponse.json({ error: 'Referência de arquivo inválida.' }, { status: 400 });
      }
      parts.push({ fileData: { mimeType: file.mimeType, fileUri: file.uri } });
    }
    contents.push({ role: 'user', parts });

    const requestBody = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      generationConfig: { temperature: 0.65, maxOutputTokens: 4096 }
    });

    // Uma tentativa curta de recuperação para sobrecarga; em timeout, troca de modelo.
    let usedModel = selected;
    let result = await generate(usedModel, key, requestBody, 18000);
    const retryable = result.timedOut || result.response?.status === 503 || result.response?.status === 429;

    if (result.response && retryable) {
      await sleep(350);
      result = await generate(usedModel, key, requestBody, 14000);
    }

    if (result.timedOut || result.response?.status === 503 || result.response?.status === 429) {
      usedModel = selected === 'gemini-3.8-flash' ? 'gemini-3.7-flash' : 'gemini-3.8-flash';
      result = await generate(usedModel, key, requestBody, 18000);
    }

    if (result.timedOut || !result.response) {
      return NextResponse.json({
        error: 'O Gemini demorou para responder mesmo após a troca automática de modelo. Tente enviar novamente; sua conversa continua disponível.'
      }, { status: 504 });
    }

    if (!result.response.ok) {
      const detail = result.data?.error?.message;
      const overloaded = result.response.status === 503 || result.response.status === 429;
      return NextResponse.json({
        error: overloaded
          ? 'Os modelos de IA estão temporariamente ocupados. A Nexus tentou o modelo alternativo; tente novamente em alguns segundos.'
          : (detail || 'O serviço Gemini retornou um erro.')
      }, { status: result.response.status >= 500 ? 502 : result.response.status });
    }

    const text = (result.data.candidates?.[0]?.content?.parts || [])
      .filter(part => !part.thought && part.text)
      .map(part => part.text)
      .join('\n')
      .trim();

    if (!text) {
      const reason = result.data.candidates?.[0]?.finishReason;
      return NextResponse.json({
        error: reason === 'MAX_TOKENS'
          ? 'A resposta ficou muito extensa. Peça para a Nexus continuar.'
          : 'A IA não retornou texto. Tente novamente.'
      }, { status: 502 });
    }

    return NextResponse.json({ text, model: usedModel, fallback: usedModel !== selected });
  } catch (error) {
    return NextResponse.json({
      error: error?.name === 'SyntaxError'
        ? 'Não foi possível interpretar a mensagem enviada.'
        : 'Falha de conexão ao conversar com a Nexus. Tente novamente.'
    }, { status: 500 });
  }
}
