import type {
  EsgDriverSection,
  EsgDriverType,
  GenerateEsgDriversInput,
} from "./types";

export interface EsgDriverLogic {
  id: string;
  section: EsgDriverSection;
  type: EsgDriverType;
  logic: string;
  preciseQuestion: string;
  evidenceTarget: string;
  sourcePriorities: string[];
  /** Legacy registry scopes accepted for a catalog archetype. */
  registryLogicIds?: string[];
  /** Exact catalog URLs to hydrate before broader same-publisher discovery. */
  seedUrls?: string[];
  catalogArchetypeId?: string;
  catalogName?: string;
  catalogCountryScopes?: string[];
  catalogSectorScopes?: string[];
  catalogSectorFamilies?: string[];
  catalogSourceStatus?: "reviewed-seed" | "reviewed-guidance-only" | "missing";
  exampleGuidance?: string;
  catalogEvidenceCategory?:
    | "regulation"
    | "policy"
    | "forecast"
    | "market-metric"
    | "standard"
    | "evergreen-framework"
    | "risk"
    | "other";
  specialistLibrary?: string | null;
  documentVersion?: string | null;
  pageReferences?: string[];
}

export const DRIVER_LOGIC_LIBRARY: EsgDriverLogic[] = [
  {
    id: "global-climate-commitments",
    section: "Global Drivers",
    type: "General",
    logic: "Show global climate commitments and climate-finance direction.",
    preciseQuestion:
      "Which global climate commitment or finance target creates a broad ESG expectation for the pitch?",
    evidenceTarget:
      "Global net-zero country count, COP finance target, Paris Agreement/NDC momentum, or equivalent dated commitment.",
    sourcePriorities: ["UNFCCC", "UN", "COP presidency", "OECD", "World Bank"],
  },
  {
    id: "sector-emissions-footprint",
    section: "Global Drivers",
    type: "Sector-related",
    logic: "Show the sector contribution to global emissions or financed emissions.",
    preciseQuestion:
      "How material is the selected sector to global emissions, climate risk, or financed emissions?",
    evidenceTarget:
      "Sector emissions share, annual emissions volume, financed-emissions estimate, or authoritative sector footprint metric.",
    sourcePriorities: ["IEA", "IMO", "UNEP FI", "PCAF", "sector regulator"],
  },
  {
    id: "sector-transition-initiative",
    section: "Global Drivers",
    type: "Sector-related",
    logic: "Show a sector decarbonization ambition, pathway, or international initiative.",
    preciseQuestion:
      "Which sector pathway or initiative sets transition expectations for companies in this sector?",
    evidenceTarget:
      "2030/2050 target, sector initiative membership, transition pathway, or recognized framework.",
    sourcePriorities: ["IEA", "UNEP FI", "SBTi", "sector bodies", "standards bodies"],
  },
  {
    id: "global-disclosure-standards",
    section: "Regulatory Requirements",
    type: "General",
    logic: "Show global sustainability disclosure momentum and ISSB/IFRS adoption.",
    preciseQuestion:
      "Which global disclosure standard or adoption trend raises the reporting bar?",
    evidenceTarget:
      "ISSB/IFRS S1/S2 adoption count, regulatory adoption status, or global disclosure requirement.",
    sourcePriorities: ["IFRS Foundation", "IOSCO", "stock exchanges", "regulators"],
  },
  {
    id: "country-climate-policy",
    section: "Regulatory Requirements",
    type: "Country-related",
    logic: "Show the latest country climate strategy, NDC, net-zero target, or climate law.",
    preciseQuestion:
      "Which national policy, NDC, law, or strategy makes ESG relevant in this country?",
    evidenceTarget:
      "NDC target, net-zero target, climate law, green economy strategy, or dated national roadmap.",
    sourcePriorities: ["national government", "UNFCCC", "climate ministry", "World Bank"],
  },
  {
    id: "country-sector-regulation",
    section: "Regulatory Requirements",
    type: "Country-related",
    logic: "Show the most relevant country or sector ESG regulation affecting this sector.",
    preciseQuestion:
      "Which country-specific sector regulation, disclosure rule, taxonomy, or supervisory expectation affects this sector?",
    evidenceTarget:
      "Effective date, regulator requirement, disclosure principle, taxonomy, climate-risk rule, or compliance milestone.",
    sourcePriorities: ["central bank", "market regulator", "sector regulator", "stock exchange"],
  },
  {
    id: "global-climate-macro-risk",
    section: "Climate Risks",
    type: "General",
    logic: "Show global macroeconomic value at risk from climate change.",
    preciseQuestion:
      "What global climate-risk estimate shows the scale of economic or financial exposure?",
    evidenceTarget:
      "GDP-at-risk estimate, annual loss estimate, financial-stability warning, or global physical-risk metric.",
    sourcePriorities: ["FSB", "NGFS", "World Bank", "IMF", "Swiss Re"],
  },
  {
    id: "country-sector-climate-risk",
    section: "Climate Risks",
    type: "Country-related",
    logic: "Show country climate exposure using metrics relevant to the sector.",
    preciseQuestion:
      "Which physical or transition climate risk matters most for this sector in this country?",
    evidenceTarget:
      "Water stress, heat, flooding, transition-risk exposure, climate disaster cost, GDP impact, or sector-specific asset risk.",
    sourcePriorities: ["World Bank", "ADB", "national climate risk report", "FSB", "NGFS"],
  },
  {
    id: "investor-lender-expectations",
    section: "Capital Markets",
    type: "Sector-related",
    logic: "Show investor, lender, or stock-exchange expectations for the sector.",
    preciseQuestion:
      "What do investors, lenders, banks, or exchanges increasingly expect from companies in this sector?",
    evidenceTarget:
      "Investor policy, lender framework, stock-exchange disclosure requirement, 1.5C alignment pathway, or sector poll.",
    sourcePriorities: ["FSB", "NGFS", "UNEP FI", "stock exchanges", "large investors"],
  },
  {
    id: "development-finance-pressure",
    section: "Capital Markets",
    type: "Country-related",
    logic: "Show development-bank or capital-provider ESG requirements in the country.",
    preciseQuestion:
      "How do development banks or major capital providers create ESG pressure in this country?",
    evidenceTarget:
      "Country portfolio value, DFI project count, ESG safeguard requirement, green finance framework, or sustainable finance program.",
    sourcePriorities: ["World Bank", "IFC", "EBRD", "ADB", "IsDB"],
  },
  {
    id: "supply-chain-climate-exposure",
    section: "Supply Chain",
    type: "General",
    logic: "Show global supply-chain exposure to climate risks and Scope 3 emissions.",
    preciseQuestion:
      "Which global supply-chain risk or Scope 3 metric makes supply-chain ESG material?",
    evidenceTarget:
      "Supply-chain climate-loss estimate, Scope 3 share, supplier emissions share, or climate disruption estimate.",
    sourcePriorities: ["CDP", "WEF", "WRI", "GHG Protocol", "World Bank"],
  },
  {
    id: "sector-supply-chain-solution",
    section: "Supply Chain",
    type: "Sector-related",
    logic: "Show the leading supply-chain decarbonization lever for the sector.",
    preciseQuestion:
      "Which supply-chain, procurement, Scope 3, or client-financing lever is most relevant for this sector?",
    evidenceTarget:
      "Sector supply-chain target, Scope 3 lever, low-carbon input, sustainable procurement standard, or client supply-chain finance solution.",
    sourcePriorities: ["sector bodies", "IEA", "IATA", "GHG Protocol", "UNEP FI"],
  },
  {
    id: "sustainable-finance-market",
    section: "Global Drivers",
    type: "Sector-related",
    logic: "Show sustainable finance frameworks or market programs shaping the sector.",
    preciseQuestion:
      "Which sustainable finance framework or market program creates a practical ESG direction for this sector?",
    evidenceTarget:
      "Sustainable finance framework, banking principle, market program, or dated finance initiative.",
    sourcePriorities: ["UNEP FI", "central bank", "market regulator", "ADGM", "AIFC"],
  },
  {
    id: "sector-target-setting-pressure",
    section: "Global Drivers",
    type: "Sector-related",
    logic: "Show target-setting pressure from sector pathways or science-based frameworks.",
    preciseQuestion:
      "Which sector target-setting framework or pathway raises expectations for companies in this sector?",
    evidenceTarget:
      "Science-based target framework, sector pathway, transition target, or recognized sector guidance.",
    sourcePriorities: ["SBTi", "IEA", "sector bodies", "UNEP FI"],
  },
  {
    id: "market-disclosure-rule",
    section: "Regulatory Requirements",
    type: "Country-related",
    logic: "Show a local market, exchange, or financial-centre disclosure rule.",
    preciseQuestion:
      "Which local market, exchange, financial-centre, or regulator disclosure expectation affects ESG reporting in this country?",
    evidenceTarget:
      "Disclosure guide, market rule, sustainable finance framework, listing guidance, or regulator program.",
    sourcePriorities: ["stock exchange", "market regulator", "financial centre", "DFSA", "ADGM", "AIFC"],
  },
  {
    id: "country-taxonomy-framework",
    section: "Regulatory Requirements",
    type: "Country-related",
    logic: "Show a country taxonomy, sustainable finance framework, or classification initiative.",
    preciseQuestion:
      "Which country taxonomy or sustainable finance framework shapes what counts as sustainable activity?",
    evidenceTarget:
      "Taxonomy, sustainable finance framework, green finance program, or regulator classification guidance.",
    sourcePriorities: ["central bank", "market regulator", "government", "financial centre"],
  },
  {
    id: "financial-supervisor-climate-risk",
    section: "Climate Risks",
    type: "Sector-related",
    logic: "Show financial supervisor or sector body expectations for climate-risk management.",
    preciseQuestion:
      "Which supervisor or sector body guidance makes climate-risk governance material for this sector?",
    evidenceTarget:
      "Climate-risk principle, supervisory expectation, governance guidance, or stress-testing signal.",
    sourcePriorities: ["FSB", "NGFS", "Basel Committee", "central bank", "sector regulator"],
  },
  {
    id: "country-adaptation-resilience",
    section: "Climate Risks",
    type: "Country-related",
    logic: "Show country adaptation, resilience, or physical-risk policy direction.",
    preciseQuestion:
      "Which country climate resilience or adaptation signal matters for this sector's risk exposure?",
    evidenceTarget:
      "Adaptation plan, physical-risk profile, resilience strategy, or dated climate-risk country profile.",
    sourcePriorities: ["World Bank", "national government", "climate ministry", "ADB"],
  },
  {
    id: "sustainable-capital-access",
    section: "Capital Markets",
    type: "Country-related",
    logic: "Show how sustainable finance affects access to capital in this country.",
    preciseQuestion:
      "Which sustainable finance program or capital-market framework affects access to funding in this country?",
    evidenceTarget:
      "Sustainable finance program, DFI framework, financial-centre initiative, or green finance market signal.",
    sourcePriorities: ["World Bank", "IFC", "central bank", "financial centre", "DFI"],
  },
  {
    id: "climate-risk-capital-expectations",
    section: "Capital Markets",
    type: "Sector-related",
    logic: "Show investor or lender expectations around climate-risk governance.",
    preciseQuestion:
      "Which investor, lender, or supervisor expectation affects climate-risk governance for this sector?",
    evidenceTarget:
      "Investor expectation, lender framework, supervisor principle, or climate-risk disclosure framework.",
    sourcePriorities: ["FSB", "NGFS", "UNEP FI", "Basel Committee", "stock exchanges"],
  },
  {
    id: "scope-3-accounting-expectation",
    section: "Supply Chain",
    type: "Sector-related",
    logic: "Show Scope 3 or financed-emissions accounting expectations for the sector.",
    preciseQuestion:
      "Which Scope 3, financed-emissions, or value-chain accounting standard makes ESG measurement material for this sector?",
    evidenceTarget:
      "Scope 3 guidance, financed-emissions standard, value-chain accounting method, or reporting expectation.",
    sourcePriorities: ["GHG Protocol", "PCAF", "UNEP FI", "sector bodies"],
  },
  {
    id: "supplier-disclosure-pressure",
    section: "Supply Chain",
    type: "General",
    logic: "Show supplier disclosure or value-chain engagement pressure.",
    preciseQuestion:
      "Which supplier disclosure or value-chain engagement framework raises supply-chain ESG expectations?",
    evidenceTarget:
      "Supplier disclosure framework, supply-chain engagement program, Scope 3 requirement, or procurement standard.",
    sourcePriorities: ["CDP", "GHG Protocol", "WRI", "sector bodies"],
  },
];

