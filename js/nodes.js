// Camada de nós compartilhada pelo globo (map.js) e pelo mapa 2D (map2d.js):
// agrupamento de locais próximos na tela, desenho dos nós e ligações.
const NodeLayer = (() => {
  // Locais muito próximos na tela (ex.: Florianópolis, São José e Palhoça vistos
  // de longe) viram um agrupamento: os nós se abrem em círculo ao redor do
  // ponto real, com "pernas" ligando cada um à posição verdadeira.
  const CLUSTER_PX = 28;
  const NODE_SPACING_PX = 38;

  function worstOf(a, b) {
    const order = (CONFIG && CONFIG.STATUS_ORDER) || ["ok", "warning", "attention", "critical"];
    const ai = order.indexOf(a || "ok");
    const bi = order.indexOf(b || "ok");
    return order[Math.max(ai, bi, 0)];
  }

  function ringRadius(n) {
    return Math.max(42, (n * NODE_SPACING_PX) / (2 * Math.PI));
  }

  // project: d => [x, y] na tela; clusterPx: distância que junta dois locais
  function layout(visible, project, clusterPx = CLUSTER_PX) {
    const groups = [];
    visible
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : 1)) // mesma posição a cada quadro
      .forEach(d => {
        const [x, y] = project(d);
        const grp = groups.find(gr => Math.hypot(gr.x - x, gr.y - y) < clusterPx);
        if (grp) {
          grp.items.push(d);
          grp.x += (x - grp.x) / grp.items.length;
          grp.y += (y - grp.y) / grp.items.length;
        } else {
          groups.push({ x, y, items: [d] });
        }
      });

    // Agrupamentos cujos círculos se encostariam viram um só.
    const reach = gr => (gr.items.length === 1 ? 14 : ringRadius(gr.items.length));
    for (let merged = true; merged; ) {
      merged = false;
      for (let i = 0; i < groups.length && !merged; i++) {
        for (let j = i + 1; j < groups.length && !merged; j++) {
          const a = groups[i];
          const b = groups[j];
          if (a.items.length + b.items.length < 3) continue; // dois isolados: CLUSTER_PX já decidiu
          if (Math.hypot(a.x - b.x, a.y - b.y) < reach(a) + reach(b) + 12) {
            const n = a.items.length + b.items.length;
            a.x = (a.x * a.items.length + b.x * b.items.length) / n;
            a.y = (a.y * a.items.length + b.y * b.items.length) / n;
            a.items = a.items.concat(b.items).sort((p, q) => (p.id < q.id ? -1 : 1));
            groups.splice(j, 1);
            merged = true;
          }
        }
      }
    }

    const placed = [];
    const hubs = [];
    groups.forEach(gr => {
      const n = gr.items.length;
      if (n === 1) {
        placed.push({ d: gr.items[0], x: gr.x, y: gr.y, angle: null });
        return;
      }
      const radius = ringRadius(n);
      gr.items.forEach((d, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
        placed.push({
          d,
          x: gr.x + radius * Math.cos(angle),
          y: gr.y + radius * Math.sin(angle),
          angle,
          hub: gr,
        });
      });
      hubs.push({
        key: gr.items.map(d => d.id).join("|"),
        x: gr.x,
        y: gr.y,
        count: n,
        status: gr.items.reduce((acc, d) => worstOf(acc, d.status), "ok"),
        lon: d3.mean(gr.items, d => d.lon),
        lat: d3.mean(gr.items, d => d.lat),
        items: gr.items,
      });
    });
    return { placed, hubs };
  }

  function drawSpider(group, placed, hubs, onHubClick) {
    const legs = placed.filter(p => p.hub);
    const legSel = group.selectAll("line").data(legs, p => p.d.id);
    legSel.exit().remove();
    legSel.enter()
      .append("line")
      .attr("class", "spider-leg")
      .merge(legSel)
      .attr("x1", p => p.hub.x)
      .attr("y1", p => p.hub.y)
      .attr("x2", p => p.x)
      .attr("y2", p => p.y)
      .style("stroke", p => CONFIG.STATUS_COLOR[p.d.status]);

    const hubSel = group.selectAll(".spider-hub").data(hubs, h => h.key);
    hubSel.exit().remove();
    const enter = hubSel.enter()
      .append("g")
      .attr("class", "spider-hub")
      .style("cursor", "zoom-in")
      .on("click", (event, h) => {
        event.stopPropagation();
        onHubClick(h);
      });
    enter.append("circle").attr("r", 9);
    enter.append("text").attr("text-anchor", "middle").attr("dy", "0.35em");
    enter.append("title");
    const merged = enter.merge(hubSel);
    merged.attr("transform", h => `translate(${h.x},${h.y})`);
    merged.select("circle").style("stroke", h => CONFIG.STATUS_COLOR[h.status]);
    merged.select("text").text(h => h.count);
    merged.select("title").text(h => `${h.count} locais próximos — clique para aproximar`);
  }

  // Desenha os nós já posicionados (saída de layout()).
  function draw({ spiderGroup, nodesGroup, placed, hubs, onNodeClick, onHubClick }) {
    drawSpider(spiderGroup, placed, hubs, onHubClick);

    const sel = nodesGroup.selectAll(".node-group").data(placed, p => p.d.id);
    sel.exit().remove();

    const enter = sel
      .enter()
      .append("g")
      .attr("class", "node-group")
      .style("cursor", "pointer")
      .on("click", (event, p) => {
        event.stopPropagation();
        if (onNodeClick) onNodeClick(p.d);
      });

    enter.append("circle").attr("class", "node-glow").attr("r", 14);
    enter.append("circle").attr("class", "node-pulse").attr("r", 8);
    enter.append("circle")
      .attr("class", "node-core")
      .attr("r", 6)
      .style("stroke", "#ffffffaa")
      .style("stroke-width", 1);
    enter.append("text").attr("class", "node-label");

    const merged = enter.merge(sel);
    merged.attr("transform", p => `translate(${p.x},${p.y})`);
    merged.select(".node-glow").style("fill", p => CONFIG.STATUS_COLOR[p.d.status]);
    merged.select(".node-pulse")
      .classed("animate", p => p.d.status !== "ok")
      .style("stroke", p => CONFIG.STATUS_COLOR[p.d.status]);
    merged.select(".node-core")
      .style("fill", p => CONFIG.STATUS_COLOR[p.d.status])
      .style("color", p => CONFIG.STATUS_COLOR[p.d.status]);

    // Nó isolado: rótulo em cima. Nó de agrupamento: rótulo para fora do círculo.
    merged.select(".node-label")
      .text(p => p.d.label)
      .attr("x", p => (p.angle == null ? 0 : Math.cos(p.angle) * 14))
      .attr("y", p => (p.angle == null ? -18 : Math.sin(p.angle) * 14))
      .attr("dy", p => (p.angle == null ? null : "0.35em"))
      .attr("text-anchor", p => {
        if (p.angle == null) return "middle";
        const c = Math.cos(p.angle);
        return Math.abs(c) < 0.3 ? "middle" : c > 0 ? "start" : "end";
      });
  }

  // Liga cada local aos seus vizinhos mais próximos. Com poucos locais vira
  // uma malha completa; com muitos, evita uma "teia" ilegível.
  const MAX_NEIGHBORS = 2;
  function pairs(locs) {
    const seen = new Set();
    const out = [];
    locs.forEach((a, i) => {
      locs
        .map((b, j) => ({ j, d: d3.geoDistance([a.lon, a.lat], [b.lon, b.lat]) }))
        .filter(x => x.j !== i)
        .sort((x, y) => x.d - y.d)
        .slice(0, MAX_NEIGHBORS)
        .forEach(({ j }) => {
          const [lo, hi] = i < j ? [i, j] : [j, i];
          const key = `${lo}-${hi}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push([locs[lo], locs[hi]]);
          }
        });
    });
    return out;
  }

  // Duas partículas por ligação, com a cor do pior status das pontas.
  function buildParticles(locs) {
    const particles = [];
    pairs(locs).forEach(([a, b]) => {
      const color = CONFIG.STATUS_COLOR[worstOf(a.status, b.status)];
      for (let k = 0; k < 2; k++) {
        particles.push({ from: [a.lon, a.lat], to: [b.lon, b.lat], t: k / 2, speed: 0.0025, color });
      }
    });
    return particles;
  }

  function advanceParticles(particles) {
    particles.forEach(p => {
      p.t += p.speed;
      if (p.t > 1) p.t -= 1;
    });
  }

  return { worstOf, layout, draw, pairs, buildParticles, advanceParticles };
})();
