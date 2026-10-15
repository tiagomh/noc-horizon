// Orquestra: busca dados da API e alimenta o painel de grupos, o card de
// operação, o header e o ticker.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- Painel de grupos de hosts ----------
// Cada grupo é um quadro: verde (tudo OK), amarelo (só severidade baixa),
// vermelho (alguma severidade alta) ou cinza (host sem dados). Clicar abre os
// hosts com problema e seus triggers. Dados do Zabbix sempre via textContent.

const expanded = new Set(); // grupos abertos (sobrevivem às atualizações)
const lastTileStatus = new Map(); // para destacar o quadro que piorou
let lastGroups = [];

function isHigh(p) {
  return p.severity >= CONFIG.HIGH_SEVERITY;
}
function activeProblems(group) {
  return (group.problems || []).filter(p => !p.suppressed);
}
function tileStatus(group) {
  const active = activeProblems(group);
  if (active.some(isHigh)) return "high";
  if (active.length) return "low";
  if ((group.hosts || []).some(h => h.stale)) return "nodata";
  return "ok";
}
function rank(status) {
  return CONFIG.TILE_ORDER.indexOf(status);
}
function formatSince(ts) {
  return ts ? `há ${formatDuration(Math.max(0, Date.now() / 1000 - ts))}` : "";
}

function matchesFilter(group, query) {
  if (!query) return true;
  const q = query.toLocaleLowerCase("pt-BR");
  return group.label.toLocaleLowerCase("pt-BR").includes(q) ||
    (group.hosts || []).some(h => h.host.toLocaleLowerCase("pt-BR").includes(q));
}

function toggleGroup(id) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  renderBoard(lastGroups);
}

function createTile(id) {
  const tile = el("div", "tile");
  tile.dataset.id = id;
  tile.tabIndex = 0;
  tile.setAttribute("role", "button");
  tile.addEventListener("click", event => {
    if (event.target.closest(".tile-detail")) return; // clicar na lista não fecha
    toggleGroup(id);
  });
  tile.addEventListener("keydown", event => {
    if (event.target !== tile) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleGroup(id);
    }
  });
  return tile;
}

function badge(kind, text) {
  return el("span", `badge ${kind}`, text);
}

function fillTile(tile, group, status) {
  const isOpen = expanded.has(group.id);
  const prev = lastTileStatus.get(group.id);
  if (prev && rank(status) > rank(prev)) {
    tile.classList.add("worsened");
    setTimeout(() => tile.classList.remove("worsened"), 3500);
  }
  lastTileStatus.set(group.id, status);

  CONFIG.TILE_ORDER.forEach(s => tile.classList.toggle(`is-${s}`, s === status));
  tile.classList.toggle("expanded", isOpen);
  tile.setAttribute("aria-expanded", String(isOpen));
  tile.style.setProperty("--tile-color", CONFIG.TILE_COLOR[status]);

  const hosts = group.hosts || [];
  const active = activeProblems(group);
  const high = active.filter(isHigh).length;
  const low = active.length - high;
  const maint = (group.problems || []).length - active.length;
  const stale = hosts.filter(h => h.stale).length;
  const acked = active.filter(p => p.acknowledged).length;
  const unhealthy = hosts.filter(h => h.status !== "ok").length;

  const head = el("div", "tile-head");
  const name = el("span", "tile-name", group.label);
  name.title = group.label;
  head.append(el("span", "tile-dot"), name, el("span", "tile-chevron", isOpen ? "▾" : "▸"));

  const main = el("div", "tile-main");
  if (unhealthy) {
    main.append(
      el("span", "tile-big", `${unhealthy}`),
      el("span", "tile-big-label", `de ${hosts.length} ${hosts.length === 1 ? "host" : "hosts"} com problema`)
    );
  } else {
    main.append(
      el("span", "tile-big", `${hosts.length}`),
      el("span", "tile-big-label", `${hosts.length === 1 ? "host" : "hosts"} · ${CONFIG.TILE_LABEL[status]}`)
    );
  }

  const badges = el("div", "tile-badges");
  if (high) badges.append(badge("high", `${high} alta`));
  if (low) badges.append(badge("low", `${low} baixa`));
  if (stale) badges.append(badge("nodata", `${stale} sem dados`));
  if (acked) badges.append(badge("ack", `✓ ${acked} reconhecido${acked > 1 ? "s" : ""}`));
  if (maint) badges.append(badge("maint", `${maint} em manutenção`));

  const foot = el("div", "tile-foot");
  const sla = lastSla && lastSla.windows["7d"].locations[group.id];
  foot.append(el("span", null, sla != null ? `Disponib. 7 dias ${formatPct(sla)}` : ""));
  foot.append(el("span", "tile-hint", isOpen ? "clique para fechar" : active.length || stale ? "clique para ver" : ""));

  const parts = [head, main, badges, foot];
  if (isOpen) parts.push(buildDetail(group));
  tile.replaceChildren(...parts);
}

