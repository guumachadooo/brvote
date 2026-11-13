# Pipeline de Dados Eleitorais Brasileiros (`data/`)

Este documento descreve o formato dos arquivos JSON consumidos pelo aplicativo **Como o Brasil Vota** e como alimentar novos dados do **TSE (Tribunal Superior Eleitoral)** e do **IBGE**.

## 1. Geometrias (`data/br-ufs.json` e `data/br-municipios.json`)

- `data/br-ufs.json`: `FeatureCollection` GeoJSON com as 27 Unidades Federativas. Cada `feature.id` é o código IBGE de 2 dígitos da UF (`"35"` para SP, `"31"` para MG, etc.).
- `data/br-municipios.json`: `FeatureCollection` GeoJSON com os municípios. Cada `feature.id` tem 7 dígitos começando pelos 2 dígitos da UF (ex.: `"3550308"` = São Paulo).

## 2. Resultados por UF (`data/<uf>/results-2026.json`)

Formato esperado por `app.js`, `voters.js` e `shade-by-votes.js`:

```json
{
  "generated": "2026-10-05",
  "state": "SP",
  "races": [
    {
      "id": "presidente",
      "office": "presidente",
      "type": "general",
      "year": 2026,
      "label": "Presidente da República — 2º Turno / Geral",
      "totalVotes": 25800000,
      "candidates": [
        { "name": "Luiz Inácio Lula da Silva (PT)", "party": "dem", "partyLabel": "PT", "votes": 11600000 },
        { "name": "Tarcísio / Candidato PL (PL)", "party": "rep", "partyLabel": "PL", "votes": 14200000 }
      ]
    }
  ],
  "counties": {
    "3550308": {
      "name": "São Paulo",
      "races": {
        "presidente": {
          "total": 6980000,
          "v": [0, 3734300, 1, 3245700],
          "byParty": { "dem": 3734300, "rep": 3245700 }
        }
      }
    }
  }
}
```

## 3. Setores Censitários (`data/<uf>/blockgroups.json`)

Lista compacta de pontos demográficos `[cod_mun_sufixo_5dig, lon, lat, pop_eleitores]` usada por `dots-worker.js` e `voters.js` para distribuir os eleitores dentro de cada município.

## 4. Zonas Eleitorais (`data/<uf>/precincts.json` e `precinct-shapes.json`)

- `precincts.json`: Dicionário de zonas eleitorais com `{ n: "Nome da Zona", c: "codigo_ibge_7dig", r: { "presidente": [candIdx, votos, ...] } }`.
- `precinct-shapes.json`: Polígonos GeoJSON compactos para cada zona eleitoral.
