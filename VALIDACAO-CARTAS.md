# Validação da integração de cartas avulsas

## Escopo preservado

Não foram alterados:

- `wrangler.json`;
- `package.json`;
- `package-lock.json`;
- login por PIN;
- check-in;
- pagamentos;
- cozinha;
- configuração do evento;
- estrutura de navegação principal.

## Arquivos novos

- `migrations/0002_card_orders.sql`
- `src/components/CardOrderFlow.tsx`
- `src/components/CardOrderDetails.tsx`
- `CARTAS-AVULSAS.md`
- `VALIDACAO-CARTAS.md`

## Arquivos alterados

- `database/schema.sql`
- `index.html`
- `README.md`
- `LEIA-ME.md`
- `src/App.tsx`
- `src/components/TabDrawer.tsx`
- `src/lib/api.ts`
- `src/styles.css`
- `src/types.ts`
- `worker/index.ts`

## Verificações realizadas

- aplicação conjunta das migrations `0001` e `0002` em SQLite com chaves estrangeiras habilitadas;
- aplicação do `database/schema.sql` completo em banco vazio;
- criação do produto `prod_single_cards` e vínculo com o evento existente;
- criação de pasta, pedido, itens de carta e item único da comanda;
- leitura do vínculo `tab_items.card_order_id` com os detalhes do pedido;
- exclusão do item da comanda e limpeza dos detalhes relacionados;
- análise sintática dos arquivos TypeScript e TSX;
- confirmação de que `package.json`, `package-lock.json` e `wrangler.json` permaneceram iguais aos originais.

## Não executado

O build completo com `npm run build` não foi executado porque as dependências não estavam instaladas no ambiente e a instalação pelo registry não concluiu. O usuário fará os testes funcionais e de publicação.

## Ordem segura para publicar

1. Executar `npm install` no projeto.
2. Executar `npm run build`.
3. Aplicar a migration com `npm run db:remote`.
4. Publicar o novo código.

A migration deve ser aplicada antes de o Worker novo entrar em produção, pois o Worker passa a consultar as tabelas de cartas.