// Status de um host dentro do quadro aberto
function hostStatus(host, probs) {
  const active = probs.filter(p => !p.suppressed);
  if (active.some(isHigh)) return ["high", CONFIG.TILE_LABEL.high];
  if (active.length) return ["low", CONFIG.TILE_LABEL.low];
  if (host.stale) return ["nodata", CONFIG.TILE_LABEL.nodata];
  return ["maint", "Em manutenção"];
}

function buildDetail(group) {
  const detail = el("div", "tile-detail");
  const byHost = new Map();
  (group.problems || []).forEach(p => {
    if (!byHost.has(p.host)) byHost.set(p.host, []);
    byHost.get(p.host).push(p);
  });

  const hosts = group.hosts || [];
  const withIssue = hosts
    .filter(h => h.stale || byHost.has(h.host))
    .map(h => {
      const probs = (byHost.get(h.host) || [])
        .slice()
        .sort((a, b) => a.suppressed - b.suppressed || b.severity - a.severity);
      return { h, probs, status: hostStatus(h, probs) };
    })
    .sort((a, b) => rank(b.status[0]) - rank(a.status[0]) || a.h.host.localeCompare(b.h.host));
  const healthy = hosts.filter(h => !h.stale && !byHost.has(h.host));

  if (!withIssue.length) {
    detail.append(el("div", "detail-empty", "Nenhum problema ativo neste grupo."));
  }

  withIssue.forEach(({ h, probs, status: [key, label] }) => {
    const card = el("div", "host-card");
    card.style.setProperty("--tile-color", CONFIG.TILE_COLOR[key] || "var(--muted)");
    const head = el("div", "host-head");
    head.append(el("span", "host-name", h.host), el("span", "host-status", label));
    card.append(head);

    if (h.stale) {
      card.append(el("div", "trigger nodata", h.last_data_age_seconds == null
        ? "Nenhum dado recebido do Zabbix"
        : `Sem dados novos há ${formatDuration(h.last_data_age_seconds)}`));
    }
    probs.forEach(p => {
      const row = el("div", p.suppressed ? "trigger suppressed" : "trigger");
      const sevLabel = CONFIG.SEVERITY_LABEL[p.severity] ?? `Severidade ${p.severity}`;
      const meta = el("div", "trigger-meta");
      if (p.since) meta.append(el("span", null, formatSince(p.since)));
      if (p.acknowledged) meta.append(el("span", "tag ack", "Reconhecido"));
      if (p.suppressed) meta.append(el("span", "tag maint", "Em manutenção"));
      row.append(
        el("span", `sev ${isHigh(p) ? "high" : "low"}`, sevLabel),
        el("span", "trigger-name", p.trigger ?? ""),
        meta
      );
      card.append(row);
    });
    detail.append(card);
  });

  if (healthy.length) {
    const ok = el("div", "healthy");
    ok.append(el("span", "healthy-label", `${healthy.length} sem problema:`));
    healthy.forEach(h => ok.append(el("span", "host-chip", h.host)));
    detail.append(ok);
  }
  return detail;
}

