# Configuração manual na Cloudflare

Este guia considera que o projeto já foi enviado para um repositório do GitHub.

## Antes de começar

Você precisa de:

- conta gratuita na Cloudflare;
- repositório do projeto no GitHub;
- acesso para editar o arquivo `wrangler.json` no repositório.

---

## 1. Criar o banco D1

1. Entre no painel da Cloudflare.
2. Abra **Storage & databases**.
3. Entre em **D1 SQL Database**.
4. Clique em **Create database**.
5. Use exatamente este nome:

```text
mesao-evento-db
```

6. Confirme a criação.
7. Na página do banco, copie o **Database ID**.

Ele terá um formato semelhante a:

```text
12345678-abcd-1234-abcd-1234567890ab
```

---

## 2. Colocar o ID do banco no projeto

No GitHub, abra o arquivo:

```text
wrangler.json
```

Localize:

```json
"database_id": "00000000-0000-0000-0000-000000000000"
```

Troque somente o valor pelo ID copiado no painel:

```json
"database_id": "SEU-ID-REAL-AQUI"
```

Não altere estes dois valores:

```json
"binding": "DB"
"database_name": "mesao-evento-db"
```

Salve o arquivo no GitHub.

---

## 3. Criar as tabelas e os produtos

1. Volte ao banco `mesao-evento-db` no painel da Cloudflare.
2. Abra a aba **Console**.
3. No projeto, abra o arquivo:

```text
database/schema.sql
```

4. Copie todo o conteúdo.
5. Cole no Console do D1.
6. Clique em **Execute**.

Ao terminar, abra **Tables**. Devem aparecer tabelas como:

```text
events
people
attendances
products
event_products
tabs
tab_items
payments
```

A execução também cria um evento piloto e carrega os produtos iniciais.

---

## 4. Criar o aplicativo a partir do GitHub

1. No painel da Cloudflare, abra **Workers & Pages**.
2. Clique em **Create application**.
3. Em **Import a repository**, clique em **Get started**.
4. Conecte sua conta do GitHub.
5. Escolha o repositório do Mesão Evento.
6. Configure:

```text
Project/Worker name: mesao-evento
Production branch: main
Build command: npm run build
Deploy command: npx wrangler deploy
Root directory: /
```

Se o campo de diretório raiz aceitar vazio, pode deixá-lo vazio, pois o projeto está na raiz do repositório.

7. Clique em **Save and Deploy**.

O nome do Worker precisa permanecer `mesao-evento`, igual ao campo `name` do arquivo `wrangler.json`.

---

## 5. Criar os segredos do aplicativo

Depois do primeiro deploy:

1. Entre no Worker `mesao-evento`.
2. Abra **Settings**.
3. Entre em **Variables and Secrets**.
4. Clique em **Add**.

Crie o primeiro segredo:

```text
Type: Secret
Variable name: APP_PIN
Value: escolha o PIN da equipe
```

Exemplo de PIN:

```text
4827
```

Crie o segundo segredo:

```text
Type: Secret
Variable name: SESSION_SECRET
Value: uma sequência longa e aleatória
```

Para gerar essa sequência no PowerShell, você pode executar:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

Copie o resultado para `SESSION_SECRET`.

5. Clique em **Deploy** para aplicar os segredos.

Não coloque esses dois valores no GitHub.

---

## 6. Conferir o vínculo com o D1

No Worker:

1. Abra **Settings**.
2. Entre em **Bindings**.
3. Confirme que existe:

```text
Variable name: DB
Resource: mesao-evento-db
```

Esse vínculo deve ser criado a partir do `wrangler.json` durante o deploy.

---

## 7. Abrir o aplicativo

1. Entre na aba **Deployments** do Worker.
2. Abra o endereço terminado em:

```text
.workers.dev
```

3. Use o PIN salvo em `APP_PIN`.

---

## 8. Instalar no celular

### Android / Chrome

1. Abra o endereço do aplicativo.
2. Toque no menu do Chrome.
3. Escolha **Adicionar à tela inicial** ou **Instalar app**.

### iPhone / Safari

1. Abra o endereço no Safari.
2. Toque em **Compartilhar**.
3. Escolha **Adicionar à Tela de Início**.

---

## Atualizações futuras

Sempre que você alterar o código e enviar um novo commit para a branch `main`, a Cloudflare executará novamente:

```text
npm run build
npx wrangler deploy
```

O banco e os segredos não precisam ser recriados.

Para mudanças futuras no banco, use novos arquivos dentro da pasta `migrations` e aplique a migration de forma controlada.

---

## Checklist final

- [ ] Banco `mesao-evento-db` criado
- [ ] Database ID colocado no `wrangler.json`
- [ ] `database/schema.sql` executado
- [ ] Repositório conectado em Workers & Pages
- [ ] Build concluído
- [ ] Segredo `APP_PIN` criado
- [ ] Segredo `SESSION_SECRET` criado
- [ ] Binding `DB` apontando para `mesao-evento-db`
- [ ] Login testado pelo endereço `.workers.dev`
