# Nexus AI

Aplicação Next.js da Nexus AI.

## Configuração

Configure estas variáveis no painel da Vercel (Project Settings → Environment Variables):

- `GEMINI_API_KEY`: chave da Google AI Studio / Gemini API.
- `NEXUS_ACCESS_PASSWORD`: senha privada usada na tela de acesso.
- `NEXUS_SESSION_SECRET`: segredo aleatório longo usado para assinar sessões.

Não coloque valores secretos neste repositório.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Recursos

- Chat multimodal com Gemini.
- Upload resumível de arquivos, imagens, áudio e vídeo via Gemini Files API.
- Geração de HTML com pré-visualização isolada no chat.
- Sessão privada com cookie HTTP-only.
