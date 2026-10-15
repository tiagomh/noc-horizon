# 🛰️ NOC Horizon

**Central de Operações com monitoramento em tempo real**, construída para visualizar de forma clara e imediata a saúde de uma infraestrutura — hosts, alertas e latência — em quadros por grupo de hosts do Zabbix: verde, amarelo ou vermelho, e um clique mostra os hosts e triggers com problema.

[![CI](https://github.com/Sheila724/noc-horizon/actions/workflows/ci.yml/badge.svg)](https://github.com/Sheila724/noc-horizon/actions/workflows/ci.yml)
![Status](https://img.shields.io/badge/status-em%20produção-22d67a?style=flat-square)
![Backend](https://img.shields.io/badge/backend-Python%20%2B%20Flask-3776AB?style=flat-square&logo=python&logoColor=white)
![Dados](https://img.shields.io/badge/dados-Zabbix%20API-ff9a3d?style=flat-square)
![Frontend](https://img.shields.io/badge/frontend-JS%20puro-f0c93d?style=flat-square)
![Testes](https://img.shields.io/badge/testes-pytest-0a9edc?style=flat-square&logo=pytest&logoColor=white)
![Lint](https://img.shields.io/badge/lint-ruff-d7ff64?style=flat-square&logo=ruff&logoColor=black)
![Segredos](https://img.shields.io/badge/segredos-gitleaks-ff3b5c?style=flat-square)
![Docker](https://img.shields.io/badge/docker-compose-2496ED?style=flat-square&logo=docker&logoColor=white)
![Licença](https://img.shields.io/badge/license-MIT-7d8bab?style=flat-square)

---

## ⚡ Teste em 1 minuto (sem Zabbix)

Só precisa do [Docker](https://docs.docker.com/get-docker/):

```bash
git clone https://github.com/Sheila724/noc-horizon.git
cd noc-horizon
docker compose up -d --build
```

Abra **http://localhost:8080** 🚀

O painel sobe em **modo demo**: 10 grupos de hosts (sites e funções, como num Zabbix real) e 21 hosts simulados, com incidentes que aparecem, são reconhecidos e resolvidos sozinhos, um host em manutenção e outro que para de enviar dados de tempos em tempos. Para desligar: `docker compose down`.

**Sem Docker?** Com Python 3.10+ também dá:

```bash
pip install -r backend/requirements.txt
python backend/dev_server.py
```

> Quer ligar no seu Zabbix? Copie `.env.example` para `.env`, defina `NOC_MODE=zabbix`, `ZABBIX_URL` e `ZABBIX_API_TOKEN`, e rode `docker compose up -d --build` de novo.

---

## 📺 Demonstração

> Os vídeos abaixo são da versão anterior do painel (com o globo). A visão atual é a de quadros por grupo de hosts — rode o modo demo para ver (seção *Teste em 1 minuto*).

**Visão geral do dashboard:**

https://github.com/user-attachments/assets/ddbfa4f6-a8f8-4421-b15a-42b760ef7bef

**Interações e detalhes operacionais:**

https://github.com/user-attachments/assets/6822855c-ed64-4944-84a4-fa0967a7dde9

---

## ✨ Visão Geral

O **NOC Horizon** é um painel de monitoramento (NOC — *Network Operations Center*) que consome dados em tempo real do **Zabbix** e os apresenta como **quadros, um por grupo de hosts**. Cada quadro tem a cor do pior problema ativo do grupo: 🟢 tudo OK, 🟡 só triggers de severidade baixa, 🔴 algum trigger de severidade alta (⚪ quando um host para de enviar dados). Clicar no quadro abre os hosts com problema e os triggers de cada um.

O objetivo é dar, em poucos segundos, uma leitura visual e intuitiva do estado da operação — sem precisar navegar por múltiplas telas do Zabbix.

---

## 🚀 Funcionalidades

- 🟩 **Quadros por grupo de hosts** do Zabbix, ordenados do pior para o melhor (vermelho, amarelo, cinza, verde). Um host em vários grupos aparece em todos eles
- 🔴🟡🟢 **Cores por severidade**: vermelho a partir de *High* (configurável em `js/config.js`), amarelo para as demais
- 🔎 **Clique para expandir**: hosts com problema, severidade, nome do trigger, há quanto tempo está ativo, reconhecido/em manutenção — e a lista dos hosts sem problema
- 🧭 **Filtro** por nome de grupo ou host e opção **"Só com problema"** (lembrada no navegador)
- ⚡ Quadro que **acabou de piorar pisca** por alguns segundos; vermelho pulsa enquanto durar
- ⚪ **Detecção de "sem dados"** — host que para de enviar métricas fica cinza, em vez de continuar verde (falha silenciosa)
- ✅ **Problemas reconhecidos** (*acknowledged*) sinalizados, e **problemas em manutenção** exibidos esmaecidos, sem colorir o grupo
- 📊 **Painel unificado de operação**, mostrando:
  - Total de grupos, hosts e alertas ativos
  - Saúde geral (% de **hosts** sem problema ativo e com dados recentes)
  - Triggers ativos (e quantos já foram reconhecidos)
  - Hosts com problema e hosts sem dados
  - Idade do dado mais antigo coletado
  - Latência da API do Zabbix
- 📰 **Ticker contínuo** no rodapé com os problemas ativos e os hosts sem dados
- 🔄 **Atualização automática** via polling configurável
- ⚡ **Cache no backend** — vários navegadores abertos não multiplicam as consultas ao Zabbix
- 🔐 **Login com OIDC** no Apache (`mod_auth_openidc`): Google, Keycloak, Azure AD ou qualquer provedor OpenID Connect, sem alterar o código
- 📈 **Confiabilidade (SLO)** — disponibilidade de 7 e 30 dias por grupo, orçamento de erro, MTTR e MTTA, calculados a partir do histórico de eventos do Zabbix
- 🔁 **Grupos automáticos** — lidos do Zabbix (`host.get`), sem editar código; filtre por prefixo (`NOC_HOSTGROUP_PREFIX`) ou tag
- 🌐 **Frontend sem build, sem CDN e sem bibliotecas** — HTML, CSS e JS puros

---

## 🏗️ Arquitetura

```
                 Navegador do usuário
                          │  HTTPS
                          ▼
              ┌───────────────────────┐
              │  Apache (proxy + web) │
              │  • /      → frontend  │
              │  • /api/  → backend   │
              └─────┬───────────┬─────┘
       arquivos     │           │  127.0.0.1:5004
       estáticos    ▼           ▼
       ┌──────────────┐   ┌──────────────────┐  JSON-RPC   ┌─────────────┐
       │ Frontend     │   │ Backend (Flask   │ ──────────► │   Zabbix    │
       │ HTML/CSS/JS  │   │ + Gunicorn)      │  token API  │   Server    │
       └──────────────┘   └──────────────────┘ (somente    └─────────────┘
                                                leitura)
```

O **backend em Python** consulta a API do Zabbix, agrega os problemas por grupo de hosts/host e expõe um endpoint JSON (`GET /api/locations`), consumido periodicamente pelo frontend (`js/app.js`) via `fetch`. O backend escuta **somente em `127.0.0.1`**; o acesso externo passa sempre pelo Apache.

---

## 🧰 Stack Técnica

| Camada         | Tecnologia |
|----------------|------------|
| Frontend       | HTML5, CSS3, JavaScript (vanilla) |
| Backend        | Python 3.10+, Flask, Gunicorn |
| Fonte de dados | [Zabbix API](https://www.zabbix.com/documentation/current/en/manual/api) (testado com Zabbix 7.x) |
| Servidor       | Apache (arquivos estáticos + proxy reverso para a API) |

---

## 📁 Estrutura do Projeto

```
noc-horizon/
├── .github/
│   ├── workflows/ci.yml    # CI: lint, testes, pip-audit, bandit, gitleaks
│   └── dependabot.yml      # Atualização semanal de dependências
├── .pre-commit-config.yaml # Hooks locais (gitleaks, ruff)
├── docker-compose.yml      # Sobe frontend + backend (modo demo por padrão)
├── .env.example            # Variáveis do compose (modo, Zabbix, porta)
├── docker/web/             # Imagem do frontend: Nginx sem root + CSP
├── deploy/                 # Modelos de produção: systemd, Apache, login OIDC e script de atualização
├── docs/
│   ├── operacao.md         # Runbook: deploy, segredos, saúde e solução de problemas
│   └── postmortems/        # Análises de incidentes (formato blameless)
├── index.html              # Estrutura da página (header, card, quadros, ticker)
├── favicon.svg
├── css/
│   └── style.css           # Estilos visuais (tema dark, glassmorphism, animações)
├── js/
│   ├── config.js           # Configurações (URL da API, polling, severidade alta, cores)
│   └── app.js              # Busca de dados, quadros dos grupos, card de operação e ticker
├── public/                 # Páginas públicas do login: acesso negado e "você saiu"
└── backend/
    ├── app.py              # Rotas HTTP (/api/locations, /health) + cache
    ├── aggregator.py       # Status por host/grupo e resumo (função pura, testável)
    ├── zabbix_client.py    # Cliente da API JSON-RPC do Zabbix
    ├── demo_source.py      # Dados simulados para o modo demo
    ├── groups.py           # Quadros a partir dos grupos de hosts do Zabbix
    ├── discovery.py        # Grupos pelo campo Location do inventário (opcional)
    ├── sla.py              # Disponibilidade, SLO, orçamento de erro, MTTR e MTTA
    ├── dev_server.py       # Servidor local sem Docker (frontend + API)
    ├── Dockerfile          # Imagem do backend (usuário sem privilégios)
    ├── config.py           # Agrupamento e mapa estático opcional; lê segredos do ambiente
    ├── requirements.txt
    ├── requirements-dev.txt
    ├── pytest.ini
    ├── ruff.toml           # Regras de lint/formatação
    ├── tests/              # Testes da agregação (pytest)
    └── .env.example        # Modelo das variáveis de ambiente (sem segredos)
```

---

## ⚙️ Instalação e Configuração

### Pré-requisitos

- Python 3.10+
- Um servidor Zabbix acessível, com API habilitada
- Apache com os módulos `proxy`, `proxy_http` e `headers`

### 1. Criar um usuário somente leitura no Zabbix

Não use o usuário Admin. No Zabbix:

1. **Users → User roles** → crie um papel do tipo *User*, sem acesso à interface, com **API** permitida apenas para `problem.get`, `trigger.get` e `item.get` mais **`host.get`** (para ler os grupos de hosts) e `event.get` (para a confiabilidade/SLO).
2. **Users → User groups** → crie um grupo com *Frontend access: Disabled* e permissão **Read** apenas nos grupos de hosts exibidos no painel.
3. **Users → Users** → crie o usuário do painel com esse grupo e papel.
4. **Users → API tokens** → gere um token para esse usuário (com data de expiração).

### 2. Configurar as variáveis de ambiente

O backend lê os segredos **somente do ambiente** — nunca coloque token ou URL no código. Use o modelo `backend/.env.example`:

```
ZABBIX_URL=http://127.0.0.1/zabbix/api_jsonrpc.php
ZABBIX_API_TOKEN=coloque-o-token-aqui
```

Para rodar **sem Zabbix**, use `NOC_MODE=demo` — as duas variáveis acima deixam de ser necessárias.

Opcional: `NOC_STALE_AFTER_SECONDS` (padrão `600`) — após quanto tempo sem dados um host aparece como **Sem dados**.

Todas as variáveis:

| Variável | Padrão | Para que serve |
|---|---|---|
| `NOC_MODE` | `zabbix` | `zabbix` (dados reais) ou `demo` (dados simulados, sem Zabbix) |
| `ZABBIX_URL` | — | URL da API (`.../api_jsonrpc.php`). Obrigatória no modo `zabbix` |
| `ZABBIX_API_TOKEN` | — | Token de um usuário **somente leitura**. Obrigatório no modo `zabbix` |
| `NOC_GROUP_BY` | `hostgroup` | `hostgroup` (grupos de hosts do Zabbix), `inventory` (campo *Location* do inventário) ou `config` (mapa no `config.py`). `NOC_LOCATIONS_FROM` (nome antigo) também é aceito |
| `NOC_HOSTGROUP_PREFIX` | — | Só grupos com este prefixo viram quadros; o prefixo sai do nome (ex.: `NOC/`) |
| `NOC_HOST_TAG` | — | Se definida, só hosts com esta tag entram no painel |
| `NOC_DISCOVERY_TTL` | `300` | Segundos entre releituras dos grupos de hosts |
| `NOC_STALE_AFTER_SECONDS` | `600` | Sem dados por mais que isso → host fica **Sem dados** |
| `NOC_SLO_TARGET` | `99.5` | Meta de disponibilidade (%) |
| `NOC_SLO_MIN_SEVERITY` | `4` | Severidade mínima que conta como indisponibilidade (4 = *High*) |
| `NOC_PORT` | `8080` | Porta local do painel no `docker compose` |

Em produção, esses valores ficam em um arquivo fora do projeto (ex.: `/etc/noc-horizon/env`, com permissão `640`), carregado pelo systemd.

### 3. Grupos de hosts (os quadros do painel)

Por padrão (`NOC_GROUP_BY=hostgroup`), **cada grupo de hosts do Zabbix com hosts monitorados vira um quadro** — nada para configurar no código:

1. No papel (*role*) do usuário da API, libere também o método **`host.get`**.
2. Dê ao grupo de usuários permissão **Read** nos grupos de hosts que devem aparecer.
3. Opcional, recomendado em ambientes grandes: crie grupos só para o NOC, com um prefixo (ex.: `NOC/Firewalls`, `NOC/Filial São José`, `NOC/Links WAN`) e defina `NOC_HOSTGROUP_PREFIX=NOC/`. Só esses grupos viram quadros, e o nome aparece sem o prefixo.
4. Opcional: `NOC_HOST_TAG=noc` para que só hosts com a tag `noc` entrem.

Um host em vários grupos aparece em todos os quadros, mas conta **uma vez** nos totais. A lista de grupos é relida a cada 5 minutos (`NOC_DISCOVERY_TTL`) e, se o Zabbix falhar, a última lista válida continua sendo usada.

A cor de cada quadro é decidida no navegador: **vermelho** se algum problema ativo tiver severidade ≥ `HIGH_SEVERITY` (padrão 4 = *High*, em `js/config.js`), **amarelo** se houver só problemas de severidade menor, **cinza** se algum host estiver sem dados, **verde** caso contrário.

Alternativas: `NOC_GROUP_BY=inventory` agrupa pelo campo *Location* do inventário de cada host (com *Latitude*/*Longitude* preenchidas); `NOC_GROUP_BY=config` usa o mapa estático `HOST_LOCATION_MAP`/`LOCATIONS` do `backend/config.py`.

### 4. Rodar localmente (desenvolvimento)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate            # Windows: venv\Scripts\activate
pip install -r requirements.txt
export ZABBIX_URL=... ZABBIX_API_TOKEN=...   # PowerShell: $env:ZABBIX_URL="..."
flask --app app run
```

Para ver o frontend, sirva a raiz do projeto com um servidor estático (ex.: Live Server do VS Code). Abrir o `index.html` direto do disco não funciona, pois o navegador bloqueia as chamadas à API.

### 5. Testes

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

Os testes cobrem a lógica de status e do resumo: cálculo de saúde por host, host em vários grupos, problemas de hosts fora dos grupos, estado "sem dados", reconhecidos e manutenção.

Para desenvolver, instale os hooks locais uma vez — eles rodam **gitleaks** (bloqueia commit com token/senha) e **ruff** a cada commit:

```bash
pip install pre-commit
pre-commit install
```

### 6. Produção

**Backend como serviço** (Gunicorn, usuário sem privilégios, só em localhost):

```ini
# /etc/systemd/system/noc-horizon.service
[Service]
User=noc
Group=noc
EnvironmentFile=/etc/noc-horizon/env
WorkingDirectory=/opt/noc-horizon/backend
ExecStart=/opt/noc-horizon/venv/bin/gunicorn --workers 2 --bind 127.0.0.1:5004 app:app
Restart=always
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
```

**Apache** servindo **apenas o frontend** (nunca aponte o `DocumentRoot` para a raiz do repositório — isso exporia `backend/` e `.git/`):

```apache
<VirtualHost *:80>
    ServerName noc.seu-dominio.com
    # só index.html, favicon.svg, css/, js/, data/
    DocumentRoot /var/www/noc-horizon

    <Directory /var/www/noc-horizon>
        Options -Indexes -FollowSymLinks
        AllowOverride None
        Require all granted
        Header always set Content-Security-Policy "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        Header always set X-Content-Type-Options "nosniff"
        Header always set X-Frame-Options "DENY"
        Header always set Referrer-Policy "no-referrer"
    </Directory>

    <LocationMatch "/\.(?!well-known)">
        Require all denied
    </LocationMatch>

    ProxyRequests Off
    ProxyPass        /api/ http://127.0.0.1:5004/api/ timeout=20
    ProxyPassReverse /api/ http://127.0.0.1:5004/api/
</VirtualHost>
```

O passo a passo completo de operação — deploy, rotação de token, verificação de saúde e solução de problemas — está no **[runbook de operação](docs/operacao.md)**. Os arquivos de produção ficam em [`deploy/`](deploy/).

Recomenda-se publicar o painel com **HTTPS** (Let's Encrypt ou certificado de origem da Cloudflare).

---

## 🚦 Como o status é calculado

| Quadro | Quando |
|---|---|
| 🟢 Tudo OK | Nenhum problema ativo e todos os hosts com dados recentes |
| 🟡 Severidade baixa | Há problemas ativos, todos com severidade abaixo de *High* (*Not classified* a *Average*) |
| 🔴 Severidade alta | Algum problema ativo com severidade *High* ou *Disaster* |
| ⚪ Sem dados | Nenhum problema ativo, mas algum host não envia dados novos há mais que `NOC_STALE_AFTER_SECONDS` |

- O limite entre amarelo e vermelho é o `HIGH_SEVERITY` do `js/config.js` (padrão 4 = *High*).
- Problemas **em manutenção** aparecem no detalhe, mas não colorem o grupo nem entram no total de alertas.
- Problemas de hosts que não estão em nenhum grupo exibido não entram no total (ficam em `unmapped_problems` na API).
- Por compatibilidade, a API (`/api/locations`) ainda chama os grupos de `locations`.

---

## 🔐 Login (OIDC)

O controle de acesso fica no **Apache**, com o módulo [`mod_auth_openidc`](https://github.com/OpenIDC/mod_auth_openidc) — o código do painel não muda. Quem não tem sessão vai para a tela de login do provedor; quem não está autorizado recebe `401`.

```
Navegador ──► Apache + mod_auth_openidc ──► painel e /api/
                   │ sem sessão
                   ▼
           Provedor OIDC (Google, Keycloak, Azure AD...)
```

1. Crie um *client* OIDC no provedor com o redirect `https://SEU-DOMINIO/oidc/callback`.
2. `apt install libapache2-mod-auth-openidc && a2enmod auth_openidc`
3. Copie [`deploy/apache-noc-oidc.conf`](deploy/apache-noc-oidc.conf) para `/etc/apache2/noc-oidc.conf` (permissão `600`), preencha *client id*, *secret*, domínio e a lista de e-mails autorizados.
4. Inclua no vhost **443**: `Include /etc/apache2/noc-oidc.conf`.
5. Faça a porta **80 só redirecionar** para HTTPS — senão ela vira um caminho sem login.

Depois do login, o painel mostra o nome de quem entrou no cabeçalho (com o link **Sair**) e uma mensagem de boas-vindas. Quem não está autorizado vê uma página própria com o botão **Entrar com outra conta** — ambas em `public/`, liberadas sem login.

Trocar de provedor (ex.: Google → Keycloak) é mudar três linhas: `OIDCProviderMetadataURL`, `OIDCClientID` e `OIDCClientSecret`. O passo a passo completo está no [runbook](docs/operacao.md#8-login-oidc).

---

## 📈 Confiabilidade: SLO, orçamento de erro, MTTR e MTTA

O painel lateral mostra a confiabilidade dos **últimos 7 dias** e o modal de cada local mostra 7 e 30 dias (endpoint `GET /api/sla`). O histórico vem do próprio Zabbix (`event.get`) — o NOC Horizon não mantém banco de dados.

| Métrica | Como é calculada |
|---|---|
| **Disponibilidade** | Um grupo fica indisponível enquanto qualquer host dele tiver um problema com severidade ≥ `NOC_SLO_MIN_SEVERITY` (padrão: *High*). Problemas em manutenção não contam. A disponibilidade geral é a média dos grupos. |
| **Meta (SLO)** | `NOC_SLO_TARGET` (padrão `99.5`%). |
| **Orçamento de erro** | Quanto da indisponibilidade permitida pela meta ainda não foi gasto. Ex.: 99,5% em 7 dias permite ~50 min fora do ar. |
| **MTTR** | Tempo médio entre o início e a resolução dos incidentes da janela. |
| **MTTA** | Tempo médio até o primeiro reconhecimento (*acknowledge*) no Zabbix. |

Para usar com um Zabbix real, libere `event.get` no papel (*role*) do usuário da API.

---

## 🔄 Integração Contínua

Cada push e pull request roda no GitHub Actions:

| Job | O que verifica |
|---|---|
| Backend | `ruff` (lint + formatação) e `pytest` |
| Frontend | Sintaxe dos arquivos JS e ausência de `innerHTML` (XSS) |
| Segurança | `pip-audit` (dependências com CVE) e `bandit` (análise estática) |
| Segredos | `gitleaks` (tokens e senhas commitados) |
| Docker | Sobe o `docker compose` em modo demo e testa painel, API, CSP e bloqueio de arquivos ocultos |

O **Dependabot** abre PRs semanais com atualizações de dependências Python e das actions.

---

## 🔒 Segurança

- Segredos (URL e token do Zabbix) ficam **apenas em variáveis de ambiente**; `.env` está no `.gitignore`.
- O token do Zabbix pertence a um usuário **somente leitura**, restrito aos métodos de API usados.
- O backend escuta só em `127.0.0.1`, roda com usuário sem privilégios e não devolve detalhes de erro ao navegador.
- Dados vindos do Zabbix são inseridos no DOM com `textContent` (sem `innerHTML`), evitando XSS.
- Frontend sem dependências externas, protegido por Content Security Policy.
- Segredos barrados antes do commit (pre-commit + gitleaks) e verificados de novo no CI.
- 📄 Incidentes viram aprendizado: veja o [postmortem do token exposto](docs/postmortems/2026-09-27-token-zabbix-exposto.md).
- Acesso protegido por **login OIDC** no Apache; sem sessão válida, a página redireciona para o login e a API responde `401`.

---

## 🗺️ Roadmap

- [x] Autenticação/controle de acesso ao painel (OIDC no Apache)
- [ ] Papéis (RBAC): `noc-viewer` (só ver) e `noc-operator` (reconhecer problemas pelo painel)
- [ ] Suporte a múltiplos provedores de monitoramento além do Zabbix
- [ ] Histórico de disponibilidade (uptime) por grupo

---

## 👩‍💻 Autora

Desenvolvido por **Sheila Alves**

- GitHub: [@Sheila724](https://github.com/Sheila724)
- LinkedIn: [sheila-alvesaraujo](https://www.linkedin.com/in/sheila-alvesaraujo)

---

## 📄 Licença

Este projeto está sob a licença MIT — sinta-se livre para usar, modificar e distribuir.
