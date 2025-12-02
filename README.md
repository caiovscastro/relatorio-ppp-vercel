# Relatório PPP (Vercel)

Aplicação web com páginas estáticas e funções serverless na Vercel para controlar acessos e registrar consultas em planilhas do Google Sheets. O foco é permitir que diferentes perfis (usuário PPP, gestor PPP e efetividade operacional) acessem seus respectivos painéis e gravem consultas diretamente nas abas configuradas do Spreadsheet.

## Visão geral
- **Páginas**: telas de login (`login.html`, `login-gestor.html`, `login-efetividade.html`), seleção inicial (`index.html`) e painéis (`painel.html`, `painel-gestor.html`, `painel-efetividade.html`).
- **APIs**: funções em `api/` para login e leitura/gravação de dados na planilha.
- **Persistência**: usa uma conta de serviço do Google e um Spreadsheet configurado por variáveis de ambiente.

## Variáveis de ambiente
Configure estas variáveis na Vercel (ou em um `.env.local` se estiver usando `vercel dev`) para habilitar o acesso à planilha:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: e-mail da conta de serviço.
- `GOOGLE_PRIVATE_KEY`: chave privada da conta de serviço (mantenha as quebras de linha como `\n`).
- `SPREADSHEET_ID`: ID do documento do Google Sheets que contém as abas `RELATORIO` e demais bases.
- `SPREADSHEET_ID_EFETIVIDADE`: ID específico da planilha usada pelo módulo de Efetividade (BASE_DADOS e LANCADOS). **Não compartilhe este ID com a planilha PPP**; se faltar, a API de Efetividade não tenta mais cair na planilha principal e retornará um erro de configuração claro.

Dicas rápidas:
- Na Vercel, cole a chave privada já com `\n` no lugar de cada quebra de linha; se usar o editor multiline, converta com `\n` ao salvar.
- Confirme se a conta de serviço tem acesso de edição à planilha compartilhada.

## Execução local
1. Instale dependências: `npm install`.
2. Inicie um dev server (por exemplo, `npx vercel dev` ou outro servidor estático) a partir da raiz do projeto para servir as páginas e rotas `/api`.
3. Copie o `.env.example` para `.env.local` (se existir) ou defina as variáveis acima no ambiente antes de subir o dev server.
4. Acesse `http://localhost:3000/index.html` para escolher o painel adequado.

Se usar outro servidor estático (como `npx http-server .`), lembre-se de que as rotas em `api/` precisam ser executadas como funções serverless; o comportamento completo é reproduzido com `vercel dev`.

## Estrutura de login e sessões
- `login.html` grava a sessão do usuário PPP em `localStorage` com a chave `pppSession`.
- `login-gestor.html` salva o login do gestor em `sessionStorage` (chave `PPP_LOGIN_GESTOR`).
- `login-efetividade.html` mantém uma sessão independente em `localStorage` (`efetividadeSession`).

Os painéis consomem essas sessões; se não encontrarem dados válidos, bloqueiam o acesso.

## Dicas de manutenção
- Atualize as listas de usuários permitidos diretamente nos arquivos `api/login.js`, `api/login-gestor.js` e `api/login-efetividade.js` ou migre para planilhas conforme necessário.
- A base de produtos e relatórios é lida/escrita pelas funções em `api/relatorios.js`, `api/relatorio.js`, `api/produtos.js` e `api/efetividade-*`. Ajuste os ranges conforme o layout das abas na planilha.
