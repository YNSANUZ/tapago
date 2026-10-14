# TáPago

Aplicativo responsivo para acompanhar taxas e despesas compartilhadas. O frontend estático usa Supabase Auth, PostgreSQL com RLS e Realtime; desenvolvimento local usa somente as configurações do `.env`.

## Desenvolvimento

1. Instale Node.js 20.19+ ou 22.12+.
2. Copie `.env.example` para `.env` e preencha a URL e a chave pública do projeto Supabase local ou TáPago.
3. `npm install`
4. `npm run dev`
5. `npm test` e `npm run build`

O bundle público precisa de `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. A chave `service_role` nunca pode ser usada no navegador. A segurança depende de RLS e validação das funções do banco.

## Supabase local

Consulte `docs/OPERATIONS.md` para iniciar o stack local, aplicar migrações e rodar os testes de banco. O ambiente local e as amostras fictícias não alteram NEXO Contas nem projetos remotos.

## Publicação

O build em `dist/` assume o caminho `/tapago/`. Nenhum artefato deste aplicativo deve ser copiado para a raiz do repositório pai. Produção usa um projeto Supabase exclusivo e uma configuração Google OAuth exclusiva do TáPago.
