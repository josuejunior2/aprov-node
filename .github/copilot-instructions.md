# Instruções do Copilot — Plataforma de Aprovação de Conteúdo para Agências de Social Media

## Visão geral do projeto

Sistema multiagência (multi-tenant) onde agências de social media montam catálogos de publicações para seus clientes. O cliente visualiza cada catálogo, comenta, aprova, reprova ou solicita ajustes.

Hierarquia do domínio:

```
Admin (plataforma)
└── Agência (N)
    ├── Agente (N)        → faz login e opera dentro da sua agência
    └── Cliente (N)
        └── Catálogo (N)
            └── Publicação (N) → fotos/vídeos + descrição
                ├── Comentários
                ├── Decisão (aprovada / reprovada / ajustes)
                └── Ajustes solicitados
```

## Stack

- **Monorepo** com npm workspaces:
  - `apps/web`: Next.js (App Router) + React + TypeScript + Tailwind CSS
  - `apps/api`: Node.js + Express + TypeScript
  - `packages/shared`: tipos e schemas Zod compartilhados entre front e back
- **Banco de dados:** PostgreSQL com Prisma ORM
- **Validação:** Zod (em toda entrada de dados, no front e no back)
- **Autenticação:**
  - `SUPER_ADMIN` e `AGENT`: e-mail e senha, com JWT em cookie `httpOnly` + `secure` + `sameSite`
  - `CLIENT`: **sem conta e sem senha**. O acesso é feito por **magic link** gerado pelo agente para um catálogo específico (ver seção "Acesso do cliente por magic link")
- **Mídia (fotos/vídeos):** storage compatível com S3, com upload direto por URL pré-assinada. O banco guarda apenas metadados e a chave do arquivo.
- **Testes:** Vitest + Supertest (API), Testing Library (componentes), Playwright (e2e)

Use sempre as versões declaradas nos `package.json`. Não sugira APIs depreciadas, em especial o Pages Router do Next.js (`pages/`, `getServerSideProps`, `getStaticProps`). Em caso de dúvida sobre uma API, consulte a documentação oficial da versão instalada.

## Glossário (termos do negócio → nomes no código)

O código, os nomes de variáveis, tabelas e rotas ficam **em inglês**. A interface do usuário fica **em português do Brasil**.

| Termo do negócio | No código | Observação |
|---|---|---|
| Admin | `SUPER_ADMIN` | Gerencia a plataforma e as agências |
| Agência | `Agency` | Unidade de isolamento (tenant) |
| Agente | `Agent` | Usuário que pertence a uma agência |
| Cliente | `Client` | Cliente final da agência, quem aprova |
| Catálogo | `Catalog` | Conjunto de publicações de um cliente |
| Publicação | `Post` | Itens de mídia + descrição |
| Comentário | `Comment` | Feito por agente ou cliente |
| Aprovação | `Approval` | Decisão do cliente sobre uma publicação ou catálogo |
| Ajuste | `Adjustment` | Solicitação de mudança, com ciclo de vida próprio |
| Link de acesso | `AccessLink` | Magic link que dá ao cliente acesso a um catálogo |

## Perfis e permissões

- **SUPER_ADMIN:** cria, edita e desativa agências. Não pertence a nenhuma agência.
- **AGENT:** pertence a **exatamente uma** agência. Gerencia clientes, catálogos e publicações **somente da própria agência**. Responde comentários e resolve ajustes.
- **CLIENT:** não tem conta nem senha. Entra por um **magic link** e acessa **somente o catálogo** ao qual o link dá acesso. Pode visualizar, comentar, aprovar, reprovar e solicitar ajustes. Não edita publicações.

## Regra de ouro: isolamento entre agências

Dados de uma agência **nunca** podem ser acessados por outra. Isso é a regra de segurança mais importante do sistema.

- Todo registro de negócio carrega, direta ou indiretamente, o `agencyId`.
- Toda query e mutation feita por um `AGENT` **deve** filtrar pelo `agencyId` vindo da sessão (nunca de parâmetro enviado pelo cliente).
- Toda query feita por um `CLIENT` **deve** filtrar pelo `catalogId` e `clientId` da sessão do magic link. O link nunca dá acesso a outro catálogo, nem a outros dados do mesmo cliente.
- Nunca confie em IDs vindos da URL ou do body sem verificar que pertencem ao tenant da sessão.
- Ao criar um endpoint novo, escreva um teste que tenta acessar o recurso com um usuário de **outra** agência e espera `404` ou `403`.

## Modelo de dados (resumo)

