// Esquema oficial do usavote original adaptado para todas as 27 UFs do Brasil
const UF_DEFS = [
  { code: 'SP', slug: 'sp', fips: '35', name: 'São Paulo', region: 'Sudeste', counties: 645, precincts: '402 zonas eleitorais', capital: 'São Paulo', secondCity: 'Campinas', smallMun: 'Borá' },
  { code: 'MG', slug: 'mg', fips: '31', name: 'Minas Gerais', region: 'Sudeste', counties: 853, precincts: '304 zonas eleitorais', capital: 'Belo Horizonte', secondCity: 'Uberlândia', smallMun: 'Serra da Saudade' },
  { code: 'RJ', slug: 'rj', fips: '33', name: 'Rio de Janeiro', region: 'Sudeste', counties: 92, precincts: '165 zonas eleitorais', capital: 'Rio de Janeiro', secondCity: 'São Gonçalo', smallMun: 'Macuco' },
  { code: 'BA', slug: 'ba', fips: '29', name: 'Bahia', region: 'Nordeste', counties: 417, precincts: '199 zonas eleitorais', capital: 'Salvador', secondCity: 'Feira de Santana', smallMun: 'Catolândia' },
  { code: 'PR', slug: 'pr', fips: '41', name: 'Paraná', region: 'Sul', counties: 399, precincts: '146 zonas eleitorais', capital: 'Curitiba', secondCity: 'Londrina', smallMun: 'Jardim Olinda' },
  { code: 'RS', slug: 'rs', fips: '43', name: 'Rio Grande do Sul', region: 'Sul', counties: 497, precincts: '164 zonas eleitorais', capital: 'Porto Alegre', secondCity: 'Caxias do Sul', smallMun: 'Engenho Velho' },
  { code: 'PE', slug: 'pe', fips: '26', name: 'Pernambuco', region: 'Nordeste', counties: 185, precincts: '122 zonas eleitorais', capital: 'Recife', secondCity: 'Jaboatão dos Guararapes', smallMun: 'Itacuruba' },
  { code: 'CE', slug: 'ce', fips: '23', name: 'Ceará', region: 'Nordeste', counties: 184, precincts: '112 zonas eleitorais', capital: 'Fortaleza', secondCity: 'Caucaia', smallMun: 'Guaramiranga' },
  { code: 'PA', slug: 'pa', fips: '15', name: 'Pará', region: 'Norte', counties: 144, precincts: '100 zonas eleitorais', capital: 'Belém', secondCity: 'Ananindeua', smallMun: 'Bannach' },
  { code: 'SC', slug: 'sc', fips: '42', name: 'Santa Catarina', region: 'Sul', counties: 295, precincts: '99 zonas eleitorais', capital: 'Florianópolis', secondCity: 'Joinville', smallMun: 'Santiago do Sul' },
  { code: 'GO', slug: 'go', fips: '52', name: 'Goiás', region: 'Centro-Oeste', counties: 246, precincts: '127 zonas eleitorais', capital: 'Goiânia', secondCity: 'Aparecida de Goiânia', smallMun: 'Anhanguera' },
  { code: 'MA', slug: 'ma', fips: '21', name: 'Maranhão', region: 'Nordeste', counties: 217, precincts: '97 zonas eleitorais', capital: 'São Luís', secondCity: 'Imperatriz', smallMun: 'Junco do Maranhão' },
  { code: 'PB', slug: 'pb', fips: '25', name: 'Paraíba', region: 'Nordeste', counties: 223, precincts: '70 zonas eleitorais', capital: 'João Pessoa', secondCity: 'Campina Grande', smallMun: 'Parari' },
  { code: 'ES', slug: 'es', fips: '32', name: 'Espírito Santo', region: 'Sudeste', counties: 78, precincts: '52 zonas eleitorais', capital: 'Vitória', secondCity: 'Vila Velha', smallMun: 'Divino de São Lourenço' },
  { code: 'AM', slug: 'am', fips: '13', name: 'Amazonas', region: 'Norte', counties: 62, precincts: '68 zonas eleitorais', capital: 'Manaus', secondCity: 'Parintins', smallMun: 'Japurá' },
  { code: 'MT', slug: 'mt', fips: '51', name: 'Mato Grosso', region: 'Centro-Oeste', counties: 141, precincts: '57 zonas eleitorais', capital: 'Cuiabá', secondCity: 'Várzea Grande', smallMun: 'Araguainha' },
  { code: 'RN', slug: 'rn', fips: '24', name: 'Rio Grande do Norte', region: 'Nordeste', counties: 167, precincts: '67 zonas eleitorais', capital: 'Natal', secondCity: 'Mossoró', smallMun: 'Viçosa' },
  { code: 'PI', slug: 'pi', fips: '22', name: 'Piauí', region: 'Nordeste', counties: 224, precincts: '74 zonas eleitorais', capital: 'Teresina', secondCity: 'Parnaíba', smallMun: 'Miguel Leão' },
  { code: 'AL', slug: 'al', fips: '27', name: 'Alagoas', region: 'Nordeste', counties: 102, precincts: '54 zonas eleitorais', capital: 'Maceió', secondCity: 'Arapiraca', smallMun: 'Pindoba' },
  { code: 'DF', slug: 'df', fips: '53', name: 'Distrito Federal', region: 'Centro-Oeste', counties: 19, precincts: '19 zonas eleitorais', capital: 'Plano Piloto (Asa Sul)', secondCity: 'Águas Claras / Vicente Pires', smallMun: 'Taguatinga Centro' },
  { code: 'MS', slug: 'ms', fips: '50', name: 'Mato Grosso do Sul', region: 'Centro-Oeste', counties: 79, precincts: '44 zonas eleitorais', capital: 'Campo Grande', secondCity: 'Dourados', smallMun: 'Figueirão' },
  { code: 'SE', slug: 'se', fips: '28', name: 'Sergipe', region: 'Nordeste', counties: 75, precincts: '29 zonas eleitorais', capital: 'Aracaju', secondCity: 'Nossa Senhora do Socorro', smallMun: 'Amparo do São Francisco' },
  { code: 'RO', slug: 'ro', fips: '11', name: 'Rondônia', region: 'Norte', counties: 52, precincts: '29 zonas eleitorais', capital: 'Porto Velho', secondCity: 'Ji-Paraná', smallMun: 'Pimenteiras do Oeste' },
  { code: 'TO', slug: 'to', fips: '17', name: 'Tocantins', region: 'Norte', counties: 139, precincts: '33 zonas eleitorais', capital: 'Palmas', secondCity: 'Araguaína', smallMun: 'Oliveira de Fátima' },
  { code: 'AC', slug: 'ac', fips: '12', name: 'Acre', region: 'Norte', counties: 22, precincts: '10 zonas eleitorais', capital: 'Rio Branco', secondCity: 'Cruzeiro do Sul', smallMun: 'Santa Rosa do Purus' },
  { code: 'AP', slug: 'ap', fips: '16', name: 'Amapá', region: 'Norte', counties: 16, precincts: '12 zonas eleitorais', capital: 'Macapá', secondCity: 'Santana', smallMun: 'Pracuúba' },
  { code: 'RR', slug: 'rr', fips: '14', name: 'Roraima', region: 'Norte', counties: 15, precincts: '8 zonas eleitorais', capital: 'Boa Vista', secondCity: 'Rorainópolis', smallMun: 'Uiramutã' }
];