function updateBoardCounts(decorated) {
  const counts = { high: 0, low: 0, nodata: 0, ok: 0 };
  decorated.forEach(d => { counts[d.status] += 1; });
  const box = document.getElementById("board-counts");
  box.replaceChildren(
    ...["high", "low", "nodata", "ok"]
      .filter(s => counts[s] > 0)
      .map(s => {
        const chip = el("span", `count-chip ${s}`);
        chip.append(el("span", "count-dot"), el("span", null, `${counts[s]} ${CONFIG.TILE_LABEL[s].toLowerCase()}`));
        return chip;
      })
  );
}

function renderBoard(groups) {
  lastGroups = groups;
  const grid = document.getElementById("board-grid");
  const query = document.getElementById("board-search").value.trim();
  const onlyProblems = document.getElementById("board-only-problems").checked;

  // Pior primeiro; empate: mais problemas ativos; depois nome
  const decorated = groups
    .map(g => ({ g, status: tileStatus(g), active: activeProblems(g).length }))
    .sort((a, b) =>
      rank(b.status) - rank(a.status) ||
      b.active - a.active ||
      a.g.label.localeCompare(b.g.label, "pt-BR"));
  updateBoardCounts(decorated);

  const visible = decorated.filter(d =>
    (!onlyProblems || d.status !== "ok") && matchesFilter(d.g, query));

  // Reaproveita os quadros existentes (mantém foco e não pisca a tela)
  const existing = new Map([...grid.children].map(node => [node.dataset.id, node]));
  visible.forEach(({ g, status }) => {
    const tile = existing.get(g.id) || createTile(g.id);
    fillTile(tile, g, status);
    grid.appendChild(tile);
    existing.delete(g.id);
  });
  existing.forEach(node => node.remove());

  const empty = document.getElementById("board-empty");
  empty.hidden = visible.length > 0;
  if (!visible.length) {
    empty.textContent = !groups.length
      ? "Nenhum grupo de hosts encontrado. Confira NOC_GROUP_BY e as permissões do usuário da API no Zabbix."
      : onlyProblems && !query
        ? "Nenhum grupo com problema — tudo OK ✓"
        : "Nenhum grupo corresponde ao filtro.";
  }
}

