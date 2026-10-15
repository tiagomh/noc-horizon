# Runbook de operação — NOC Horizon

Guia para **instalar, atualizar e diagnosticar** o NOC Horizon em produção.
Escrito para que qualquer pessoa da equipe consiga operar o painel sem depender de quem o construiu.

> Os exemplos usam `noc.seu-dominio.com` e `IP-DA-VPS`. Troque pelos valores reais do seu ambiente.

---

## 1. Como a produção está montada

```
Navegador ──HTTPS──► Cloudflare (Full strict) ──HTTPS──► Apache 443 + login OIDC
                                      ├── /         → /var/www/noc-horizon  (só o frontend)
                                      ├── /api/     → Gunicorn 127.0.0.1:5004 (backend)
                                      └── /zabbix   → interface do Zabbix
Backend ──JSON-RPC (localhost)──► API do Zabbix
```

| O quê | Onde |
|---|---|
| Código do backend | `/opt/noc-horizon/backend` (dono `root:noc`, sem acesso público) |
| Ambiente Python | `/opt/noc-horizon/venv` |
| Frontend publicado | `/var/www/noc-horizon` |
| Segredos e configuração | `/etc/noc-horizon/env` (permissão `640`, `root:noc`) |
| Serviço do backend | systemd — modelo em [`deploy/noc-horizon.service`](../deploy/noc-horizon.service) |
| Vhost do Apache | modelo em [`deploy/apache-noc-horizon.conf`](../deploy/apache-noc-horizon.conf) |
| Login OIDC | `/etc/apache2/noc-oidc.conf` (permissão `600`) — modelo em [`deploy/apache-noc-oidc.conf`](../deploy/apache-noc-oidc.conf) |
| Certificado de origem (Cloudflare) | `/etc/ssl/cloudflare/` |
| Script de atualização | `/usr/local/bin/noc-atualizar` — fonte em [`deploy/noc-atualizar.sh`](../deploy/noc-atualizar.sh) |
| Logs do backend | `journalctl -u noc-horizon` |
| Logs do Apache | `/var/log/apache2/noc-horizon-*.log` |

> Na instalação original o serviço se chama `infra-map-backend`. Nesse caso, use esse nome nos comandos abaixo (e `NOC_SERVICE=infra-map-backend` no script de atualização).

---

## 2. Atualizar o painel (deploy)

**No computador de quem desenvolve (PowerShell):**

```powershell
cd $HOME\Documents\noc-horizon
tar -czf $env:TEMP\noc.tgz --exclude=venv --exclude=__pycache__ --exclude=tests index.html favicon.svg css js data public backend
scp $env:TEMP\noc.tgz root@IP-DA-VPS:~/
ssh root@IP-DA-VPS "rm -rf ~/upload && mkdir ~/upload && tar -xzf ~/noc.tgz -C ~/upload && rm ~/noc.tgz"
```

**No servidor:**

```bash
sudo noc-atualizar          # deve terminar com "OK: backend respondendo"
```

Depois, recarregue o painel no navegador. Se ainda aparecer a versão antiga, veja o item **"Painel mostra a versão antiga"** na seção 5.

### Voltar uma versão (rollback)

O servidor não guarda versões anteriores. Para voltar, faça `git checkout <commit-anterior>` no computador de desenvolvimento, repita o envio acima e, ao terminar, volte para a branch principal (`git checkout master`).

---

## 3. Configuração e segredos

Toda a configuração fica em `/etc/noc-horizon/env` — nunca no código. Exemplo:

```
ZABBIX_URL=http://127.0.0.1/zabbix/api_jsonrpc.php
ZABBIX_API_TOKEN=<token do usuário somente leitura>
NOC_LOCATIONS_FROM=inventory
```