const stateList = UF_DEFS.map(u => {
  const isDF = u.slug === 'df';
  const unitName = isDF ? 'regiões administrativas' : 'municípios';
  return {
    code: u.code,
    slug: u.slug,
    fips: u.fips,
    name: u.name,
    region: u.region,
    counties: u.counties,
    capital: u.capital,
    secondCity: u.secondCity,
    smallMun: u.smallMun,
    page: `estado.html?uf=${u.slug}`,
    votersPage: `voters.html?uf=${u.slug}`,
    results: {
      href: `estado.html?uf=${u.slug}`,
      kicker: 'Resultados de 2026 e 2018–2026',
      summary: `${u.counties} ${unitName}, ${u.precincts} · Gerais de 2026 e histórico 2018–2026`,
      title: 'Explorar o mapa interativo em 3D',
      desc: `Todos os ${u.counties} ${unitName} e ${u.precincts}, nas Eleições Gerais de 2026 e 2018–2022.`
    },
    dots: `voters.html?uf=${u.slug}`,
    flights: [
      {
        href: `story.html?uf=${u.slug}`,
        title: `Tour guiado pelos ${unitName} →`,
        desc: `De ${u.smallMun} até ${u.capital}, e depois os votos erguidos em 3D.`
      },
      {
        href: `misread.html?uf=${u.slug}`,
        title: 'Como lemos os mapas errado →',
        desc: 'Por que mapas planos pintados pelo vencedor enganam o olhar.'
      },
      {
        href: `shade-by-votes.html?uf=${u.slug}`,
        title: 'E se pintarmos pelo saldo de votos? →',
        desc: 'Um jeito simples de corrigir o mapa plano sem precisar de 3D.'
      }
    ],
    tour: true,
    data: {
      dir: `data/${u.slug}`,
      geo: `data/${u.slug}/municipios.json`,
      r2026: `data/${u.slug}/results-2026.json`,
      history: `data/${u.slug}/results-history.json`,
      cities: `data/${u.slug}/cities.json`,
      precincts: `data/${u.slug}/precincts.json`,
      precinctShapes: `data/${u.slug}/precinct-shapes.json`,
    },
    defaultRace: '2026-pres-2t',
    base: {
      raceId: '2022-presidente',
      label: 'Presidente 2022',
      dem: 'Lula',
      rep: 'Bolsonaro',
      note: 'A altura permanece proporcional ao total de votos válidos de 2022; o roxo marca equilíbrio entre PT e PL.',
    },
    method: `Totais de votos por município e zona eleitoral compilados a partir dos boletins de urna e estatísticas do TSE (2018–2026). No modo de pontos, a posição exata é sorteada dentro da zona eleitoral e ponderada pela densidade demográfica urbana do Censo IBGE 2022 — portanto cada ponto representa um grupo de eleitores reais naquela vizinhança, não um endereço individual.`,
    sources: [
      {
        label: `Resultados de 2026 (${u.code})`,
        href: 'https://resultados.tse.jus.br/',
        text: `Tribunal Superior Eleitoral (TSE) e TRE-${u.code}`,
        tail: ' (apuração oficial de 1º e 2º turnos por município e zona eleitoral)'
      },
      {
        label: 'Série Histórica 2018–2022',
        href: 'https://dadosabertos.tse.jus.br/',
        text: 'Portal de Dados Abertos do TSE',
        tail: ' (votação nominal por município e zona)'
      },
      {
        label: `Malha Municipal e Censo (${u.code})`,
        href: 'https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html',
        text: 'IBGE — Malha Municipal Oficial e Censo Demográfico 2022',
        tail: ''
      }
    ]
  };
});

// Permite usar STATES tanto como Array (original usavote) quanto por chave STATES['sp']
for (const s of stateList) {
  stateList[s.slug] = s;
}

export const STATES = stateList;

function detectSlug() {
  if (typeof location !== 'undefined') {
    const p = new URLSearchParams(location.search);
    const uf = (p.get('uf') || p.get('state') || '').toLowerCase();
    if (uf && stateList[uf]) return uf;
    const m = location.pathname.match(/\/([a-z]{2})(?:-voters)?\.html$/i);
    if (m && stateList[m[1].toLowerCase()]) return m[1].toLowerCase();
  }
  if (typeof document !== 'undefined' && document.documentElement?.dataset?.state) {
    const ds = document.documentElement.dataset.state.toLowerCase();
    if (stateList[ds]) return ds;
  }
  return 'sp';
}

export const STATE = stateList[detectSlug()] || stateList[0];

export function getState(slug) {
  if (!slug) return STATE;
  return stateList[slug.toLowerCase()] || STATE;
}