const DEFAULT_LOGIC_IDS = [
  "global-climate-commitments",
  "sector-emissions-footprint",
  "sector-transition-initiative",
  "global-disclosure-standards",
  "country-climate-policy",
  "country-sector-regulation",
  "global-climate-macro-risk",
  "country-sector-climate-risk",
  "investor-lender-expectations",
  "development-finance-pressure",
  "supply-chain-climate-exposure",
  "sector-supply-chain-solution",
];

export function selectLegacyDriverLogics(input: GenerateEsgDriversInput): EsgDriverLogic[] {
  const byId = new Map(DRIVER_LOGIC_LIBRARY.map((logic) => [logic.id, logic]));
  return DEFAULT_LOGIC_IDS.map((id) => byId.get(id)).filter(
    (logic): logic is EsgDriverLogic => Boolean(logic),
  );
}

/** @deprecated Prefer buildDriverSelectionPlan(). Retained for rollback compatibility. */
export function selectDriverLogics(input: GenerateEsgDriversInput): EsgDriverLogic[] {
  return selectLegacyDriverLogics(input);
}

export function getReplacementDriverLogics(
  logic: EsgDriverLogic,
  usedLogicIds: Set<string>,
): EsgDriverLogic[] {
  return DRIVER_LOGIC_LIBRARY.filter((candidate) => {
    if (candidate.id === logic.id) return true;
    if (usedLogicIds.has(candidate.id)) return false;
    if (DEFAULT_LOGIC_IDS.includes(candidate.id)) return false;
    return candidate.section === logic.section;
  }).sort((left, right) => {
    if (left.id === logic.id) return -1;
    if (right.id === logic.id) return 1;
    if (left.type === logic.type && right.type !== logic.type) return -1;
    if (right.type === logic.type && left.type !== logic.type) return 1;
    return 0;
  });
}

