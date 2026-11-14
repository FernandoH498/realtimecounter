# Contador em Tempo Real (Vercel Ready)

Projeto pronto para rodar localmente ou fazer deploy direto na **Vercel**.

## 1. Testar Localmente

Na pasta do projeto:
```bash
node server.js
```
Abra no navegador: `http://localhost:3000`

---

## 2. Como Subir na Vercel

1. Suba esta pasta para um repositório no seu **GitHub** (ou use a CLI `vercel` diretamente).
2. Na [Vercel](https://vercel.com):
   - Importe o repositório.
   - O Vercel detecta a pasta `api/` e `public/` automaticamente com o `vercel.json`.
   - Clique em **Deploy**.

### Persistência Global na Vercel (Recomendado):
A Vercel roda funções em instâncias serverless efêmeras. Para o contador ser sincronizado entre todas as regiões e nunca resetar:
1. No dashboard do seu projeto na Vercel, vá em **Storage**.
2. Conecte um banco gratuito **Vercel KV** (ou Upstash Redis).
3. A Vercel injeta as variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN` automaticamente. O código em `api/count.js` já reconhece e usa nativamente via REST sem precisar de pacotes extras.