function setupBoard() {
  // O painel começa logo abaixo do cabeçalho, que muda de altura (selo de
  // demo, usuário logado, tela estreita).
  const header = document.getElementById("header");
  const syncHeader = () =>
    document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`);
  syncHeader();
  if (window.ResizeObserver) new ResizeObserver(syncHeader).observe(header);

  document.getElementById("board-search").addEventListener("input", () => renderBoard(lastGroups));
  const only = document.getElementById("board-only-problems");
  try {
    only.checked = localStorage.getItem("noc-only-problems") === "1";
  } catch (e) {
    /* sem localStorage: começa desmarcado */
  }
  only.addEventListener("change", () => {
    try {
      localStorage.setItem("noc-only-problems", only.checked ? "1" : "0");
    } catch (e) {
      /* ignora */
    }
    renderBoard(lastGroups);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && expanded.size) {
      expanded.clear();
      renderBoard(lastGroups);
    }
  });
}

function updateStatsCard(summary) {
  if (!summary) return;
  const locEl = document.getElementById("stat-locations-num");
  const hostsEl = document.getElementById("stat-hosts-num");
  const probEl = document.getElementById("stat-problems-num");
  const pillProblems = document.getElementById("pill-problems");
  if (locEl) locEl.textContent = summary.locations_count;
  if (hostsEl) hostsEl.textContent = summary.hosts_count;
  if (probEl) probEl.textContent = summary.active_problems;
  if (pillProblems) {
    pillProblems.classList.toggle("alert", summary.active_problems > 0);
  }
}
function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)} dias`;
}
function formatAge(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  return `${formatDuration(seconds)} atrás`;
}
function updateSidePanel(summary) {
  if (!summary) return;
  const healthEl = document.getElementById("panel-health");
  const triggersEl = document.getElementById("panel-triggers");
  const hostsProblemEl = document.getElementById("panel-hosts-problem");
  const lastCheckEl = document.getElementById("panel-last-check");
  const latencyEl = document.getElementById("panel-latency");

  const unhealthy = summary.hosts_unhealthy || 0;
  const active = summary.active_problems || 0;

  if (healthEl) {
    // % de HOSTS saudáveis (sem problema ativo e com dados recentes)
    healthEl.textContent = summary.health_pct != null ? `${summary.health_pct.toFixed(1)}%` : "—";
    healthEl.className = "panel-value " + (unhealthy > 0 ? "warn" : "ok");
  }
  if (triggersEl) {
    const ack = summary.acknowledged_problems || 0;
    triggersEl.textContent = ack > 0 ? `${active} (${ack} ✓)` : `${active}`;
    triggersEl.title = ack > 0 ? `${ack} reconhecido(s) no Zabbix` : "";
    triggersEl.className = "panel-value " + (active > 0 ? "warn" : "ok");
  }
  if (hostsProblemEl) {
    hostsProblemEl.textContent = `${unhealthy} / ${summary.hosts_count}`;
    hostsProblemEl.className = "panel-value " + (unhealthy > 0 ? "warn" : "ok");
  }
  const staleEl = document.getElementById("panel-hosts-stale");
  if (staleEl) {
    const stale = summary.hosts_stale || 0;
    staleEl.textContent = `${stale}`;
    staleEl.className = "panel-value " + (stale > 0 ? "warn" : "ok");
  }
  if (lastCheckEl) {
    const age = summary.oldest_data_age_seconds;
    lastCheckEl.textContent = formatAge(age);
    lastCheckEl.className = "panel-value " +
      (age != null && age > summary.stale_after_seconds ? "warn" : "");
  }
  if (latencyEl) {
    latencyEl.textContent = summary.latency_ms != null ? `${summary.latency_ms} ms` : "—";
  }
}
// Só o que precisa de atenção; um problema de host em vários grupos aparece uma vez.
function updateTicker(groups) {
  const track = document.getElementById("ticker-track");
  if (!track) return;
  const now = new Date().toLocaleTimeString("pt-BR");
  const seen = new Set();
  const entries = [];
  (groups || []).forEach(g => {
    (g.hosts || []).filter(h => h.stale).forEach(h => {
      if (seen.has(`s|${h.host}`)) return;
      seen.add(`s|${h.host}`);
      entries.push(["stale", `${g.label} · ${h.host} · sem dados`]);
    });
    activeProblems(g).forEach(p => {
      const key = `p|${p.host}|${p.trigger}`;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push([isHigh(p) ? "high" : "problem",
        `${g.label} · ${p.host ?? "—"} · ${p.trigger}` + (p.acknowledged ? " ✓" : "")]);
    });
  });
  if (!entries.length) entries.push(["", "Todos os grupos operacionais"]);
  const spans = entries.map(([cls, text]) => el("span", cls || null, `[${now}] ${text}`));
  // duplicado para o efeito de rolagem contínua
  track.replaceChildren(...spans, ...spans.map(s => s.cloneNode(true)));
}
// Com login OIDC no servidor, a API responde 401 quando a sessão expira:
// recarregar a página leva a pessoa de volta à tela de login.
function sessionExpired(res) {
  if (res.status !== 401) return false;
  window.location.reload();
  return true;
}
// Quem está logado (login OIDC no Apache). Sem login configurado, não mostra nada.
async function fetchMe() {
  try {
    const res = await fetch(CONFIG.ME_URL, { cache: "no-store" });
    if (sessionExpired(res) || !res.ok) return;
    const me = await res.json();
    if (!me.authenticated) return;

    document.getElementById("user-name").textContent = me.name;
    document.getElementById("user-name").title = me.email;
    const target = window.location.origin + CONFIG.LOGOUT_TO;
    document.getElementById("logout-link").href =
      "/oidc/callback?logout=" + encodeURIComponent(target);
    document.getElementById("user-chip").hidden = false;
    showWelcome(me.name.split(" ")[0]);
  } catch (e) {
    console.warn("Usuário indisponível:", e.message);
  }
}
function showWelcome(firstName) {
  // Uma vez por sessão do navegador (a aba de uma TV não fica repetindo)
  try {
    if (sessionStorage.getItem("noc-welcomed")) return;
    sessionStorage.setItem("noc-welcomed", "1");
  } catch (e) {
    /* sem sessionStorage: mostra mesmo assim */
  }
  const toast = document.getElementById("welcome-toast");
  toast.textContent = `Olá, ${firstName} — boas-vindas ao NOC Horizon 👋`;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => { toast.hidden = true; }, 600);
  }, 4000);
}
let lastSla = null;
function formatPct(value) {
  return value == null ? "—" : `${value.toFixed(2)}%`;
}
function setValue(id, text, level) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = text;
  node.className = "panel-value" + (level ? ` ${level}` : "");
}
function updateSlaPanel(sla) {
  const w = sla.windows["7d"];
  const label = document.getElementById("label-availability");
  if (label) {
    label.textContent = `Disponib. (meta ${sla.target}%)`;
    label.title = `Disponibilidade média dos grupos; meta (SLO) de ${sla.target}%`;
  }

  setValue("panel-availability", formatPct(w.availability),
    w.availability == null ? "" : w.availability >= sla.target ? "ok" : "crit");

  const budget = w.error_budget_remaining_pct;
  const budgetLevel = budget == null ? "" : budget > 50 ? "ok" : budget > 0 ? "warn" : "crit";
  setValue("panel-budget", budget == null ? "—" : `${budget.toFixed(0)}% restante`, budgetLevel);
  const fill = document.getElementById("budget-fill");
  if (fill) {
    fill.style.width = `${budget || 0}%`;
    fill.style.background = budgetLevel === "ok" ? "var(--ok)"
      : budgetLevel === "warn" ? "var(--attention)" : "var(--critical)";
  }

  setValue("panel-mttr", w.mttr_seconds == null ? "—" : formatDuration(w.mttr_seconds));
  setValue("panel-mtta", w.mtta_seconds == null ? "—" : formatDuration(w.mtta_seconds));
  setValue("panel-incidents",
    w.open_incidents > 0 ? `${w.incidents} (${w.open_incidents} abertos)` : `${w.incidents}`);
}
async function fetchSla() {
  try {
    const res = await fetch(CONFIG.SLA_URL, { cache: "no-store" });
    if (sessionExpired(res)) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.erro || "erro desconhecido");
    lastSla = data;
    updateSlaPanel(data);
    renderBoard(lastGroups); // disponibilidade por grupo nos quadros
  } catch (e) {
    console.warn("Confiabilidade indisponível:", e.message);
  }
}
async function fetchStatus() {
  try {
    const res = await fetch(CONFIG.API_URL, { cache: "no-store" });
    if (sessionExpired(res)) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.erro || "erro desconhecido");
    const modeBadge = document.getElementById("mode-badge");
    if (modeBadge) modeBadge.hidden = data.mode !== "demo";
    renderBoard(data.locations);
    updateStatsCard(data.summary);
    updateSidePanel(data.summary);
    updateTicker(data.locations);
    document.getElementById("last-update").textContent =
      "atualizado às " + new Date().toLocaleTimeString("pt-BR");
  } catch (e) {
    document.getElementById("last-update").textContent = "erro ao conectar: " + e.message;
  }
}

function updateLiveClock() {
  const el = document.getElementById("live-clock");
  if (!el) return;

  const now = new Date();
  el.textContent = now.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

updateLiveClock();
setInterval(updateLiveClock, 1000);

setupBoard();
fetchMe();
fetchStatus();
fetchSla();
setInterval(fetchStatus, CONFIG.POLL_INTERVAL_MS);
setInterval(fetchSla, CONFIG.SLA_POLL_INTERVAL_MS);