A lista completa de variáveis está no [README](../README.md#2-configurar-as-variáveis-de-ambiente). Depois de editar:

```bash
sudo systemctl restart noc-horizon
```

### Permissões que o usuário da API precisa no Zabbix

Papel (*role*) **somente leitura**, sem acesso à interface, com estes métodos de API:

| Método | Usado para |
|---|---|
| `problem.get`, `trigger.get` | Problemas ativos |
| `item.get` | Detectar hosts sem dados |
| `host.get` | Grupos de hosts (`NOC_GROUP_BY=hostgroup`, o padrão) e inventário (`inventory`) |
| `event.get` | Confiabilidade: SLO, MTTR, MTTA |

O grupo do usuário precisa de permissão **Read** nos grupos de hosts exibidos no painel.

### Trocar o token (rotação)

1. No Zabbix: **Users → API tokens → Create API token** para o usuário do painel (com data de expiração).
2. No servidor: atualize `ZABBIX_API_TOKEN` em `/etc/noc-horizon/env` e rode `sudo systemctl restart noc-horizon`.
3. Confira o painel (seção 4) e só então **apague o token antigo** no Zabbix.

---

## 4. Verificação rápida de saúde

```bash
# Backend no ar e falando com o Zabbix
curl -s http://127.0.0.1:5004/health
curl -s http://127.0.0.1:5004/api/locations | head -c 120; echo

# Pelo Apache, como um visitante (troque o domínio)
for p in / /api/locations /api/sla /backend/config.py /.git/config; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' -H 'Host: noc.seu-dominio.com' http://127.0.0.1$p)"
done
```

Esperado: `200` para `/`, `/api/locations` e `/api/sla`; `403` ou `404` para `/backend/config.py` e `/.git/config`.

Com o **login OIDC ativo**, os testes acima pela porta 80 respondem `301` (redireciona para HTTPS). Teste o login assim:

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" https://noc.seu-dominio.com/ | cut -c1-80   # 302 -> provedor de login
curl -s -o /dev/null -w "%{http_code}\n" https://noc.seu-dominio.com/api/locations                     # 401
curl -s http://127.0.0.1:5004/health                                                                    # backend por dentro: ok
```

> **Atenção:** teste sempre com o cabeçalho `Host` do domínio do painel. Um teste em `http://127.0.0.1/` sem ele cai no vhost padrão do Apache e pode dar um falso "tudo certo" — foi exatamente o que aconteceu no [incidente de 27/09](postmortems/2026-09-27-token-zabbix-exposto.md).

Status de cada local e host:

```bash
curl -s http://127.0.0.1:5004/api/locations | python3 -c "import sys,json; [print(l['label'], '->', l['status'], [(h['host'], h['status'], h['last_data_age_seconds']) for h in l['hosts']]) for l in json.load(sys.stdin)['locations']]"
```

---

## 5. Problemas conhecidos e como resolver

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Painel mostra a **versão antiga** depois do deploy | Cache da Cloudflare ou do navegador | Cloudflare → **Caching → Purge Everything** e `Ctrl+F5`. O `Cache-Control: no-cache` do vhost evita que isso se repita. |
| **"erro ao conectar: HTTP 502"** no painel | Backend fora do ar ou sem acesso ao Zabbix | `sudo journalctl -u noc-horizon -n 40`. Erros comuns: variável faltando em `/etc/noc-horizon/env`, token revogado, Zabbix fora do ar. |
| Backend não sobe: **`status=203/EXEC`** | Caminho do Gunicorn errado no serviço | Confira o `ExecStart` e se `/opt/noc-horizon/venv/bin/gunicorn` existe. |
| Host aparece **"Sem dados"** (cinza) | Host sem itens, agente parado ou sem permissão | Veja a seção 6. |
| Host ou grupo **não aparece no painel** | Grupo fora do `NOC_HOSTGROUP_PREFIX`, sem permissão *Read* para o usuário da API, host sem a `NOC_HOST_TAG` ou host desativado | Ajuste o grupo/permissão/tag no Zabbix. Aparece em até 5 min (`NOC_DISCOVERY_TTL`). |
| Painel mostra **erro ao conectar** logo após atualizar | Papel do usuário da API sem `host.get` | Libere `host.get` no papel (*User roles*) ou use `NOC_GROUP_BY=config`. |
| Confiabilidade mostra **"—"** / `/api/sla` com `ok: false` | Falta `event.get` no papel da API | Libere o método (seção 3) e aguarde até 5 min (cache). |
| **MTTA vazio** | Nenhum incidente foi reconhecido | Use **Acknowledge** em *Monitoring → Problems*. |
| Erro de **CSP** no console do navegador | Script de terceiro injetado (ex.: Cloudflare Web Analytics) | Desative o recurso na Cloudflare ou libere o domínio no `Content-Security-Policy`. |
| **Login em loop** (volta sempre para a tela de login) | Cloudflare em modo *Flexible* ou `OIDCRedirectURI` diferente do cadastrado no provedor | Cloudflare em **Full (strict)**; o redirect URI precisa ser idêntico nos dois lados. |
| **401 / Unauthorized** depois de entrar | E-mail fora da lista | Acrescente `Require claim email:...` em `/etc/apache2/noc-oidc.conf` (e em *Test users*, no Google) e `sudo systemctl reload apache2`. |
| **Não consigo entrar por SSH** | Meu IP foi bloqueado pelo fail2ban | Pelo console web do provedor ou por outro IP: `sudo fail2ban-client set sshd unbanip MEU.IP`. Coloque o IP em `ignoreip` no `/etc/fail2ban/jail.local`. |

---

## 6. Diagnosticar um host "Sem dados"

O host não enviou nenhum dado novo há mais de `NOC_STALE_AFTER_SECONDS` (padrão 10 min). Investigue nesta ordem:

**1. A API enxerga itens desse host?**

```bash
sudo bash -c 'source /etc/noc-horizon/env; curl -s -X POST -H "Content-Type: application/json-rpc" -H "Authorization: Bearer $ZABBIX_API_TOKEN" -d "{\"jsonrpc\":\"2.0\",\"method\":\"item.get\",\"params\":{\"output\":[\"name\",\"lastclock\",\"state\"],\"host\":\"NOME-DO-HOST\",\"limit\":3},\"id\":1}" "$ZABBIX_URL"'
```

- `"result":[]` → o host **não tem itens** (falta vincular um template), o **nome não bate** com o cadastrado no Zabbix (o painel usa o *Host name* técnico, que diferencia maiúsculas) ou o usuário da API **não tem permissão** no grupo do host.
- Itens com `"lastclock":"0"` ou `"state":"1"` → o host existe, mas **não está coletando**: veja o agente.

**2. Conferir no banco do Zabbix (sem filtro de permissão):**

```bash
sudo mysql zabbix -e "SELECT h.host, h.status,
  (SELECT COUNT(*) FROM items i WHERE i.hostid=h.hostid) AS itens,
  (SELECT GROUP_CONCAT(t.host) FROM hosts_templates ht JOIN hosts t ON t.hostid=ht.templateid WHERE ht.hostid=h.hostid) AS templates
FROM hosts h WHERE h.host='NOME-DO-HOST';"
```

`itens = 0` e sem template → vincule um template (ex.: *Linux by Zabbix agent active*).

**3. No próprio host monitorado (agente ativo):**

```bash
systemctl status zabbix-agent2 2>/dev/null || systemctl status zabbix-agent
grep -E '^(ServerActive|Hostname)=' /etc/zabbix/zabbix_agent*.conf
```

`Hostname` precisa ser **idêntico** ao nome do host no Zabbix, e `ServerActive` precisa apontar para o servidor Zabbix (porta 10051 liberada).

---

## 7. Rotinas

| Frequência | Tarefa |
|---|---|
| A cada deploy | Verificação rápida de saúde (seção 4) |
| Semanal | Olhar o **orçamento de erro** no painel: abaixo de 50%, investigar os incidentes da semana |
| Mensal | `sudo fail2ban-client status sshd` e `sudo apt update && sudo apt list --upgradable` |
| Antes do vencimento | Rotação do token da API (seção 3) |
| Após qualquer incidente relevante | Escrever um postmortem em [`docs/postmortems/`](postmortems/) |

---

## 8. Login OIDC

O login fica no Apache (`mod_auth_openidc`). O backend não sabe nada sobre usuários.

### Liberar ou remover uma pessoa

1. Edite `/etc/apache2/noc-oidc.conf` e acrescente (ou apague) a linha `Require claim email:pessoa@exemplo.com` — e-mail em minúsculas.
2. Com Google em modo *Testing*: adicione (ou remova) o e-mail em **Google Auth Platform → Audience → Test users**.
3. `sudo apache2ctl configtest && sudo systemctl reload apache2`

### Trocar o segredo do client

1. No provedor, gere um novo *client secret*.
2. Atualize `OIDCClientSecret` em `/etc/apache2/noc-oidc.conf` e rode `sudo systemctl reload apache2`.
3. Revogue o segredo antigo no provedor.

### Desligar o login em emergência (painel volta a ficar aberto)

```bash
sudo sed -i 's#^\s*Include /etc/apache2/noc-oidc.conf##' /etc/apache2/sites-available/infra-map-ssl.conf
sudo systemctl reload apache2
```

Para religar, recoloque `Include /etc/apache2/noc-oidc.conf` antes do `</VirtualHost>` do vhost 443.

### Nome no cabeçalho, "Sair" e página de acesso negado

O `noc-oidc.conf` precisa destas linhas (já estão no modelo [`deploy/apache-noc-oidc.conf`](../deploy/apache-noc-oidc.conf)):

```apache
OIDCClaimPrefix "OIDC-Claim-"
OIDCPassClaimsAs headers
OIDCAuthRequestParams prompt=select_account

# depois do <Location />:
<Location /public/>
    AuthType None
    Require all granted
</Location>
<Location /favicon.svg>
    AuthType None
    Require all granted
</Location>
ErrorDocument 401 /public/acesso-negado.html
ErrorDocument 403 /public/acesso-negado.html
```

- `/api/me` devolve o e-mail e o nome repassados pelo Apache; sem login configurado, responde `{"authenticated": false}` e o painel não mostra o nome.
- **Sair** encerra a sessão e leva para `/public/saiu.html`.
- `prompt=select_account` faz o Google mostrar o seletor de contas — é o que permite "Entrar com outra conta".

### Requisitos que não podem faltar

- **HTTPS de ponta a ponta:** certificado de origem no Apache e Cloudflare em **Full (strict)**. Em *Flexible*, o login entra em loop.
- **Porta 80 só redireciona** para HTTPS. Se ela servir o painel, vira um caminho sem login.
- O `OIDCCryptoPassphrase` é a chave das sessões: se trocar, todos precisam entrar de novo.
