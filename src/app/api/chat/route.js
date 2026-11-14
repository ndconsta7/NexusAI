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

async function generate(modelId, key, requestBody) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
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
    return { response, data };
  } catch (error) {
    return { response: null, data: {}, timedOut: error?.name === 'AbortError' || error?.name === 'TimeoutError' };
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
    const contents = history.slice(-6).map(item => ({
      role: item.role === 'model' ? 'model' : 'user',
      parts: [{ text: String(item.text || '').slice(0, 6000) }]
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
      generationConfig: { temperature: 0.65, maxOutputTokens: 3072 }
    });

    // Prioriza latência: no máximo um fallback independente após o modelo escolhido.
    // Evita uma cadeia longa de tentativas que deixa o usuário esperando.
    const candidates = [...new Set([selected, 'gemini-3.6-flash'])];

    let lastFailure = null;
    for (const modelId of candidates) {
      const result = await generate(modelId, key, requestBody);

      if (result.response?.ok) {
        const answer = (result.data.candidates?.[0]?.content?.parts || [])
          .filter(part => !part.thought && part.text)
          .map(part => part.text)
          .join('\n')
          .trim();
        if (!answer) {
          return NextResponse.json({ error: 'O modelo ' + modelId + ' não retornou texto. Tente novamente.' }, { status: 502 });
        }
        return NextResponse.json({
          text: answer,
          model: modelId,
          fallback: modelId !== selected
        });
      }

      if (!result.response) {
        lastFailure = {
          model: modelId,
          status: result.timedOut ? 504 : 502,
          message: result.timedOut ? 'O modelo excedeu o tempo limite.' : 'Falha de conexão com o Google.'
        };
        continue;
      }

      const status = result.response.status;
      const googleMessage = result.data?.error?.message || 'O Google não informou detalhes.';
      lastFailure = { model: modelId, status, message: googleMessage };

      // Só avança para outro modelo em indisponibilidade ou limite/quota.
      if (status === 429 || status === 503 || status === 504) continue;

      return NextResponse.json({
        error: 'O Google recusou a solicitação (' + status + '): ' + googleMessage,
        model: modelId
      }, { status: status >= 500 ? 502 : status });
    }

    const quota = lastFailure?.status === 429;
    const timedOut = lastFailure?.status === 504;
    const details = String(lastFailure?.message || '').slice(0, 500);
    return NextResponse.json({
      error: quota
        ? 'A cota da API Gemini foi atingida nos modelos disponíveis. Detalhe do Google: ' + details
        : timedOut
          ? 'Os modelos disponíveis excederam o tempo limite. Último detalhe: ' + details
          : 'Os modelos Gemini estão indisponíveis no momento. Último detalhe do Google: ' + details
    }, { status: quota ? 429 : 503 });
  } catch (error) {
    return NextResponse.json({
      error: error?.name === 'SyntaxError'
        ? 'Não foi possível interpretar a mensagem enviada.'
        : 'Falha interna ao conversar com a Nexus. Tente novamente.'
    }, { status: 500 });
  }
}
