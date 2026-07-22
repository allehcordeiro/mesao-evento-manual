# Mesão Evento

Aplicativo mobile/PWA para operação dos eventos do **Mesão do Amor**.

## O que já está no projeto

- React + TypeScript
- Cloudflare Worker
- Cloudflare D1
- PWA instalável no celular
- login por PIN
- dashboard do evento
- participantes e check-in
- comandas e produtos
- pagamentos
- fila de preparo
- carga inicial de produtos da planilha atual
- venda mobile de cartas avulsas com OCR opcional, Scryfall e LigaMagic

## Comece por aqui

Leia o arquivo **CONFIGURAR-CLOUDFLARE.md**. Para o novo fluxo de cartas, consulte também **CARTAS-AVULSAS.md**. Ele explica a configuração manual do D1, do Worker, dos segredos e da publicação pelo GitHub.

## Teste local

1. Copie `.dev.vars.example` para `.dev.vars`.
2. Execute:

```bash
npm install
npm run dev
```

3. Abra o endereço mostrado no terminal.
4. PIN local padrão: `1234`.

## Arquivos importantes

- `wrangler.json`: configuração do Worker e vínculo com o D1.
- `database/schema.sql`: criação das tabelas e carga inicial.
- `migrations/0001_initial.sql`: estrutura inicial.
- `migrations/0002_card_orders.sql`: fluxo de cartas avulsas.
- `worker/index.ts`: API e regras de negócio.
- `src/`: interface do aplicativo.
