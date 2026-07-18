# Mesão Evento

Use este arquivo apenas como índice rápido.

1. Envie a pasta para o GitHub.
2. Abra **CONFIGURAR-CLOUDFLARE.md**.
3. Crie o D1 manualmente.
4. Cole o ID no `wrangler.json`.
5. Execute `database/schema.sql` no Console do D1.
6. Importe o repositório em **Workers & Pages**.
7. Crie `APP_PIN` e `SESSION_SECRET` em **Variables and Secrets**.

Para testar localmente:

```powershell
Copy-Item .dev.vars.example .dev.vars
npm install
npm run dev
```

PIN local: `1234`.
