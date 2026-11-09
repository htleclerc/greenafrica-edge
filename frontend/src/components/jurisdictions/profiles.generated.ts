// FICHIER GÉNÉRÉ — NE PAS MODIFIER À LA MAIN.
// Source : data/jurisdictions/*.json
// Régénérer : node scripts/build-jurisdiction-profiles.mjs
//
// Ne contient que le sous-ensemble publiable du référentiel pays. Les montants
// (potentiel de recettes, contributions liquidées) vivent dans le bloc
// `internal` des fichiers source et n'arrivent jamais ici : ce module est
// importé par des composants, donc son contenu est servi au navigateur.

/**
 * Branche d'activité sur laquelle la contribution peut porter.
 * Union déduite des codes réellement utilisés : pas de vocabulaire mort.
 * Chaque code doit avoir une clé i18n `Jurisdiction.activity_<code>`.
 */
export type ActivityCode =
    | 'bauxite'
    | 'coal'
    | 'containers'
    | 'copper_cobalt_transit'
    | 'crude_oil'
    | 'general_cargo'
    | 'heavy_sands'
    | 'iron_ore'
    | 'lng'
    | 'manganese'
    | 'ore'
    | 'passenger_flights'
    | 'uranium';

/**
 * Indicateur de trafic publiable.
 * Chaque code doit avoir une clé i18n `Jurisdiction.metric_<code>`.
 */
export type MetricCode =
    | 'aircraft_arrivals'
    | 'aircraft_movements'
    | 'cargo_tonnes'
    | 'commercial_flights'
    | 'container_teu'
    | 'export_tonnes'
    | 'passengers'
    | 'vessel_calls';

/** Mesure de trafic sourcée. Ni `value` ni `year` ne sont facultatifs. */
export interface JurisdictionFigure {
    metric: MetricCode;
    /** Branche dont relève la mesure : le site ne montre que les branches annoncées. */
    mode: 'MARITIME' | 'AIR' | 'MINING';
    /** Qualifie la mesure quand l'indicateur seul est ambigu (ex. tonnes de quoi). */
    subject?: ActivityCode;
    /** Port ou aéroport mesuré, quand le pays en compte plusieurs. Nom propre : jamais traduit. */
    gateway?: string;
    value: number;
    year: number;
    /** Présent quand la mesure ne couvre pas une année pleine : à afficher, sinon le chiffre se lit comme annuel. */
    period?: string;
    /** `true` quand la source qualifie elle-même le chiffre de projection. */
    projection?: boolean;
    sourceLabel: string;
    /** `null` quand seule la référence papier est connue — on affiche le libellé sans lien. */
    sourceUrl: string | null;
    note?: string;
}

/** Ce sur quoi la contribution peut porter, dans une juridiction donnée. */
export interface JurisdictionScope {
    mode: 'MARITIME' | 'AIR' | 'MINING';
    activity: ActivityCode;
    /** Port, aéroport ou bassin minier. Nom propre : jamais traduit. */
    gateway: string;
}

export interface JurisdictionProfile {
    key: string;
    status: 'live' | 'pipeline';
    scopes: readonly JurisdictionScope[];
    figures: readonly JurisdictionFigure[];
}