- `Agency` 1—N `Agent`
- `Agency` 1—N `Client`
- `Client` 1—N `Catalog`
- `Catalog` 1—N `Post`
- `Post` 1—N `MediaItem` (`type`: `IMAGE` | `VIDEO`, `storageKey`, `mimeType`, `size`, `order`)
- `Catalog` 1—N `AccessLink` (`tokenHash`, `clientId`, `expiresAt`, `revokedAt`, `lastUsedAt`, `createdByAgentId`). Guarde **apenas o hash** do token, nunca o token em texto puro.
- `Post` 1—N `Comment` (autor: agente, ou cliente identificado pelo `authorName` informado no primeiro acesso e pelo `accessLinkId`)
- `Post` 1—N `Adjustment` (e também no nível de `Catalog`)
- `Approval` registra cada decisão com autor, data e observação (histórico, nunca sobrescrever)

Status de `Post`: `DRAFT` | `PENDING_APPROVAL` | `APPROVED` | `REJECTED` | `CHANGES_REQUESTED`
Status de `Catalog`: `DRAFT` | `IN_REVIEW` | `APPROVED` | `CHANGES_REQUESTED`
Status de `Adjustment`: `OPEN` | `IN_PROGRESS` | `DONE`

Regras do fluxo:

1. O agente monta o catálogo em `DRAFT` e o envia ao cliente (`IN_REVIEW`; publicações viram `PENDING_APPROVAL`). Ao enviar, o sistema gera o **magic link** do catálogo, que o agente copia e compartilha com o cliente (WhatsApp, e-mail etc.).
2. O cliente decide por publicação ou pelo catálogo inteiro: aprovar, reprovar ou solicitar ajustes.
3. Solicitar ajustes cria um `Adjustment` com descrição obrigatória e muda o status para `CHANGES_REQUESTED`.
4. O agente resolve o ajuste, marca como `DONE` e reenvia para nova revisão.
5. Toda transição de status é validada no back-end em uma função única (máquina de estados). Nunca altere status diretamente em um controller.
6. Mantenha histórico das decisões. Não apague nem sobrescreva aprovações anteriores.

Use soft delete (`deletedAt`) para agências, clientes, catálogos e publicações.

## Estrutura de pastas

```
apps/
├── web/
│   └── src/
│       ├── app/                 # rotas (App Router)
│       │   ├── (auth)/login/
│       │   ├── admin/           # área do SUPER_ADMIN
│       │   ├── agency/          # área do agente
│       │   └── c/[token]/       # área do cliente (entrada por magic link)
│       ├── components/          # componentes reutilizáveis
│       ├── lib/                 # utilitários, cliente HTTP
│       └── hooks/
└── api/
    └── src/
        ├── modules/<modulo>/    # agencies, agents, clients, catalogs, posts, comments, approvals, adjustments, access-links, auth, media
        │   ├── <modulo>.routes.ts
        │   ├── <modulo>.controller.ts
        │   ├── <modulo>.service.ts
        │   └── <modulo>.schema.ts
        ├── middlewares/         # auth, roles, tenant, error handler
        ├── lib/                 # prisma client, storage, jwt
        └── prisma/              # schema.prisma e migrations
packages/
└── shared/                      # schemas Zod, tipos e enums compartilhados
```

## Convenções de código

- TypeScript em modo `strict`. **Proibido `any`**; use `unknown` e faça o estreitamento do tipo.
- Nomes: componentes em `PascalCase`, funções e variáveis em `camelCase`, arquivos de componentes em `PascalCase.tsx`, demais arquivos em `kebab-case`.
- Back-end em camadas: **route → controller → service → Prisma**. O controller só trata HTTP; regras de negócio ficam no service.
- Valide toda entrada com Zod antes de usar. Reutilize os schemas de `packages/shared`.
- Respostas de erro da API seguem o formato `{ "error": { "code": string, "message": string } }` com status HTTP correto.
- Listagens sempre paginadas.
- No front-end, use **Server Components por padrão**. Adicione `"use client"` somente quando houver estado, efeitos ou eventos do navegador.
- Mutations no front usam Server Actions ou chamadas à API; nunca deixe segredos no código do cliente.
- Estilização apenas com Tailwind. Evite CSS customizado.
- Todo texto visível ao usuário em pt-BR; datas no formato `dd/MM/yyyy` e fuso `America/Sao_Paulo`.
- Interfaces acessíveis: labels em inputs, `alt` em imagens, foco visível, navegação por teclado.
- Comentários no código só para explicar o "porquê", não o "o quê".

## Acesso do cliente por magic link

O cliente não cria conta. Quem tem o link tem acesso, então o link deve ser tratado como uma credencial.

**Geração**
- O agente gera o link para **um catálogo** de **um cliente**. Cada link é um `AccessLink`.
- O token é aleatório e imprevisível: `crypto.randomBytes(32)` em base64url. Nunca use IDs, datas ou UUIDs previsíveis como token.
- Salve somente o **hash SHA-256** do token. O token em texto puro é mostrado ao agente uma única vez, na criação.
- Todo link tem validade (`expiresAt`, padrão de 30 dias, configurável pelo agente) e pode ser **revogado** a qualquer momento (`revokedAt`). O agente também pode gerar um novo link, o que revoga o anterior.