export function buildLogicSearchQueries(
  input: GenerateEsgDriversInput,
  logics: EsgDriverLogic[] = selectDriverLogics(input),
): string[] {
  const country = input.country.trim();
  const sector = input.sector.trim();
  const year = String(new Date().getFullYear());
  const sectorGroup = getSectorGroup(sector);

  return uniqueStrings(
    logics.map((logic) =>
      interpolateQuery(
        getLogicSearchTemplate(logic.id, sectorGroup),
        country,
        sector,
        year,
      ),
    ),
  );
}

export function formatDriverLogicPlan(logics: EsgDriverLogic[]): string {
  return logics
    .map((logic, index) =>
      [
        `${index + 1}. ${logic.id}`,
        `Section: ${logic.section}`,
        `Type: ${logic.type}`,
        `Logic: ${logic.logic}`,
        `Question to answer: ${logic.preciseQuestion}`,
        `Evidence target: ${logic.evidenceTarget}`,
        `Preferred sources: ${logic.sourcePriorities.join(", ")}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function getSectorSpecificGuidance(sector: string): string[] {
  const sectorGroup = getSectorGroup(sector);

  if (sectorGroup === "banking") {
    return [
      "For banking, prioritize financed emissions, climate-risk governance, sustainable finance, green taxonomy, disclosure, client transition risk, investor/lender pressure, and UNEP FI/NZBA/PCAF/FSB/NGFS style sources.",
      "For banking supply-chain drivers, focus on financed supply chains, client Scope 3 exposure, sustainable supply-chain finance, or bank procurement only when evidence supports it.",
      "Avoid generic banking ESG trends unless they are tied to a specific regulation, framework, metric, or capital-market expectation.",
    ];
  }

  if (sectorGroup === "construction" || sectorGroup === "real-estate") {
    return [
      "For construction and real estate, prioritize buildings emissions, embodied carbon, energy efficiency, green building standards, cement/materials transition, physical climate resilience, and tenant/investor expectations.",
      "Use sector metrics such as building emissions share, energy intensity, green certification premium, embodied-carbon regulation, or climate exposure of assets where evidence supports them.",
    ];
  }

  if (sectorGroup === "oil-gas") {
    return [
      "For oil and gas, prioritize methane, flaring, Scope 1/2/3 emissions, transition risk, carbon pricing, clean-energy investment pressure, and disclosure or taxonomy rules.",
      "Separate operational emissions from product-use emissions when evidence allows.",
    ];
  }

  return [
    "Prioritize sector-specific emissions, transition pathways, disclosure rules, investor expectations, physical risks, and supply-chain levers over generic sustainability claims.",
  ];
}

function getLogicSearchTemplate(logicId: string, sectorGroup: string): string {
  if (sectorGroup === "banking") {
    const bankingTemplates: Record<string, string> = {
      "sector-emissions-footprint":
        "{sector} financed emissions PCAF banks global CO2 UNEP FI",
      "sector-transition-initiative":
        "UNEP FI Principles for Responsible Banking NZBA {sector} 2030 targets",
      "country-sector-regulation":
        "{country} central bank {sector} climate risk disclosure sustainable finance regulation {year}",
      "investor-lender-expectations":
        "{sector} investor expectations financed emissions FSB NGFS climate disclosure",
      "sector-supply-chain-solution":
        "{country} {sector} sustainable supply chain finance client Scope 3 ESG",
      "sustainable-finance-market":
        "{country} {sector} CBUAE DFSA ADGM UNEP FI sustainable finance framework",
      "sector-target-setting-pressure":
        "{sector} UNEP FI net-zero banking target setting SBTi financial institutions",
    };
    if (bankingTemplates[logicId]) return bankingTemplates[logicId];
  }

  const templates: Record<string, string> = {
    "global-climate-commitments":
      "global net zero countries climate finance COP UNFCCC {year}",
    "sector-emissions-footprint":
      "{sector} global greenhouse gas emissions share IEA sector report",
    "sector-transition-initiative":
      "{sector} decarbonization pathway 2030 2050 initiative IEA sector guidance",
    "global-disclosure-standards":
      "ISSB IFRS S1 S2 adoption countries sustainability disclosure {year}",
    "country-climate-policy":
      "{country} NDC climate strategy net zero climate law 2030",
    "country-sector-regulation":
      "{country} {sector} ESG regulation disclosure climate risk regulator {year}",
    "global-climate-macro-risk":
      "global GDP at risk climate change 2050 financial stability report",
    "country-sector-climate-risk":
      "{country} {sector} climate physical transition risk World Bank ADB FSB",
    "investor-lender-expectations":
      "{sector} ESG investor lender expectations disclosure decarbonization FSB NGFS",
    "development-finance-pressure":
      "{country} World Bank EBRD ADB IFC active portfolio ESG requirements",
    "supply-chain-climate-exposure":
      "CDP supply chain climate risk losses Scope 3 emissions global",
    "sector-supply-chain-solution":
      "{sector} supply chain decarbonization Scope 3 procurement low carbon solution",
    "sustainable-finance-market":
      "{country} {sector} sustainable finance framework market program regulator",
    "sector-target-setting-pressure":
      "{sector} science based targets sector pathway transition framework",
    "market-disclosure-rule":
      "{country} market regulator exchange ESG disclosure sustainable finance guidance",
    "country-taxonomy-framework":
      "{country} sustainable finance taxonomy green finance framework regulator",
    "financial-supervisor-climate-risk":
      "{sector} climate risk governance supervisor principles FSB NGFS Basel",
    "country-adaptation-resilience":
      "{country} climate adaptation resilience physical risk profile World Bank",
    "sustainable-capital-access":
      "{country} sustainable finance capital market green finance framework DFI",
    "climate-risk-capital-expectations":
      "{sector} lender investor climate risk governance expectations FSB NGFS",
    "scope-3-accounting-expectation":
      "{sector} Scope 3 accounting financed emissions GHG Protocol PCAF",
    "supplier-disclosure-pressure":
      "CDP supplier disclosure supply chain Scope 3 engagement framework",
  };

  return templates[logicId] || "{country} {sector} ESG sustainability climate";
}

function getSectorGroup(sector: string): string {
  const normalized = sector.toLowerCase();
  if (/\bbank|financial|finance|insurance|lending|credit\b/.test(normalized)) {
    return "banking";
  }
  if (/construction|cement|building materials|contractor/.test(normalized)) {
    return "construction";
  }
  if (/real estate|property|buildings?|reit/.test(normalized)) {
    return "real-estate";
  }
  if (/oil|gas|petroleum|lng|upstream|downstream|energy/.test(normalized)) {
    return "oil-gas";
  }
  return "general";
}

function interpolateQuery(
  template: string,
  country: string,
  sector: string,
  year: string,
): string {
  return template
    .replaceAll("{country}", country)
    .replaceAll("{sector}", sector)
    .replaceAll("{year}", year);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