const PROFILES: readonly JurisdictionProfile[] = [
    {
        "key": "ao",
        "status": "pipeline",
        "scopes": [
            {
                "mode": "MARITIME",
                "activity": "containers",
                "gateway": "Porto de Luanda"
            },
            {
                "mode": "MARITIME",
                "activity": "crude_oil",
                "gateway": "Terminaux offshore — chargement en tandem sur FPSO"
            },
            {
                "mode": "MARITIME",
                "activity": "lng",
                "gateway": "Angola LNG, Soyo"
            },
            {
                "mode": "MINING",
                "activity": "copper_cobalt_transit",
                "gateway": "Lobito — terminus du corridor ferroviaire RDC/Zambie"
            }
        ],
        "figures": [
            {
                "metric": "vessel_calls",
                "mode": "MARITIME",
                "gateway": "Porto de Luanda",
                "value": 4739,
                "year": 2024,
                "sourceLabel": "Porto de Luanda — Movimento de Navios",
                "sourceUrl": "https://www.portoluanda.co.ao/wp-content/uploads/2025/04/Movimentos_Navios_Anual.pdf",
                "note": "Dont 3 967 navires de servitude pétrolière offshore, 439 porte-conteneurs et 205 cargos conventionnels."
            },
            {
                "metric": "container_teu",
                "mode": "MARITIME",
                "gateway": "Porto de Luanda",
                "value": 686485,
                "year": 2024,
                "sourceLabel": "Porto de Luanda — Mercadorias Contentorizadas",
                "sourceUrl": "https://www.portoluanda.co.ao/wp-content/uploads/2025/04/Movimentos_Mercadorias_Contentorizadas_Anual.pdf",
                "note": "360 360 pleins et 326 125 vides."
            },
            {
                "metric": "cargo_tonnes",
                "mode": "MARITIME",
                "gateway": "Porto de Luanda",
                "value": 16637827,
                "year": 2024,
                "sourceLabel": "Porto de Luanda — Movimento de Mercadorias",
                "sourceUrl": "https://www.portoluanda.co.ao/wp-content/uploads/2025/04/Movimentos_Mercadorias_Anual.pdf"
            }
        ]
    },
    {
        "key": "ci",
        "status": "pipeline",
        "scopes": [
            {
                "mode": "MARITIME",
                "activity": "containers",
                "gateway": "Port autonome d’Abidjan"
            },
            {
                "mode": "MARITIME",
                "activity": "general_cargo",
                "gateway": "Port autonome de San-Pédro"
            },
            {
                "mode": "MINING",
                "activity": "ore",
                "gateway": "Terminal industriel polyvalent de San-Pédro (TIPSP)"
            },
            {
                "mode": "AIR",
                "activity": "passenger_flights",
                "gateway": "Abidjan Félix-Houphouët-Boigny (ABJ)"
            }
        ],
        "figures": [
            {
                "metric": "vessel_calls",
                "mode": "MARITIME",
                "gateway": "Port autonome d’Abidjan",
                "value": 2595,
                "year": 2024,
                "sourceLabel": "Ministère des Transports / Port autonome d’Abidjan",
                "sourceUrl": "https://economie-ivoirienne.ci/activites-sectorielles/transport-maritime.html",
                "note": "Série officielle continue depuis 2012."
            },
            {
                "metric": "vessel_calls",
                "mode": "MARITIME",
                "gateway": "Port autonome de San-Pédro",
                "value": 388,
                "year": 2025,
                "sourceLabel": "Port autonome de San-Pédro — statistiques 2021-2025",
                "sourceUrl": "https://sanpedro-portci.com/wp-content/uploads/2026/07/Trfic_Site-PASP.pdf"
            },
            {
                "metric": "container_teu",
                "mode": "MARITIME",
                "gateway": "Port autonome d’Abidjan",
                "value": 1697131,
                "year": 2025,
                "sourceLabel": "Port autonome d’Abidjan",
                "sourceUrl": "https://www.economie-ivoirienne.ci/index.php/actualites/cote-divoire-performance-historique-du-port-autonome-dabidjan-avec-466-millions-de"
            },
            {
                "metric": "cargo_tonnes",
                "mode": "MARITIME",
                "gateway": "Port autonome d’Abidjan",
                "value": 46600000,
                "year": 2025,
                "sourceLabel": "Port autonome d’Abidjan",
                "sourceUrl": "https://www.economie-ivoirienne.ci/index.php/actualites/cote-divoire-performance-historique-du-port-autonome-dabidjan-avec-466-millions-de",
                "note": "Dont 34,2 Mt de trafic national, 3,92 Mt de transit et 8,46 Mt de transbordement."
            },
            {
                "metric": "aircraft_movements",
                "mode": "AIR",
                "gateway": "Abidjan Félix-Houphouët-Boigny",
                "value": 33104,
                "year": 2024,
                "sourceLabel": "Ministère des Transports / AERIA",
                "sourceUrl": "https://economie-ivoirienne.ci/activites-sectorielles/transport-maritime.html",
                "note": "Total arrivées + départs, soit environ 16 550 arrivées."
            }
        ]
    },
    {
        "key": "cm",
        "status": "pipeline",
        "scopes": [
            {
                "mode": "MARITIME",
                "activity": "containers",
                "gateway": "Port autonome de Kribi (Lolabé)"
            },
            {
                "mode": "MARITIME",
                "activity": "general_cargo",
                "gateway": "Port autonome de Douala-Bonabéri"
            },
            {
                "mode": "MARITIME",
                "activity": "crude_oil",
                "gateway": "Terminal de Limboh, Limbe"
            },
            {
                "mode": "MARITIME",
                "activity": "lng",
                "gateway": "Hilli Episeyo (FLNG), Kribi"
            },
            {
                "mode": "AIR",
                "activity": "passenger_flights",
                "gateway": "Douala (DLA) et Yaoundé-Nsimalen (NSI)"
            }
        ],
        "figures": [
            {
                "metric": "vessel_calls",
                "mode": "MARITIME",
                "gateway": "Port autonome de Kribi",
                "value": 559,
                "year": 2025,
                "sourceLabel": "Port autonome de Kribi, relayé par EcoMatin",
                "sourceUrl": "https://ecomatin.net/cameroun-le-port-de-kribi-genere-335-milliards-fcfa-de-recettes-douanieres-en-2025",
                "note": "412 escales en 2024 ; 3 471 cumulées depuis 2018."
            },
            {
                "metric": "container_teu",
                "mode": "MARITIME",
                "gateway": "Port autonome de Kribi",
                "value": 555398,
                "year": 2025,
                "sourceLabel": "Port autonome de Kribi, relayé par News du Cameroun",
                "sourceUrl": "https://www.newsducamer.com/port-de-kribi-le-trafic-de-conteneurs-bondit-de-3089-entre-2018-et-2025/",
                "note": "304 546 EVP en 2024 : le trafic a presque doublé en un an."
            },
            {
                "metric": "cargo_tonnes",
                "mode": "MARITIME",
                "gateway": "Ensemble des ports camerounais",
                "value": 26930000,
                "year": 2024,
                "sourceLabel": "Investir au Cameroun, d’après les ports autonomes",
                "sourceUrl": "https://www.investiraucameroun.com/gestion-publique/1311-22739-port-de-douala-12-9-millions-de-tonnes-traitees-en-2024-malgre-un-leger-recul-du-trafic-national",
                "note": "Douala 12,92 Mt ; Kribi 10,84 Mt sur le périmètre national."
            },
            {
                "metric": "aircraft_movements",
                "mode": "AIR",
                "gateway": "Douala (DLA)",
                "value": 18436,
                "year": 2024,
                "sourceLabel": "Aéroports du Cameroun (ADC)",
                "sourceUrl": "https://www.businessincameroon.com/transport/0909-14983-cameroon-air-traffic-hits-1-77-million-passengers-in-2024",
                "note": "Total arrivées + départs, définition confirmée par la CCAA."
            }
        ]
    },
    {
        "key": "dj",
        "status": "live",
        "scopes": [
            {
                "mode": "MARITIME",
                "activity": "containers",
                "gateway": "Doraleh Container Terminal"
            },
            {
                "mode": "MARITIME",
                "activity": "general_cargo",
                "gateway": "Port de Doraleh — corridor éthiopien"
            },
            {
                "mode": "AIR",
                "activity": "passenger_flights",
                "gateway": "Djibouti-Ambouli (JIB)"
            }
        ],
        "figures": [
            {
                "metric": "cargo_tonnes",
                "mode": "MARITIME",
                "gateway": "Ensemble des ports de Djibouti",
                "value": 20827982,
                "year": 2024,
                "sourceLabel": "Banque Centrale de Djibouti — Rapport annuel 2024",
                "sourceUrl": "https://banque-centrale.dj/wp-content/uploads/2025/09/Rapport-Annuel_-V.Definitive.pdf",
                "note": "17 978 588 t en 2023. Dont 14 582 423 t de transit éthiopien."
            },
            {
                "metric": "vessel_calls",
                "mode": "MARITIME",
                "gateway": "Doraleh Container Terminal",
                "value": 653,
                "year": 2024,
                "sourceLabel": "SGTD — Société de Gestion du Terminal à conteneurs de Doraleh",
                "sourceUrl": "https://www.transportevents.com/presentations/djibouti26/SGTD.pdf",
                "note": "422 en 2022, 556 en 2023. Terminal à conteneurs seul : aucun comptage à l’échelle du port n’est publié."
            },
            {
                "metric": "container_teu",
                "mode": "MARITIME",
                "gateway": "Ensemble des ports de Djibouti",
                "value": 1293000,
                "year": 2024,
                "sourceLabel": "CNUCED, via la Banque mondiale",
                "sourceUrl": null
            },
            {
                "metric": "passengers",
                "mode": "AIR",
                "gateway": "Djibouti-Ambouli (JIB)",
                "value": 278502,
                "year": 2024,
                "sourceLabel": "Banque Centrale de Djibouti — Rapport annuel 2024",
                "sourceUrl": "https://banque-centrale.dj/wp-content/uploads/2025/09/Rapport-Annuel_-V.Definitive.pdf"
            }
        ]
    },
    {
        "key": "ga",
        "status": "pipeline",
        "scopes": [
            {
                "mode": "MARITIME",
                "activity": "containers",
                "gateway": "Owendo — terminal à conteneurs"
            },
            {
                "mode": "MARITIME",
                "activity": "general_cargo",
                "gateway": "Owendo — port commercial"
            },
            {
                "mode": "MARITIME",
                "activity": "crude_oil",
                "gateway": "Port-Gentil et Cap Lopez"
            },
            {
                "mode": "MINING",
                "activity": "manganese",
                "gateway": "Owendo — terminal minéralier Comilog"
            }
        ],
        "figures": [
            {
                "metric": "vessel_calls",
                "mode": "MARITIME",
                "gateway": "Ensemble des ports gabonais",
                "value": 762,
                "year": 2017,
                "sourceLabel": "OPRAG, relayé par Financial Afrik",
                "sourceUrl": "https://www.financialafrik.com/2018/06/24/762-navires-de-commerce-ont-accoste-au-gabon-en-2017",
                "note": "Dernier comptage national publié. Les pages statistiques de l’OPRAG ne sont plus accessibles."
            },
            {
                "metric": "container_teu",
                "mode": "MARITIME",
                "gateway": "Ensemble des ports gabonais",
                "value": 180878,
                "year": 2024,
                "sourceLabel": "CNUCED, via la Banque mondiale",
                "sourceUrl": null
            },
            {
                "metric": "export_tonnes",
                "mode": "MINING",
                "subject": "manganese",
                "gateway": "Owendo",
                "value": 9442000,
                "year": 2024,
                "sourceLabel": "Direction générale de l’Économie et de la politique fiscale (DGEPF)",
                "sourceUrl": null,
                "note": "2e producteur mondial en teneur métal selon l’USGS. Environ 9,1 Mt en 2025."
            },
            {
                "metric": "aircraft_movements",
                "mode": "AIR",
                "gateway": "Ensemble des aéroports gabonais",
                "value": 16790,
                "year": 2024,
                "sourceLabel": "DGEPF, relayé par Gabon Media Time",
                "sourceUrl": "https://gabonmediatime.com/gabon-lactivite-du-transport-aerien-en-hausse-de-41-a-fin-2025/"
            },
            {
                "metric": "passengers",
                "mode": "AIR",
                "gateway": "Ensemble des aéroports gabonais",
                "value": 844419,
                "year": 2024,
                "sourceLabel": "DGEPF, relayé par Gabon Media Time",
                "sourceUrl": "https://gabonmediatime.com/gabon-lactivite-du-transport-aerien-en-hausse-de-41-a-fin-2025/",
                "note": "Libreville environ 750 000, Port-Gentil environ 375 000."
            }
        ]
    },
    {
        "key": "gh",
        "status": "pipeline",
        "scopes": [
            {
                "mode": "MARITIME",
                "activity": "containers",
                "gateway": "Port de Tema"
            },
            {
                "mode": "MARITIME",
                "activity": "general_cargo",
                "gateway": "Port de Takoradi"
            },
            {
                "mode": "MARITIME",
                "activity": "crude_oil",
                "gateway": "Champs offshore Jubilee, TEN et Sankofa (FPSO)"
            },
            {
                "mode": "MINING",
                "activity": "manganese",
                "gateway": "Nsuta — export par Takoradi"
            },
            {
                "mode": "MINING",
                "activity": "bauxite",
                "gateway": "Awaso — export par Takoradi"
            },
            {
                "mode": "AIR",
                "activity": "passenger_flights",
                "gateway": "Accra (ACC)"
            }
        ],
        "figures": [
            {
                "metric": "vessel_calls",
                "mode": "MARITIME",
                "gateway": "Port de Tema",
                "value": 1435,
                "year": 2023,
                "sourceLabel": "Ghana Revenue Authority, citant GPHA",
                "sourceUrl": "https://gra.gov.gh/tema-collection-holds-the-first-quarter-meeting-of-the-joint-customs-consultative-meeting-jccc-30th-april-2024/",
                "note": "En léger recul sur les 1 471 escales de 2022."
            },
            {
                "metric": "vessel_calls",
                "mode": "MARITIME",
                "gateway": "Port de Takoradi",
                "value": 770,
                "year": 2024,
                "sourceLabel": "Ghana News Agency — direction du port de Takoradi",
                "sourceUrl": "https://gna.org.gh/2025/12/2025-has-been-a-strong-year-for-takoradi-port-director/",
                "note": "Dont 253 escales de navires de servitude offshore."
            },
            {
                "metric": "vessel_calls",
                "mode": "MARITIME",
                "gateway": "Port de Takoradi",
                "value": 867,
                "year": 2025,
                "period": "janv.–nov. 2025",
                "sourceLabel": "Ghana News Agency — direction du port de Takoradi",
                "sourceUrl": "https://gna.org.gh/2025/12/2025-has-been-a-strong-year-for-takoradi-port-director/",
                "note": "Onze mois de 2025 dépassent déjà l’année 2024 entière."
            },
            {
                "metric": "container_teu",
                "mode": "MARITIME",
                "gateway": "Port de Tema",
                "value": 1668688,
                "year": 2024,
                "sourceLabel": "GPHA, via Citi Newsroom",
                "sourceUrl": "https://www.citinewsroom.com/2025/09/ghanas-container-traffic-hits-record-high-driven-by-tema-port-gpha/",
                "note": "Tema concentre 98 % du conteneur ghanéen."
            },
            {
                "metric": "container_teu",
                "mode": "MARITIME",
                "gateway": "Port de Takoradi",
                "value": 32558,
                "year": 2024,
                "sourceLabel": "GPHA, via Citi Newsroom",
                "sourceUrl": "https://www.citinewsroom.com/2025/09/ghanas-container-traffic-hits-record-high-driven-by-tema-port-gpha/"
            },
            {
                "metric": "cargo_tonnes",
                "mode": "MARITIME",
                "gateway": "Port de Takoradi",
                "value": 10300000,
                "year": 2025,
                "period": "janv.–nov. 2025",
                "sourceLabel": "Ghana News Agency — direction du port de Takoradi",
                "sourceUrl": "https://gna.org.gh/2025/12/2025-has-been-a-strong-year-for-takoradi-port-director/",
                "note": "Contre 9,4 Mt sur les onze mois de 2024."
            },
            {
                "metric": "aircraft_movements",
                "mode": "AIR",
                "gateway": "Accra (ACC)",
                "value": 43858,
                "year": 2023,
                "sourceLabel": "Times Aerospace",
                "sourceUrl": "https://timesaerospace.aero/features/airports/its-ghana-be-exciting",
                "note": "Total arrivées + départs, soit environ 21 900 arrivées."
            }
        ]
    },
    {
        "key": "gn",
        "status": "pipeline",
        "scopes": [
            {
                "mode": "MINING",
                "activity": "bauxite",
                "gateway": "Boké — Kamsar, Dapilon, Boffa"
            },
            {
                "mode": "MINING",
                "activity": "iron_ore",
                "gateway": "Simandou — port de Morebaya"
            },
            {
                "mode": "MARITIME",
                "activity": "containers",
                "gateway": "Port autonome de Conakry"
            },
            {
                "mode": "AIR",
                "activity": "passenger_flights",
                "gateway": "Aéroport international Ahmed Sékou Touré (CKY)"
            }
        ],
        "figures": [
            {
                "metric": "export_tonnes",
                "mode": "MINING",
                "subject": "bauxite",
                "gateway": "Boké",
                "value": 183000000,
                "year": 2025,
                "sourceLabel": "Reuters / China Global South",
                "sourceUrl": null,
                "note": "Premier exportateur mondial, +25 % sur un an."
            },
            {
                "metric": "export_tonnes",
                "mode": "MINING",
                "subject": "iron_ore",
                "gateway": "Simandou — port de Morebaya",
                "value": 20000000,
                "year": 2026,
                "projection": true,
                "sourceLabel": "S&P Global, Breakwave Advisors",
                "sourceUrl": null,
                "note": "Premières expéditions fin 2025 via Morebaya. Capacité visée ≈ 120 Mt/an vers 2030."
            },
            {
                "metric": "container_teu",
                "mode": "MARITIME",
                "gateway": "Port autonome de Conakry",
                "value": 416892,
                "year": 2025,
                "sourceLabel": "Conakry Terminal",
                "sourceUrl": null,
                "note": "≈ 90 % du commerce extérieur du pays passe par Conakry."
            },
            {
                "metric": "aircraft_movements",
                "mode": "AIR",
                "gateway": "Aéroport Ahmed Sékou Touré (CKY)",
                "value": 13067,
                "year": 2025,
                "sourceLabel": "Aéroport international Ahmed Sékou Touré",
                "sourceUrl": null,
                "note": "Total des mouvements (+19 %), soit ≈ 6 530 arrivées."
            },
            {
                "metric": "passengers",
                "mode": "AIR",
                "gateway": "Aéroport Ahmed Sékou Touré (CKY)",
                "value": 957820,
                "year": 2025,
                "sourceLabel": "Aéroport international Ahmed Sékou Touré",
                "sourceUrl": null,
                "note": "+21 % sur un an."
            }
        ]
    },
    {
        "key": "mr",
        "status": "pipeline",
        "scopes": [
            {
                "mode": "AIR",
                "activity": "passenger_flights",
                "gateway": "Nouakchott-Oumtounsy (NKC) et Nouadhibou (NDB)"
            },
            {
                "mode": "MINING",
                "activity": "iron_ore",
                "gateway": "Nouadhibou — Point Central (SNIM)"
            },
            {
                "mode": "MARITIME",
                "activity": "general_cargo",
                "gateway": "Port autonome de Nouakchott (PANPA)"
            }
        ],
        "figures": [
            {
                "metric": "vessel_calls",
                "mode": "MINING",
                "gateway": "Nouadhibou — Point Central",
                "value": 99,
                "year": 2024,
                "sourceLabel": "SNIM — Rapport d’activité 2024",
                "sourceUrl": "https://snim.com/sites/default/files/SNIM-Rapport-activite-2024.pdf",
                "note": "Navires chargés de minerai. Le chenal accepte jusqu’à 230 000 t ; plus grosse cargaison 153 214 t."
            },
            {
                "metric": "export_tonnes",
                "mode": "MINING",
                "subject": "iron_ore",
                "gateway": "Nouadhibou — Point Central",
                "value": 14226000,
                "year": 2024,
                "sourceLabel": "SNIM — Rapport d’activité 2024",
                "sourceUrl": "https://snim.com/sites/default/files/SNIM-Rapport-activite-2024.pdf"
            }
        ]
    },
    {
        "key": "mz",
        "status": "pipeline",
        "scopes": [
            {
                "mode": "MARITIME",
                "activity": "general_cargo",
                "gateway": "Maputo et Matola"
            },
            {
                "mode": "MARITIME",
                "activity": "containers",
                "gateway": "Beira et Nacala"
            },
            {
                "mode": "MARITIME",
                "activity": "lng",
                "gateway": "Coral Sul FLNG, bassin du Rovuma"
            },
            {
                "mode": "MINING",
                "activity": "heavy_sands",
                "gateway": "Moma — transbordement au large"
            },
            {
                "mode": "MINING",
                "activity": "coal",
                "gateway": "Nacala-a-Velha, corridor de Moatize"
            }
        ],
        "figures": [
            {
                "metric": "cargo_tonnes",
                "mode": "MARITIME",
                "gateway": "Port de Maputo (Maputo et Matola)",
                "value": 32000000,
                "year": 2025,
                "sourceLabel": "MPDC — Port of Maputo",
                "sourceUrl": "https://www.portmaputo.com/port-of-maputo-achieves-historic-records-in-volumes-and-strengthens-its-contribution-to-national-development/",
                "note": "Record absolu, en hausse de 3,4 % sur 2024."
            },
            {
                "metric": "cargo_tonnes",
                "mode": "MARITIME",
                "gateway": "Réseau portuaire et ferroviaire CFM",
                "value": 66500000,
                "year": 2024,
                "sourceLabel": "CFM, relayé par Lusa",
                "sourceUrl": "https://aman-alliance.org/Home/ContentDetail/88590",
                "note": "63,4 Mt en 2023."
            },
            {
                "metric": "export_tonnes",
                "mode": "MINING",
                "subject": "heavy_sands",
                "gateway": "Moma",
                "value": 3506512,
                "year": 2024,
                "sourceLabel": "USGS",
                "sourceUrl": null,
                "note": "Ilménite et leucoxène. 2e producteur mondial, 21 % du marché."
            },
            {
                "metric": "aircraft_movements",
                "mode": "AIR",
                "gateway": "Ensemble des aéroports mozambicains",
                "value": 54495,
                "year": 2025,
                "sourceLabel": "IACM, relayé par Forbes África Lusófona",
                "sourceUrl": "https://forbesafricalusofona.com/?p=172057",
                "note": "Total arrivées + départs, en baisse de 10,9 %."
            }
        ]
    },
    {
        "key": "ne",
        "status": "pipeline",
        "scopes": [
            {
                "mode": "AIR",
                "activity": "passenger_flights",
                "gateway": "Niamey Diori Hamani (NIM)"
            },
            {
                "mode": "MINING",
                "activity": "uranium",
                "gateway": "Arlit — SOMAÏR"
            },
            {
                "mode": "MINING",
                "activity": "crude_oil",
                "gateway": "Pipeline Niger-Bénin, vers le terminal de Sèmè-Kpodji (Bénin)"
            }
        ],
        "figures": [
            {
                "metric": "export_tonnes",
                "mode": "MINING",
                "subject": "uranium",
                "gateway": "Arlit — SOMAÏR",
                "value": 959,
                "year": 2024,
                "sourceLabel": "World Nuclear Association",
                "sourceUrl": null,
                "note": "1 130 t en 2023, 2 020 t en 2022. SOMAÏR nationalisée en juin 2025."
            }
        ]
    },
    {
        "key": "ng",
        "status": "pipeline",
        "scopes": [
            {
                "mode": "MARITIME",
                "activity": "containers",
                "gateway": "Lagos (Apapa, Tin Can Island) et Lekki"
            },
            {
                "mode": "MARITIME",
                "activity": "crude_oil",
                "gateway": "Terminaux de Bonny, Forcados et Qua Iboe"
            },
            {
                "mode": "MARITIME",
                "activity": "lng",
                "gateway": "Bonny (NLNG)"
            },
            {
                "mode": "MARITIME",
                "activity": "general_cargo",
                "gateway": "Onne, Calabar, Warri et Rivers"
            },
            {
                "mode": "AIR",
                "activity": "passenger_flights",
                "gateway": "Lagos (LOS) et Abuja (ABV)"
            }
        ],
        "figures": [
            {
                "metric": "vessel_calls",
                "mode": "MARITIME",
                "gateway": "Ensemble des ports nigérians",
                "value": 4005,
                "year": 2024,
                "sourceLabel": "Nigerian Ports Authority — bilan annuel 2024",
                "sourceUrl": "https://www.legit.ng/business-economy/maritime/1660073-our-1bn-ports-rehabilitation-measures-transforming-nigerias-blue-economy-npa",
                "note": "En hausse de 5,6 % sur les 3 791 escales de 2023."
            },
            {
                "metric": "container_teu",
                "mode": "MARITIME",
                "gateway": "Ensemble des ports nigérians",
                "value": 1744972,
                "year": 2024,
                "sourceLabel": "Nigerian Ports Authority — bilan annuel 2024",
                "sourceUrl": "https://www.legit.ng/business-economy/maritime/1660073-our-1bn-ports-rehabilitation-measures-transforming-nigerias-blue-economy-npa",
                "note": "En hausse de 9,7 % sur un an."
            },
            {
                "metric": "cargo_tonnes",
                "mode": "MARITIME",
                "gateway": "Ensemble des ports nigérians",
                "value": 103300000,
                "year": 2024,
                "sourceLabel": "Nigerian Ports Authority — bilan annuel 2024",
                "sourceUrl": "https://tribuneonlineng.com/x-raying-dantsohos-scorecard-at-npa-one-year-after/amp",
                "note": "Vracs liquides 55,6 %, conteneurs 20,9 %."
            }
        ]
    },
    {
        "key": "sn",
        "status": "pipeline",
        "scopes": [
            {
                "mode": "MARITIME",
                "activity": "containers",
                "gateway": "Port autonome de Dakar"
            },
            {
                "mode": "MARITIME",
                "activity": "crude_oil",
                "gateway": "Sangomar — chargement au large"
            },
            {
                "mode": "MARITIME",
                "activity": "lng",
                "gateway": "Grand Tortue Ahmeyim (GTA) — FLNG au large"
            },
            {
                "mode": "AIR",
                "activity": "passenger_flights",
                "gateway": "Aéroport international Blaise Diagne (DSS)"
            }
        ],
        "figures": [
            {
                "metric": "aircraft_arrivals",
                "mode": "AIR",
                "gateway": "Aéroport international Blaise Diagne",
                "value": 11720,
                "year": 2024,
                "sourceLabel": "ANACIM — Bulletin statistique du trafic aérien 2024",
                "sourceUrl": "https://www.anacim.sn/IMG/pdf/bulletin_statistiques_trafic_aerien_2024.pdf",
                "note": "Arrivées commerciales seules — le seul comptage publié en arrivées, et non en mouvements totaux. 12 415 en 2023."
            },
            {
                "metric": "passengers",
                "mode": "AIR",
                "gateway": "Aéroport international Blaise Diagne",
                "value": 3050154,
                "year": 2024,
                "sourceLabel": "ANACIM — Bulletin statistique du trafic aérien 2024",
                "sourceUrl": "https://www.anacim.sn/IMG/pdf/bulletin_statistiques_trafic_aerien_2024.pdf"
            },
            {
                "metric": "container_teu",
                "mode": "MARITIME",
                "gateway": "Port autonome de Dakar",
                "value": 881289,
                "year": 2024,
                "sourceLabel": "Port autonome de Dakar",
                "sourceUrl": null,
                "note": "908 529 EVP en 2025."
            }
        ]
    },
    {
        "key": "somaliland",
        "status": "live",
        "scopes": [
            {
                "mode": "MARITIME",
                "activity": "general_cargo",
                "gateway": "Port de Berbera"
            },
            {
                "mode": "AIR",
                "activity": "passenger_flights",
                "gateway": "Hargeisa Egal (HGA) et Berbera (BBO)"
            }
        ],
        "figures": [
            {
                "metric": "vessel_calls",
                "mode": "MARITIME",
                "gateway": "Port de Berbera",
                "value": 391,
                "year": 2026,
                "period": "1 mai → 31 août 2026",
                "sourceLabel": "Green Gate — relevés VesselFinder",
                "sourceUrl": null,
                "note": "346 escales du 1er mai au 3 août (export web) + 45 du 4 au 31 août (API, couverture ≈ 47 % : plancher)."
            },
            {
                "metric": "commercial_flights",
                "mode": "AIR",
                "gateway": "Hargeisa (HGA) et Berbera (BBO)",
                "value": 688,
                "year": 2026,
                "period": "1 juin → 31 août 2026",
                "sourceLabel": "Green Gate — méthode RFI",
                "sourceUrl": null,
                "note": "Dont 192 vols issus du planning type et non de relevés de mouvements : recalage SCAAA/HGA/BBO à faire."
            }
        ]
    }
];

/** Profil d'une juridiction, ou `undefined` si elle n'est pas encore documentée. */
export function profileFor(key: string): JurisdictionProfile | undefined {
    return PROFILES.find((p) => p.key === key);
}

/** Toutes les juridictions documentées. L'ordre d'affichage vient de coverage.ts, pas d'ici. */
export const JURISDICTION_PROFILES = PROFILES;