**Uso**
- URL do cliente: `/c/<token>`.
- Ao abrir o link, a API valida o hash, a validade e a revogação, e troca o token por uma **sessão curta** em cookie `httpOnly` + `secure` + `sameSite`, restrita àquele `catalogId` e `clientId`.
- Depois da troca, **redirecione para uma URL sem o token** para que ele não fique no histórico do navegador nem vaze por cabeçalho `Referer`.
- Respostas da área do cliente devem enviar `Referrer-Policy: no-referrer` e `Cache-Control: no-store`.
- No primeiro acesso, peça o **nome** de quem está avaliando (várias pessoas do cliente podem usar o mesmo link). Esse nome é salvo no `Comment` e na `Approval` como `authorName`.
- Link inválido, expirado ou revogado mostra uma mensagem genérica em pt-BR pedindo que o cliente solicite um novo link à agência. Não revele qual dos motivos ocorreu.

**Proteções**
- Rate limit na rota de troca do token, por IP.
- Nunca registre o token em logs (URL, query, erros, analytics). Mascare-o ao logar rotas.
- Atualize `lastUsedAt` a cada acesso, para o agente ver se o cliente abriu o link.
- Catálogo `DRAFT` ou arquivado não pode ser aberto por magic link, mesmo com token válido.

**Fora do escopo por enquanto:** envio automático do link por e-mail. Por ora o agente copia o link e compartilha por conta própria. Não adicione serviço de e-mail sem perguntar.

## Mídia (fotos e vídeos)

- Upload direto do navegador para o storage via URL pré-assinada gerada pela API.
- Valide tipo (MIME real) e tamanho máximo no back-end antes de gerar a URL.
- Gere a URL de leitura assinada e com expiração; arquivos não são públicos.
- Para vídeos, exiba o player nativo com `preload="metadata"`. Para imagens, use `next/image`.

## Comandos

```bash
npm run dev          # sobe web e api em modo desenvolvimento
npm run lint         # ESLint em todos os workspaces
npm run typecheck    # tsc --noEmit
npm run test         # testes unitários e de integração
npm run test:e2e     # Playwright
npx prisma migrate dev --workspace apps/api   # cria/aplica migration
```

Depois de qualquer alteração, rode `npm run lint` e `npm run typecheck` e corrija os erros antes de considerar a tarefa concluída.

## Segurança

- Hash de senhas de agentes e admins com `argon2` ou `bcrypt`. Nunca armazene nem registre senhas em log.
- Tokens de magic link: guarde só o hash, nunca registre em log e siga todas as regras da seção "Acesso do cliente por magic link".
- Segredos somente em `.env` / `.env.local`; nunca versionar. Mantenha um `.env.example` sem valores reais.
- Rate limit em login e em endpoints públicos.
- Autorização sempre no back-end. Esconder um botão no front não é controle de acesso.
- Use o middleware de papéis (`requireRole`) e o middleware de tenant em todas as rotas protegidas.
- Sanitize o conteúdo de comentários e descrições antes de exibir.
- Não exponha erros internos, stack traces ou IDs sequenciais; prefira UUIDs.

## Testes

- Todo endpoint novo precisa de teste de integração cobrindo: caso feliz, entrada inválida, usuário sem permissão e **acesso cross-tenant**.
- Toda transição de status do fluxo de aprovação precisa de teste unitário.
- Magic link precisa de testes para: token válido, token inexistente, token expirado, token revogado, link de catálogo `DRAFT`, e tentativa de usar o link de um catálogo para acessar **outro catálogo** (deve falhar).
- Fluxo crítico para e2e: agente cria catálogo → gera o magic link → cliente abre o link, informa o nome, comenta e solicita ajuste → agente resolve → cliente aprova.

## Como o Copilot deve trabalhar

- Faça mudanças pequenas e focadas, uma funcionalidade por vez.
- Para tarefas grandes, proponha um plano curto antes de implementar.
- Siga os padrões já existentes no repositório antes de inventar um novo.
- **Pergunte antes de** instalar dependências novas, alterar o `schema.prisma`, mudar a estrutura de pastas ou mexer em autenticação.
- Se um requisito estiver ambíguo, pergunte em vez de assumir.
- Não remova testes para fazer a build passar.
- Ao terminar, resuma o que foi alterado e como validar.

## Skills do projeto

As skills ficam em `.github/skills/<nome-da-skill>/SKILL.md`. Antes de executar uma tarefa que se encaixe na descrição de uma skill, consulte-a e siga suas instruções.

Skills planejadas (criar conforme a necessidade):

| Skill | Quando usar |
|---|---|
| `nextjs-page` | Criar páginas e rotas no App Router |
| `react-component` | Criar componentes de UI |
| `api-module` | Criar um módulo novo na API (routes, controller, service, schema) |
| `prisma-migration` | Alterar o modelo de dados com segurança |
| `write-tests` | Escrever testes de integração e e2e |
| `tenant-security-review` | Revisar isolamento entre agências em um endpoint |