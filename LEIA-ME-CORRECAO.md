# Correção da instalação no Cloudflare Workers Builds

Substitua o `package-lock.json` da raiz do repositório pelo arquivo deste pacote e adicione o arquivo `.npmrc` também na raiz.

Depois:

1. Faça commit e push dos dois arquivos.
2. No painel da Cloudflare, abra o Worker.
3. Vá em Settings > Build > Build cache.
4. Clique em Clear Cache.
5. Abra Deployments/Build history e tente o build novamente.

Não execute novamente a migration do D1 por causa deste erro. A falha ocorreu durante a instalação das dependências, antes do build e do deploy.
