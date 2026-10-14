# Segurança

- Nunca coloque arquivos `.env`, chaves `service_role`, tokens OAuth, dados reais ou backups no Git.
- A chave `anon` é pública; ela não substitui as políticas RLS.
- Toda tabela exposta ao cliente precisa de RLS e testes de acesso autorizado/negado.
- Convites são individuais, expirados, revogáveis, de uso único e vinculados ao e-mail Google verificado.
- O link público mostra agregados autorizados, sem perfil, e-mail ou pagamentos individuais.
- Reporte vulnerabilidades ao mantenedor do repositório sem publicar dados pessoais ou segredos em issues.
