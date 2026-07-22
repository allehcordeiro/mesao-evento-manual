# Cartas avulsas — integração simplificada

Esta versão foi integrada diretamente ao projeto funcional enviado. Ela não cria outro aplicativo e não altera o `wrangler.json`.

## O que foi adicionado

- produto genérico **Cartas avulsas**;
- seleção e criação de pastas no momento da venda;
- fotografia do lote pelo celular;
- compressão da foto antes do envio;
- armazenamento temporário da foto no D1 por 7 dias;
- OCR comum com Tesseract.js executado no navegador;
- conferência e correção manual dos nomes;
- validação de carta e edição pelo Scryfall;
- botão para abrir a carta na LigaMagic;
- preço, condição, acabamento e quantidade por carta;
- soma automática;
- um único item na comanda com acesso ao detalhamento completo.

## O que não foi alterado

- login por PIN;
- check-in;
- comandas existentes;
- pagamentos;
- cozinha;
- configuração do evento;
- bindings do Cloudflare;
- `package.json` e `package-lock.json`.

## Publicação

### 1. Aplique a nova migration no D1

No terminal do projeto:

```bash
npm run db:remote
```

Isso executará `migrations/0002_card_orders.sql`.

> Aplique a migration antes de publicar o novo código. O Worker passa a consultar as novas tabelas.

### 2. Envie a pasta para o GitHub

Publique normalmente pelo fluxo já usado no projeto.

Não é necessário criar:

- R2;
- Queue;
- Workers AI;
- novos bindings;
- novas variáveis de ambiente.

## Como usar no celular

1. Abra uma comanda.
2. Toque em **Adicionar**.
3. Selecione **Cartas avulsas**.
4. Escolha a pasta ou cadastre uma nova.
5. Informe quantas cartas aparecerão na foto.
6. Organize as cartas em grade, da esquerda para a direita.
7. Tire a fotografia.
8. Toque em **Ler nomes com OCR** ou preencha manualmente.
9. Confira cada carta no Scryfall e escolha a edição correta.
10. Abra a LigaMagic, consulte o preço e informe o valor.
11. Toque em **Adicionar à comanda**.

## Fotografia no D1

A imagem é comprimida no celular e limitada pelo sistema antes do envio.

A foto é armazenada em `card_orders.photo_data_url` e removida automaticamente após 7 dias quando o aplicativo carregar o bootstrap ou abrir os detalhes do pedido.

Depois da remoção da foto, continuam salvos:

- pasta;
- nomes das cartas;
- edição;
- número de colecionador;
- condição;
- acabamento;
- quantidades;
- preços;
- imagem pública do Scryfall;
- total do pedido.

## OCR

O OCR é carregado pelo navegador somente quando necessário, usando Tesseract.js.

Caso o OCR não carregue ou não reconheça uma carta, o fluxo não trava: basta digitar o nome manualmente e continuar a venda.

## Arquivos adicionados

- `migrations/0002_card_orders.sql`
- `src/components/CardOrderFlow.tsx`
- `src/components/CardOrderDetails.tsx`
- `CARTAS-AVULSAS.md`

## Arquivos alterados

- `database/schema.sql`
- `index.html`
- `src/App.tsx`
- `src/components/TabDrawer.tsx`
- `src/lib/api.ts`
- `src/styles.css`
- `src/types.ts`
- `worker/index.ts`
