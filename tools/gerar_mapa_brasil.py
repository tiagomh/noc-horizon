"""
Gera os mapas vetoriais do painel 2D a partir das malhas do IBGE.

    python tools/gerar_mapa_brasil.py

Saída (servida pelo próprio NOC Horizon, sem tiles externos — a CSP continua
"default-src 'self'"):
    data/brasil-uf.json       estados do Brasil (qualidade mínima)
    data/sc-municipios.json   municípios de SC (qualidade máxima, simplificada)

Para detalhar outro estado, troque UF_DETALHE pelo código IBGE dele
(ex.: 35 = SP, 41 = PR) e ajuste MAP2D no js/config.js.
"""

import gzip
import json
import urllib.request
from pathlib import Path

IBGE = "https://servicodados.ibge.gov.br/api"
UF_DETALHE = 42  # Santa Catarina
TOLERANCIA = 0.0003  # graus (~30 m): some sem perder o contorno da ilha
OUT = Path(__file__).resolve().parent.parent / "data"


def baixar(path):
    with urllib.request.urlopen(f"{IBGE}{path}", timeout=60) as resp:
        body = resp.read()
    if body[:2] == b"\x1f\x8b":  # a API do IBGE às vezes responde gzip sem pedir
        body = gzip.decompress(body)
    return json.loads(body.decode("utf-8"))


def _dist_segmento(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return ((x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2) ** 0.5


def simplificar(ring, tol):
    """Douglas-Peucker iterativo; mantém o anel fechado."""
    if tol <= 0 or len(ring) < 5:
        return ring
    keep = [False] * len(ring)
    keep[0] = keep[-1] = True
    stack = [(0, len(ring) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0.0, None
        for k in range(i + 1, j):
            d = _dist_segmento(ring[k], ring[i], ring[j])
            if d > best:
                best, idx = d, k
        if idx is not None and best > tol:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    out = [p for p, k in zip(ring, keep) if k]
    return out if len(out) >= 4 else ring


def _area(ring):
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:]))


def orientar(ring, externo):
    """O D3 espera anel externo no sentido horário (o contrário da RFC 7946)."""
    horario = _area(ring) < 0
    return ring if horario == externo else ring[::-1]


def tratar_poligono(rings, tol):
    out = []
    for i, ring in enumerate(rings):
        ring = [[round(x, 4), round(y, 4)] for x, y in simplificar(ring, tol)]
        out.append(orientar(ring, externo=(i == 0)))
    return out


def tratar(geojson, nomes, tol):
    feats = []
    for f in geojson["features"]:
        g = f["geometry"]
        if g["type"] == "Polygon":
            coords = tratar_poligono(g["coordinates"], tol)
        else:
            coords = [tratar_poligono(p, tol) for p in g["coordinates"]]
        code = f["properties"]["codarea"]
        feats.append(
            {
                "type": "Feature",
                "id": code,
                "properties": {"nome": nomes.get(code, code)},
                "geometry": {"type": g["type"], "coordinates": coords},
            }
        )
    return {"type": "FeatureCollection", "features": feats}


def salvar(nome, data):
    path = OUT / nome
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(f"{path} ({path.stat().st_size // 1024} KB, {len(data['features'])} áreas)")


def main():
    geo = "formato=application/vnd.geo%2Bjson"
    ufs = {str(e["id"]): e["sigla"] for e in baixar("/v1/localidades/estados")}
    salvar(
        "brasil-uf.json",
        tratar(baixar(f"/v3/malhas/paises/BR?intrarregiao=UF&qualidade=minima&{geo}"), ufs, 0),
    )

    muns = {str(m["id"]): m["nome"] for m in baixar(f"/v1/localidades/estados/{UF_DETALHE}/municipios")}
    malha = baixar(f"/v3/malhas/estados/{UF_DETALHE}?intrarregiao=municipio&qualidade=maxima&{geo}")
    salvar("sc-municipios.json", tratar(malha, muns, TOLERANCIA))


if __name__ == "__main__":
    main()
