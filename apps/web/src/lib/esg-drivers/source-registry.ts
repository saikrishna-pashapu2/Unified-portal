import type { EsgDriverLogic } from "./logic";
import type {
  EsgDriverSection,
  EsgDriverSource,
  GenerateEsgDriversInput,
  RejectedEsgDriverSource,
} from "./types";

type SourceUsage = "direct" | "context";
type UrlPatternType = "exact" | "prefix" | "contains" | "host";
type CountryScope = "Global" | "UAE" | "Saudi Arabia" | "Kazakhstan";
type SectorScope = "All" | "banking" | "construction" | "real-estate" | "oil-gas" | "general";

export interface ApprovedSourceUrlPattern {
  type: UrlPatternType;
  value: string;
}

export interface ApprovedDriverSource {
  id: string;
  label: string;
  urlPatterns: ApprovedSourceUrlPattern[];
  fallbackUrl: string;
  fallbackTitle: string;
  fallbackSnippet: string;
  countries: CountryScope[];
  sectors: SectorScope[];
  driverLogicIds?: string[];
  driverSections?: EsgDriverSection[];
  claimTypes: string[];
  usage: SourceUsage;
  /** Conservative minimum for a curated first-party authority whose domain
   * alone (for example, adgm.com) does not reveal its regulatory status. */
  authorityScoreFloor?: number;
  useAsFallback?: boolean;
  requiresCountryEvidence?: boolean;
  requiresSectorEvidence?: boolean;
  notes?: string;
  /** Present only on an exact catalog URL that was derived from an existing,
   * reviewed direct-publisher record. It never widens the global registry. */
  reviewedPublisherSourceId?: string;
  /** Original catalog URL; retained when a same-publisher replacement is used. */
  catalogSeedUrl?: string;
  catalogExactUrl?: string;
  catalogPageReferences?: string[];
  catalogDocumentVersion?: string | null;
  catalogIsReplacement?: boolean;
}

export interface CatalogSeedSourceInput {
  url: string;
  title?: string;
  publisher?: string;
  domain?: string;
  /** Reviewed registry records bound by the generated catalog. */
  registryApprovalIds?: string[];
  pageReferences?: string[];
  documentVersion?: string | null;
}

export interface SourceApprovalResult {
  approved: boolean;
  source?: EsgDriverSource;
  rejected?: RejectedEsgDriverSource;
  record?: ApprovedDriverSource;
}

export interface ApprovedSourcePreflightResult {
  approved: boolean;
  record?: ApprovedDriverSource;
  reason?: "not-approved" | "country-mismatch" | "sector-mismatch" | "logic-mismatch";
}

export const APPROVED_DRIVER_SOURCES: ApprovedDriverSource[] = [
  {
    id: "unfccc-paris-agreement",
    label: "UNFCCC - The Paris Agreement",
    urlPatterns: [
      {
        type: "exact",
        value: "https://unfccc.int/process-and-meetings/the-paris-agreement",
      },
      {
        type: "exact",
        value: "https://unfccc.int/news/the-explainer-the-paris-agreement",
      },
    ],
    fallbackUrl: "https://unfccc.int/news/the-explainer-the-paris-agreement",
    fallbackTitle: "UNFCCC - The Explainer: The Paris Agreement",
    fallbackSnippet:
      "Official UNFCCC source for the Paris Agreement and NDC framework. Approved for global climate-commitment context only.",
    countries: ["Global"],
    sectors: ["All"],
    driverLogicIds: ["global-climate-commitments"],
    claimTypes: ["global climate commitment", "paris agreement", "ndc baseline"],
    usage: "direct",
    // This exact UNFCCC scope remains approved when discovered through search,
    // but its bot-interstitial response is not stable enough to spend a
    // proactive fallback hydration slot. The two official UN mirrors below are
    // the live-fetch-safe defaults for this logic.
    useAsFallback: false,
  },
  {
    id: "un-paris-agreement",
    label: "United Nations - The Paris Agreement",
    urlPatterns: [
      {
        type: "exact",
        value: "https://www.un.org/en/climatechange/paris-agreement",
      },
    ],
    fallbackUrl: "https://www.un.org/en/climatechange/paris-agreement",
    fallbackTitle: "United Nations - The Paris Agreement",
    fallbackSnippet:
      "Official United Nations source for the Paris Agreement, its global emissions commitments, NDC cycle, adaptation, and climate-finance framework.",
    countries: ["Global"],
    sectors: ["All"],
    driverLogicIds: ["global-climate-commitments"],
    claimTypes: ["global climate commitment", "paris agreement", "ndc cycle"],
    usage: "direct",
  },
  {
    id: "un-climate-key-findings",
    label: "United Nations - Climate Key Findings",
    urlPatterns: [
      {
        type: "exact",
        value: "https://www.un.org/en/climatechange/science/key-findings",
      },
    ],
    fallbackUrl: "https://www.un.org/en/climatechange/science/key-findings",
    fallbackTitle: "United Nations - Climate Key Findings",
    fallbackSnippet:
      "Official United Nations climate-science summary connecting global agreements, 2030 emissions reductions, net-zero commitments, adaptation, and climate finance.",
    countries: ["Global"],
    sectors: ["All"],
    driverLogicIds: ["global-climate-commitments"],
    claimTypes: ["global climate commitment", "2030 emissions", "net zero"],
    usage: "direct",
  },
  {
    id: "unfccc-ndc-registry",
    label: "UNFCCC - Nationally Determined Contributions Registry",
    urlPatterns: [{ type: "exact", value: "https://unfccc.int/NDCREG" }],
    fallbackUrl: "https://unfccc.int/NDCREG",
    fallbackTitle: "UNFCCC - Nationally Determined Contributions Registry",
    fallbackSnippet:
      "Official UNFCCC registry for country NDC submissions. Approved as country climate-policy evidence when paired with selected-country evidence.",
    countries: ["Global"],
    sectors: ["All"],
    driverLogicIds: ["country-climate-policy"],
    claimTypes: ["ndc", "country climate policy"],
    usage: "context",
    requiresCountryEvidence: true,
  },
  {
    id: "world-bank-climate-topic",
    label: "World Bank - Climate Change",
    authorityScoreFloor: 90,
    urlPatterns: [
      { type: "exact", value: "https://www.worldbank.org/en/topic/climatechange" },
      { type: "exact", value: "https://www.worldbank.org/ext/en/topic/climate-change" },
    ],
    fallbackUrl: "https://www.worldbank.org/ext/en/topic/climate-change",
    fallbackTitle: "World Bank - Climate Change",
    fallbackSnippet:
      "World Bank climate source for macroeconomic climate risk and policy context.",
    countries: ["Global"],
    sectors: ["All"],
    driverLogicIds: ["global-climate-macro-risk"],
    claimTypes: ["macro climate risk", "development finance"],
    usage: "direct",
  },
  {
    id: "world-bank-climate-portal-country",
    label: "World Bank Climate Change Knowledge Portal",
    urlPatterns: [
      {
        type: "prefix",
        value: "https://climateknowledgeportal.worldbank.org/country/",
      },
    ],
    fallbackUrl: "https://climateknowledgeportal.worldbank.org/country/{countrySlug}",
    fallbackTitle: "World Bank Climate Change Knowledge Portal",
    fallbackSnippet:
      "World Bank country climate profile source for physical risk and country climate exposure.",
    countries: ["Global"],
    sectors: ["All"],
    driverLogicIds: ["country-sector-climate-risk", "country-climate-policy"],
    claimTypes: ["physical climate risk", "country climate profile"],
    usage: "direct",
    requiresCountryEvidence: true,
  },
  {
    id: "ifrs-sustainability-standards",
    label: "IFRS Foundation - IFRS Sustainability Standards",
    urlPatterns: [
      {
        type: "exact",
        value: "https://www.ifrs.org/issued-standards/ifrs-sustainability-standards-navigator/",
      },
    ],
    fallbackUrl:
      "https://www.ifrs.org/issued-standards/ifrs-sustainability-standards-navigator/",
    fallbackTitle: "IFRS Foundation - IFRS Sustainability Standards",
    fallbackSnippet:
      "IFRS Foundation source for IFRS S1 and IFRS S2 sustainability disclosure standards.",
    countries: ["Global"],
    sectors: ["All"],
    driverLogicIds: ["global-disclosure-standards"],
    claimTypes: ["disclosure standards", "issb", "ifrs s1", "ifrs s2"],
    usage: "direct",
  },
  {
    id: "iosco-sustainable-finance",
    label: "IOSCO - Sustainable Finance",
    authorityScoreFloor: 90,
    urlPatterns: [
      { type: "exact", value: "https://www.iosco.org/about/?subsection=sustainable_finance" },
    ],
    fallbackUrl: "https://www.iosco.org/about/?subsection=sustainable_finance",
    fallbackTitle: "IOSCO - Sustainable Finance",
    fallbackSnippet:
      "IOSCO source for securities-regulator sustainable finance and disclosure work.",
    countries: ["Global"],
    sectors: ["All"],
    driverLogicIds: ["global-disclosure-standards", "investor-lender-expectations"],
    claimTypes: ["disclosure supervision", "capital markets"],
    usage: "direct",
  },
  {
    id: "fsb-climate-related-financial-risks",
    label: "Financial Stability Board - Climate-related Financial Risks",
    authorityScoreFloor: 90,
    urlPatterns: [
      {
        type: "exact",
        value:
          "https://www.fsb.org/work-of-the-fsb/financial-innovation-and-structural-change/climate-related-risks/",
      },
    ],
    fallbackUrl:
      "https://www.fsb.org/work-of-the-fsb/financial-innovation-and-structural-change/climate-related-risks/",
    fallbackTitle: "FSB - Climate-related financial risks",
    fallbackSnippet:
      "Financial Stability Board source for climate-related financial risk and supervisory expectations.",
    countries: ["Global"],
    sectors: ["All", "banking"],
    driverLogicIds: [
      "global-climate-macro-risk",
      "investor-lender-expectations",
      "financial-supervisor-climate-risk",
      "climate-risk-capital-expectations",
    ],
    claimTypes: ["financial stability", "climate risk governance"],
    usage: "direct",
  },
  {
    id: "ngfs-home",
    label: "Network for Greening the Financial System",
    authorityScoreFloor: 90,
    urlPatterns: [{ type: "exact", value: "https://www.ngfs.net/en" }],
    fallbackUrl: "https://www.ngfs.net/en",
    fallbackTitle: "NGFS - Network for Greening the Financial System",
    fallbackSnippet:
      "NGFS source for central-bank and supervisor climate-risk work.",
    countries: ["Global"],
    sectors: ["All", "banking"],
    driverLogicIds: [
      "global-climate-macro-risk",
      "investor-lender-expectations",
      "financial-supervisor-climate-risk",
      "climate-risk-capital-expectations",
    ],
    claimTypes: ["climate risk supervision", "central banks"],
    usage: "direct",
  },
  {
    id: "ghg-protocol-scope-3",
    label: "GHG Protocol - Scope 3 Calculation Guidance",
    urlPatterns: [
      { type: "exact", value: "https://ghgprotocol.org/scope-3-calculation-guidance-2" },
    ],
    fallbackUrl: "https://ghgprotocol.org/scope-3-calculation-guidance-2",
    fallbackTitle: "GHG Protocol - Scope 3 Guidance",
    fallbackSnippet:
      "GHG Protocol source for Scope 3 and value-chain emissions accounting.",
    countries: ["Global"],
    sectors: ["All"],
    driverLogicIds: [
      "supply-chain-climate-exposure",
      "sector-supply-chain-solution",
      "scope-3-accounting-expectation",
    ],
    claimTypes: ["scope 3", "value-chain emissions"],
    usage: "direct",
  },
  {
    id: "cdp-supply-chain",
    label: "CDP - Supply Chain",
    urlPatterns: [{ type: "exact", value: "https://www.cdp.net/en/supply-chain" }],
    fallbackUrl: "https://www.cdp.net/en/supply-chain",
    fallbackTitle: "CDP - Supply Chain",
    fallbackSnippet:
      "CDP source for supplier climate disclosure and supply-chain engagement.",
    countries: ["Global"],
    sectors: ["All"],
    driverLogicIds: ["supply-chain-climate-exposure", "supplier-disclosure-pressure"],
    claimTypes: ["supplier disclosure", "supply-chain engagement"],
    usage: "direct",
  },
  {
    id: "uae-net-zero-2050",
    label: "UAE Government - Net Zero 2050",
    authorityScoreFloor: 90,
    urlPatterns: [
      {
        type: "exact",
        value:
          "https://u.ae/en/about-the-uae/strategies-initiatives-and-awards/strategies-plans-and-visions/environment-and-energy/the-uae-net-zero-2050-strategy",
      },
    ],
    fallbackUrl:
      "https://u.ae/en/about-the-uae/strategies-initiatives-and-awards/strategies-plans-and-visions/environment-and-energy/the-uae-net-zero-2050-strategy",
    fallbackTitle: "UAE Government - Net Zero 2050",
    fallbackSnippet:
      "Official UAE Government source for the UAE Net Zero 2050 strategic initiative.",
    countries: ["UAE"],
    sectors: ["All"],
    driverLogicIds: ["country-climate-policy"],
    claimTypes: ["net zero", "country climate policy"],
    usage: "direct",
    requiresCountryEvidence: true,
  },
  {
    id: "uae-national-climate-adaptation-plan",
    label: "UAE Government - National Climate Adaptation Action Plan",
    authorityScoreFloor: 90,
    urlPatterns: [
      {
        type: "exact",
        value:
          "https://u.ae/en/about-the-uae/strategies-initiatives-and-awards/strategies-plans-and-visions/environment-and-energy/national-climate-adaptation-action-plan",
      },
    ],
    fallbackUrl:
      "https://u.ae/en/about-the-uae/strategies-initiatives-and-awards/strategies-plans-and-visions/environment-and-energy/national-climate-adaptation-action-plan",
    fallbackTitle: "UAE Government - National Climate Adaptation Action Plan",
    fallbackSnippet:
      "Official UAE Government plan for assessing climate impacts, prioritising urgent adaptation needs, and embedding resilience across sectors.",
    countries: ["UAE"],
    sectors: ["All"],
    driverLogicIds: ["country-adaptation-resilience"],
    claimTypes: ["climate adaptation", "physical climate risk", "resilience"],
    usage: "direct",
    requiresCountryEvidence: true,
  },
  {
    id: "uae-national-climate-change-plan",
    label: "UAE Government - National Climate Change Plan 2017-2050",
    authorityScoreFloor: 90,
    urlPatterns: [
      {
        type: "exact",
        value:
          "https://u.ae/en/about-the-uae/strategies-initiatives-and-awards/strategies-plans-and-visions/environment-and-energy/national-climate-change-plan-of-the-uae",
      },
    ],
    fallbackUrl:
      "https://u.ae/en/about-the-uae/strategies-initiatives-and-awards/strategies-plans-and-visions/environment-and-energy/national-climate-change-plan-of-the-uae",
    fallbackTitle: "UAE Government - National Climate Change Plan 2017-2050",
    fallbackSnippet:
      "Official UAE Government framework for managing emissions, minimising climate risks, and improving national adaptation capacity.",
    countries: ["UAE"],
    sectors: ["All"],
    driverLogicIds: ["country-climate-policy", "country-adaptation-resilience"],
    claimTypes: ["country climate policy", "climate adaptation", "resilience"],
    usage: "direct",
    requiresCountryEvidence: true,
  },
  {
    id: "cbuae-sustainable-finance",
    label: "Central Bank of the UAE - Sustainable Finance",
    urlPatterns: [
      {
        type: "exact",
        value: "https://www.centralbank.ae/en/our-operations/sustainable-finance/",
      },
    ],
    fallbackUrl: "https://www.centralbank.ae/en/our-operations/sustainable-finance/",
    fallbackTitle: "Central Bank of the UAE - Sustainable Finance",
    fallbackSnippet:
      "Central Bank of the UAE source for sustainable finance and banking-sector supervisory context.",
    countries: ["UAE"],
    sectors: ["banking"],
    driverLogicIds: [
      "country-sector-regulation",
      "investor-lender-expectations",
      "development-finance-pressure",
      "financial-supervisor-climate-risk",
      "sustainable-finance-market",
      "country-taxonomy-framework",
      "sustainable-capital-access",
    ],
    claimTypes: ["sustainable finance", "banking supervision", "climate risk governance"],
    usage: "direct",
    requiresCountryEvidence: true,
    requiresSectorEvidence: true,
  },
  {
    id: "dfsa-sustainable-finance",
    label: "Dubai Financial Services Authority - Sustainable Finance",
    authorityScoreFloor: 90,
    urlPatterns: [
      {
        type: "exact",
        value: "https://www.dfsa.ae/what-we-do/sustainable-finance",
      },
      {
        type: "exact",
        value:
          "https://www.dfsa.ae/what-we-do/sustainable-finance/about-sustainable-finance",
      },
    ],
    fallbackUrl:
      "https://www.dfsa.ae/what-we-do/sustainable-finance/about-sustainable-finance",
    fallbackTitle: "DFSA - Sustainable Finance",
    fallbackSnippet:
      "Dubai Financial Services Authority source for sustainable finance and disclosure context.",
    countries: ["UAE"],
    sectors: ["All", "banking"],
    driverLogicIds: [
      "country-sector-regulation",
      "global-disclosure-standards",
      "market-disclosure-rule",
      "sustainable-finance-market",
      "country-taxonomy-framework",
      "sustainable-capital-access",
    ],
    claimTypes: ["sustainable finance", "disclosure"],
    usage: "direct",
    requiresCountryEvidence: true,
  },
  {
    id: "adgm-sustainable-finance",
    label: "Abu Dhabi Global Market - Sustainable Finance",
    authorityScoreFloor: 90,
    urlPatterns: [
      {
        type: "exact",
        value: "https://www.adgm.com/initiatives/sustainable-finance",
      },
    ],
    fallbackUrl: "https://www.adgm.com/initiatives/sustainable-finance",
    fallbackTitle: "ADGM - Sustainable Finance",
    fallbackSnippet:
      "Abu Dhabi Global Market source for sustainable finance market context.",
    countries: ["UAE"],
    sectors: ["All", "banking"],
    driverLogicIds: [
      "country-sector-regulation",
      "global-disclosure-standards",
      "market-disclosure-rule",
      "sustainable-finance-market",
      "country-taxonomy-framework",
      "sustainable-capital-access",
    ],
    claimTypes: ["sustainable finance", "market disclosure"],
    usage: "direct",
    requiresCountryEvidence: true,
  },
  {
    id: "unep-fi-principles-responsible-banking",
    label: "UNEP FI - Principles for Responsible Banking",
    urlPatterns: [{ type: "exact", value: "https://www.unepfi.org/banking/bankingprinciples/" }],
    fallbackUrl: "https://www.unepfi.org/banking/bankingprinciples/",
    fallbackTitle: "UNEP FI - Principles for Responsible Banking",
    fallbackSnippet:
      "UNEP FI source for responsible banking expectations and bank ESG strategy.",
    countries: ["Global"],
    sectors: ["banking"],
    driverLogicIds: [
      "sector-transition-initiative",
      "investor-lender-expectations",
      "sector-supply-chain-solution",
      "sustainable-finance-market",
      "sector-target-setting-pressure",
    ],
    claimTypes: ["responsible banking", "bank transition"],
    usage: "direct",
    requiresSectorEvidence: true,
  },
  {
    id: "unep-fi-net-zero-banking",
    label: "UNEP FI - Net-Zero Banking Alliance",
    urlPatterns: [{ type: "exact", value: "https://www.unepfi.org/net-zero-banking/" }],
    fallbackUrl: "https://www.unepfi.org/net-zero-banking/",
    fallbackTitle: "UNEP FI - Net-Zero Banking Alliance",
    fallbackSnippet:
      "UNEP FI source for bank net-zero and financed-emissions expectations.",
    countries: ["Global"],
    sectors: ["banking"],
    driverLogicIds: [
      "sector-transition-initiative",
      "investor-lender-expectations",
      "sector-supply-chain-solution",
      "sustainable-finance-market",
      "sector-target-setting-pressure",
    ],
    claimTypes: ["net-zero banking", "financed emissions"],
    usage: "direct",
    requiresSectorEvidence: true,
  },
  {
    id: "pcaf-standard",
    label: "PCAF - Global GHG Accounting and Reporting Standard",
    urlPatterns: [{ type: "exact", value: "https://carbonaccountingfinancials.com/standard" }],
    fallbackUrl: "https://carbonaccountingfinancials.com/standard",
    fallbackTitle: "PCAF - Global GHG Accounting and Reporting Standard",
    fallbackSnippet:
      "PCAF source for financed-emissions accounting in banking and financial institutions.",
    countries: ["Global"],
    sectors: ["banking"],
    driverLogicIds: [
      "sector-emissions-footprint",
      "sector-supply-chain-solution",
      "scope-3-accounting-expectation",
    ],
    claimTypes: ["financed emissions", "accounting standard"],
    usage: "direct",
    requiresSectorEvidence: true,
  },
  {
    id: "basel-climate-financial-risks",
    label: "Basel Committee - Climate-related Financial Risks",
    authorityScoreFloor: 90,
    urlPatterns: [{ type: "exact", value: "https://www.bis.org/bcbs/publ/d532.htm" }],
    fallbackUrl: "https://www.bis.org/bcbs/publ/d532.htm",
    fallbackTitle: "Basel Committee - Climate-related financial risks",
    fallbackSnippet:
      "Basel Committee source for climate-related financial risk principles for banks.",
    countries: ["Global"],
    sectors: ["banking"],
    driverLogicIds: [
      "country-sector-climate-risk",
      "financial-supervisor-climate-risk",
      "investor-lender-expectations",
    ],
    claimTypes: ["bank climate risk", "supervisory principles"],
    usage: "direct",
    requiresSectorEvidence: true,
  },
  {
    id: "saudi-green-initiative",
    label: "Saudi Green Initiative",
    urlPatterns: [{ type: "exact", value: "https://www.greeninitiatives.gov.sa/" }],
    fallbackUrl: "https://www.greeninitiatives.gov.sa/",
    fallbackTitle: "Saudi Green Initiative",
    fallbackSnippet:
      "Official Saudi Green Initiative source for Saudi climate and sustainability targets.",
    countries: ["Saudi Arabia"],
    sectors: ["All"],
    driverLogicIds: ["country-climate-policy", "country-adaptation-resilience"],
    claimTypes: ["country climate policy", "net zero"],
    usage: "direct",
    requiresCountryEvidence: true,
  },
  {
    id: "saudi-vision-2030",
    label: "Saudi Vision 2030",
    urlPatterns: [{ type: "exact", value: "https://www.vision2030.gov.sa/en/" }],
    fallbackUrl: "https://www.vision2030.gov.sa/en/",
    fallbackTitle: "Saudi Vision 2030",
    fallbackSnippet:
      "Official Saudi Vision 2030 source for national transformation and sustainability context.",
    countries: ["Saudi Arabia"],
    sectors: ["All"],
    driverLogicIds: ["country-climate-policy", "development-finance-pressure"],
    claimTypes: ["national strategy", "sustainability"],
    usage: "direct",
    requiresCountryEvidence: true,
  },
  {
    id: "sama-home",
    label: "Saudi Central Bank",
    urlPatterns: [{ type: "exact", value: "https://www.sama.gov.sa/en-US/Pages/default.aspx" }],
    fallbackUrl: "https://www.sama.gov.sa/en-US/Pages/default.aspx",
    fallbackTitle: "Saudi Central Bank",
    fallbackSnippet:
      "Saudi Central Bank source for banking and financial-sector supervisory context.",
    countries: ["Saudi Arabia"],
    sectors: ["banking"],
    driverLogicIds: ["country-sector-regulation", "financial-supervisor-climate-risk"],
    claimTypes: ["banking supervision", "financial regulation"],
    usage: "direct",
    requiresCountryEvidence: true,
    requiresSectorEvidence: true,
  },
  {
    id: "saudi-exchange-esg-guidelines",
    label: "Saudi Exchange - ESG Disclosure Guidelines",
    authorityScoreFloor: 85,
    urlPatterns: [
      {
        type: "exact",
        value:
          "https://www.saudiexchange.sa/wps/portal/saudiexchange/listing/issuer-guides/esg-guidelines",
      },
      {
        type: "exact",
        value:
          "https://www.saudiexchange.sa/wps/portal/saudiexchange/listing/issuer-guides/esg-guidelines?locale=en",
      },
    ],
    fallbackUrl:
      "https://www.saudiexchange.sa/wps/portal/saudiexchange/listing/issuer-guides/esg-guidelines?locale=en",
    fallbackTitle: "Saudi Exchange - ESG Disclosure Guidelines",
    fallbackSnippet:
      "Official Saudi Exchange ESG Disclosure Guidelines for listed issuers across the Saudi capital market.",
    countries: ["Saudi Arabia"],
    sectors: ["banking", "construction", "real-estate", "oil-gas"],
    driverLogicIds: [
      "country-sector-regulation",
      "market-disclosure-rule",
      "global-disclosure-standards",
    ],
    claimTypes: [
      "esg disclosure guidance",
      "listed issuer reporting",
      "capital-market disclosure",
    ],
    usage: "direct",
    requiresCountryEvidence: true,
    requiresSectorEvidence: true,
  },
  {
    id: "kazakhstan-ecology-ministry",
    label: "Kazakhstan Ministry of Ecology and Natural Resources",
    urlPatterns: [{ type: "exact", value: "https://www.gov.kz/memleket/entities/ecogeo?lang=en" }],
    fallbackUrl: "https://www.gov.kz/memleket/entities/ecogeo?lang=en",
    fallbackTitle: "Kazakhstan Ministry of Ecology and Natural Resources",
    fallbackSnippet:
      "Official Kazakhstan environment ministry source for climate and sustainability policy context.",
    countries: ["Kazakhstan"],
    sectors: ["All"],
    driverLogicIds: ["country-climate-policy", "country-adaptation-resilience"],
    claimTypes: ["country climate policy", "environment ministry"],
    usage: "direct",
    requiresCountryEvidence: true,
  },
  {
    id: "kazakhstan-carbon-neutrality-strategy",
    label: "Kazakhstan Carbon Neutrality Strategy",
    urlPatterns: [{ type: "exact", value: "https://adilet.zan.kz/eng/docs/U2300000121" }],
    fallbackUrl: "https://adilet.zan.kz/eng/docs/U2300000121",
    fallbackTitle: "Kazakhstan Carbon Neutrality Strategy",
    fallbackSnippet:
      "Official legal source for Kazakhstan carbon-neutrality strategy context.",
    countries: ["Kazakhstan"],
    sectors: ["All"],
    driverLogicIds: ["country-climate-policy", "country-sector-regulation"],
    claimTypes: ["carbon neutrality", "country climate strategy"],
    usage: "direct",
    requiresCountryEvidence: true,
  },
  {
    id: "aifc-home",
    label: "Astana International Financial Centre",
    authorityScoreFloor: 85,
    urlPatterns: [{ type: "exact", value: "https://aifc.kz/" }],
    fallbackUrl: "https://aifc.kz/",
    fallbackTitle: "Astana International Financial Centre",
    fallbackSnippet:
      "AIFC source for Kazakhstan sustainable finance and capital-market context.",
    countries: ["Kazakhstan"],
    sectors: ["All", "banking"],
    driverLogicIds: [
      "country-sector-regulation",
      "development-finance-pressure",
      "sustainable-finance-market",
      "market-disclosure-rule",
      "country-taxonomy-framework",
      "sustainable-capital-access",
    ],
    claimTypes: ["sustainable finance", "capital markets"],
    usage: "direct",
    requiresCountryEvidence: true,
  },
  {
    id: "iea-buildings",
    label: "IEA - Buildings",
    urlPatterns: [{ type: "exact", value: "https://www.iea.org/energy-system/buildings" }],
    fallbackUrl: "https://www.iea.org/energy-system/buildings",
    fallbackTitle: "IEA - Buildings",
    fallbackSnippet:
      "IEA source for buildings energy and emissions context.",
    countries: ["Global"],
    sectors: ["construction", "real-estate"],
    driverLogicIds: [
      "sector-emissions-footprint",
      "sector-transition-initiative",
      "sector-supply-chain-solution",
      "sector-target-setting-pressure",
    ],
    claimTypes: ["buildings emissions", "sector transition"],
    usage: "direct",
    requiresSectorEvidence: true,
  },
  {
    id: "globalabc-home",
    label: "Global Alliance for Buildings and Construction",
    authorityScoreFloor: 85,
    urlPatterns: [{ type: "exact", value: "https://globalabc.org/" }],
    fallbackUrl: "https://globalabc.org/",
    fallbackTitle: "GlobalABC - Global Alliance for Buildings and Construction",
    fallbackSnippet:
      "GlobalABC source for buildings and construction decarbonization context.",
    countries: ["Global"],
    sectors: ["construction", "real-estate"],
    driverLogicIds: [
      "sector-transition-initiative",
      "sector-supply-chain-solution",
      "sector-target-setting-pressure",
    ],
    claimTypes: ["construction decarbonization", "buildings transition"],
    usage: "direct",
    requiresSectorEvidence: true,
  },
  {
    id: "worldgbc-advancing-net-zero",
    label: "World Green Building Council - Advancing Net Zero",
    authorityScoreFloor: 85,
    urlPatterns: [{ type: "exact", value: "https://worldgbc.org/advancing-net-zero/" }],
    fallbackUrl: "https://worldgbc.org/advancing-net-zero/",
    fallbackTitle: "WorldGBC - Advancing Net Zero",
    fallbackSnippet:
      "WorldGBC source for green buildings and net-zero building expectations.",
    countries: ["Global"],
    sectors: ["construction", "real-estate"],
    driverLogicIds: [
      "sector-transition-initiative",
      "investor-lender-expectations",
      "sector-target-setting-pressure",
    ],
    claimTypes: ["green buildings", "net-zero buildings"],
    usage: "direct",
    requiresSectorEvidence: true,
  },
  {
    id: "iea-oil-gas-net-zero-transitions",
    label: "IEA - Oil and Gas Industry in Net Zero Transitions",
    urlPatterns: [
      {
        type: "exact",
        value: "https://www.iea.org/reports/the-oil-and-gas-industry-in-net-zero-transitions",
      },
    ],
    fallbackUrl: "https://www.iea.org/reports/the-oil-and-gas-industry-in-net-zero-transitions",
    fallbackTitle: "IEA - Oil and gas industry in net zero transitions",
    fallbackSnippet:
      "IEA source for oil and gas transition risks and decarbonization pathways.",
    countries: ["Global"],
    sectors: ["oil-gas"],
    driverLogicIds: [
      "sector-emissions-footprint",
      "sector-transition-initiative",
      "sector-supply-chain-solution",
      "sector-target-setting-pressure",
    ],
    claimTypes: ["oil and gas transition", "sector emissions"],
    usage: "direct",
    requiresSectorEvidence: true,
  },
  {
    id: "iea-global-methane-tracker",
    label: "IEA - Global Methane Tracker",
    urlPatterns: [{ type: "exact", value: "https://www.iea.org/reports/global-methane-tracker-2024" }],
    fallbackUrl: "https://www.iea.org/reports/global-methane-tracker-2024",
    fallbackTitle: "IEA - Global Methane Tracker",
    fallbackSnippet:
      "IEA source for methane emissions and oil and gas climate performance context.",
    countries: ["Global"],
    sectors: ["oil-gas"],
    driverLogicIds: [
      "sector-emissions-footprint",
      "sector-transition-initiative",
      "sector-supply-chain-solution",
      "sector-target-setting-pressure",
    ],
    claimTypes: ["methane", "oil and gas emissions"],
    usage: "direct",
    requiresSectorEvidence: true,
  },
  {
    id: "ogmp",
    label: "Oil and Gas Methane Partnership 2.0",
    urlPatterns: [{ type: "exact", value: "https://www.ogmpartnership.com/" }],
    fallbackUrl: "https://www.ogmpartnership.com/",
    fallbackTitle: "OGMP 2.0",
    fallbackSnippet:
      "Oil and Gas Methane Partnership source for methane reporting and mitigation expectations.",
    countries: ["Global"],
    sectors: ["oil-gas"],
    driverLogicIds: [
      "sector-transition-initiative",
      "sector-supply-chain-solution",
      "sector-target-setting-pressure",
    ],
    claimTypes: ["methane reporting", "oil and gas"],
    usage: "direct",
    requiresSectorEvidence: true,
  },
  {
    id: "sbti-sectors",
    label: "Science Based Targets initiative - Sectors",
    urlPatterns: [
      { type: "exact", value: "https://sciencebasedtargets.org/sectors" },
      {
        type: "exact",
        value: "https://sciencebasedtargets.org/standards-and-guidance",
      },
    ],
    fallbackUrl: "https://sciencebasedtargets.org/standards-and-guidance",
    fallbackTitle: "Science Based Targets initiative - Standards and Guidance",
    fallbackSnippet:
      "SBTi sector source for science-based target-setting context.",
    countries: ["Global"],
    sectors: ["All"],
    driverLogicIds: [
      "sector-transition-initiative",
      "investor-lender-expectations",
      "sector-target-setting-pressure",
    ],
    claimTypes: ["science-based targets", "sector pathways"],
    usage: "direct",
    requiresSectorEvidence: true,
  },
];

export function normalizeUrlForApproval(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    parsed.hash = "";
    parsed.hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/^utm_/i.test(key)) parsed.searchParams.delete(key);
    }
    const normalized = parsed.toString().replace(/\/$/, "");
    // URL paths can be case-sensitive. Only the hostname is canonicalized.
    return normalized;
  } catch {
    return null;
  }
}

export function matchApprovedSource(url: string): ApprovedDriverSource | null {
  const normalizedUrl = normalizeUrlForApproval(url);
  if (!normalizedUrl) return null;

  for (const record of APPROVED_DRIVER_SOURCES) {
    if (record.urlPatterns.some((pattern) => matchesPattern(normalizedUrl, pattern))) {
      return record;
    }
  }

  return null;
}

/**
 * Builds a request-scoped, exact URL approval for a catalog seed. The seed is
 * accepted only when its HTTPS hostname already belongs to a reviewed direct
 * publisher that is in scope for the driver logic. The derived record is not
 * added to APPROVED_DRIVER_SOURCES, so workbook content can neither approve a
 * new publisher nor broaden future requests to the publisher's whole domain.
 */
export function resolveApprovedCatalogSeedSource(
  seed: CatalogSeedSourceInput,
  logic: EsgDriverLogic,
): ApprovedDriverSource | null {
  const normalizedUrl = normalizeUrlForApproval(seed.url);
  if (!normalizedUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;

  const hostname = normalizePublisherHostname(parsed.hostname);
  const declaredDomain = normalizePublisherHostname(seed.domain || "");
  if (declaredDomain && declaredDomain !== hostname) return null;

  const exactRecord = matchApprovedSource(normalizedUrl);
  if (exactRecord?.usage === "direct" && isLogicApproved(exactRecord, logic)) {
    return {
      ...exactRecord,
      reviewedPublisherSourceId: exactRecord.id,
      catalogSeedUrl: normalizedUrl,
      catalogExactUrl: normalizedUrl,
      catalogPageReferences: seed.pageReferences || [],
      catalogDocumentVersion: seed.documentVersion ?? null,
      catalogIsReplacement: false,
    };
  }

  const requestedApprovalIds = new Set(seed.registryApprovalIds || []);
  const reviewedRecord = APPROVED_DRIVER_SOURCES.find(
    (record) =>
      (requestedApprovalIds.size === 0 || requestedApprovalIds.has(record.id)) &&
      record.usage === "direct" &&
      isLogicApproved(record, logic) &&
      publisherHostnameMatches(hostname, approvedPublisherHostnames(record)),
  );
  if (!reviewedRecord) return null;

  return {
    ...reviewedRecord,
    id: `catalog-${reviewedRecord.id}-${stableUrlToken(normalizedUrl)}`,
    // Approval labels remain registry-authored; workbook labels are guidance.
    label: reviewedRecord.label,
    urlPatterns: [{ type: "exact", value: normalizedUrl }],
    fallbackUrl: normalizedUrl,
    fallbackTitle: reviewedRecord.fallbackTitle,
    // Workbook prose is untrusted guidance and must not become evidence.
    fallbackSnippet: "",
    useAsFallback: false,
    reviewedPublisherSourceId: reviewedRecord.id,
    catalogSeedUrl: normalizedUrl,
    catalogExactUrl: normalizedUrl,
    catalogPageReferences: seed.pageReferences || [],
    catalogDocumentVersion: seed.documentVersion ?? null,
    catalogIsReplacement: false,
  };
}

/**
 * Creates another exact, request-scoped approval for a search result from the
 * same reviewed publisher host as a catalog seed. Country, sector, logic, and
 * claim checks still run after the page is retrieved.
 */
export function resolveApprovedSamePublisherSource(
  candidateUrl: string,
  seedRecord: ApprovedDriverSource,
  logic: EsgDriverLogic,
): ApprovedDriverSource | null {
  if (!isTrustedCatalogApproval(seedRecord, seedRecord.catalogExactUrl || "", logic)) {
    return null;
  }
  const normalizedUrl = normalizeUrlForApproval(candidateUrl);
  if (!normalizedUrl) return null;

  let candidate: URL;
  let seed: URL;
  try {
    candidate = new URL(normalizedUrl);
    seed = new URL(seedRecord.catalogExactUrl || "");
  } catch {
    return null;
  }
  if (candidate.protocol !== "https:") return null;
  const reviewedRecord = APPROVED_DRIVER_SOURCES.find(
    (record) => record.id === seedRecord.reviewedPublisherSourceId,
  );
  if (!reviewedRecord || reviewedRecord.usage !== "direct") return null;
  const reviewedDomains = approvedPublisherHostnames(reviewedRecord);
  if (
    !publisherHostnameMatches(seed.hostname, reviewedDomains) ||
    !publisherHostnameMatches(candidate.hostname, reviewedDomains)
  ) {
    return null;
  }

  const exactRecord = matchApprovedSource(normalizedUrl);
  if (exactRecord?.usage === "direct" && isLogicApproved(exactRecord, logic)) {
    return {
      ...exactRecord,
      reviewedPublisherSourceId: exactRecord.id,
      catalogSeedUrl: seedRecord.catalogSeedUrl || seedRecord.catalogExactUrl,
      catalogExactUrl: normalizedUrl,
      catalogPageReferences: seedRecord.catalogPageReferences || [],
      catalogDocumentVersion: seedRecord.catalogDocumentVersion ?? null,
      catalogIsReplacement: true,
    };
  }

  return {
    ...seedRecord,
    id: `catalog-${seedRecord.reviewedPublisherSourceId}-${stableUrlToken(normalizedUrl)}`,
    urlPatterns: [{ type: "exact", value: normalizedUrl }],
    fallbackUrl: normalizedUrl,
    fallbackTitle: seedRecord.label,
    fallbackSnippet: "",
    useAsFallback: false,
    catalogSeedUrl: seedRecord.catalogSeedUrl || seedRecord.catalogExactUrl,
    catalogExactUrl: normalizedUrl,
    catalogIsReplacement: true,
  };
}

/**
 * Performs the registry and request-scope checks that do not require page
 * content. Callers use this before making any network request to a candidate
 * source URL; content-dependent country/sector checks still run after retrieval.
 */
export function preflightApprovedDriverSource(
  url: string,
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  explicitRecord?: ApprovedDriverSource,
): ApprovedSourcePreflightResult {
  const record = explicitRecord || matchApprovedSource(url);
  if (!record) return { approved: false, reason: "not-approved" };
  if (explicitRecord && !isTrustedCatalogApproval(explicitRecord, url, logic)) {
    return { approved: false, reason: "not-approved" };
  }
  if (!isLogicApproved(record, logic)) {
    return { approved: false, record, reason: "logic-mismatch" };
  }
  if (!isCountryScopeCompatible(record, input.country)) {
    return { approved: false, record, reason: "country-mismatch" };
  }

  if (!isSectorScopeCompatible(record, input.sector)) {
    return { approved: false, record, reason: "sector-mismatch" };
  }
  return { approved: true, record };
}

/** Relevance points deducted (not a rejection) when the soft concept/claim
 * keyword check misses on an otherwise in-scope approved source. */
const CONCEPT_MISMATCH_RELEVANCE_PENALTY = 25;

export function approveDriverSource(
  source: EsgDriverSource,
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  explicitRecord?: ApprovedDriverSource,
): SourceApprovalResult {
  const record = explicitRecord || matchApprovedSource(source.url);
  const rejectedAt = new Date().toISOString();

  if (!record || (explicitRecord && !isTrustedCatalogApproval(explicitRecord, source.url, logic))) {
    return {
      approved: false,
      rejected: toRejectedSource(
        source,
        logic.id,
        "not-approved",
        "URL is not present in the approved ESG driver source registry.",
        rejectedAt,
      ),
    };
  }

  const hasRetrievedPageEvidence =
    source.retrievalStatus === "retrieved" &&
    source.evidenceProvenance === "retrieved-page" &&
    Boolean(source.contentSnippet.trim());
  const isExplicitContextFallback =
    record.usage === "context" &&
    source.isContextualFallback &&
    source.evidenceProvenance === "approved-context";

  if (!hasRetrievedPageEvidence && !isExplicitContextFallback) {
    return {
      approved: false,
      record,
      rejected: toRejectedSource(
        source,
        logic.id,
        "retrieval-failed",
        "The approved URL was not successfully retrieved, so its snippet cannot be used as direct page evidence.",
        rejectedAt,
        record,
      ),
    };
  }

  const logicMatch = isLogicApproved(record, logic);
  if (!logicMatch) {
    return {
      approved: false,
      record,
      rejected: toRejectedSource(
        source,
        logic.id,
        "logic-mismatch",
        `Approved source is not scoped to driver logic ${logic.id}.`,
        rejectedAt,
        record,
      ),
    };
  }

  const countryCheck = checkCountryScope(record, source, input, logic);
  if (!countryCheck.ok) {
    return {
      approved: false,
      record,
      rejected: toRejectedSource(
        source,
        logic.id,
        "country-mismatch",
        countryCheck.detail,
        rejectedAt,
        record,
      ),
    };
  }

  const sectorCheck = checkSectorScope(record, source, input, logic);
  if (!sectorCheck.ok) {
    return {
      approved: false,
      record,
      rejected: toRejectedSource(
        source,
        logic.id,
        "sector-mismatch",
        sectorCheck.detail,
        rejectedAt,
        record,
      ),
    };
  }

  // Concept/claim keyword matching is a SOFT signal, not a gate. The source has
  // already cleared the hard scope checks (approved domain, driver-logic scope,
  // country, sector); a keyword miss after that is usually a false negative from
  // paraphrasing or messy PDF extraction. Dropping it here starves the driver of
  // evidence and can drop the whole driver, so instead we keep the source and
  // penalize its relevance so cleaner on-topic sources outrank it.
  const conceptCheck = checkCatalogConceptAndClaimScope(record, source, logic);
  const conceptPenalty = conceptCheck.ok ? 0 : CONCEPT_MISMATCH_RELEVANCE_PENALTY;

  const approvedSource: EsgDriverSource = {
    ...source,
    relevanceScore: Math.max(0, source.relevanceScore - conceptPenalty),
    approvalId: record.id,
    approvalLabel: record.label,
    approvalUsage: record.usage,
    approvalCountryScope: record.countries,
    approvalSectorScope: record.sectors,
    approvalLogicScope: record.driverLogicIds || record.driverSections,
    approvalClaimTypes: record.claimTypes,
  };

  return { approved: true, source: approvedSource, record };
}

export function buildApprovedFallbackItems(
  input: GenerateEsgDriversInput,
  logics: EsgDriverLogic[],
): Array<{
  title: string;
  link: string;
  snippet: string;
  displayLink?: string;
  isContextualFallback: true;
}> {
  const seen = new Set<string>();
  const items: Array<{
    title: string;
    link: string;
    snippet: string;
    displayLink?: string;
    isContextualFallback: true;
  }> = [];

  for (const logic of logics) {
    for (const record of APPROVED_DRIVER_SOURCES) {
      if (record.useAsFallback === false) continue;
      if (!isLogicApproved(record, logic)) continue;
      if (!isCountryScopeCompatible(record, input.country)) continue;
      if (!isSectorScopeCompatible(record, input.sector)) continue;

      const link = interpolateFallbackUrl(record.fallbackUrl, input);
      const normalized = normalizeUrlForApproval(link);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);

      items.push({
        title: record.fallbackTitle,
        link,
        // Registry-authored context is kept separate from retrieved page evidence.
        // Never append user input here: doing so can manufacture apparent country
        // or sector support that the source itself does not contain.
        snippet: record.fallbackSnippet,
        displayLink: safeDomain(link) || undefined,
        isContextualFallback: true,
      });
    }
  }

  return items;
}

export function isSourceApprovedDirect(source: EsgDriverSource): boolean {
  return Boolean(
    source.approvalId &&
      source.approvalUsage === "direct" &&
      source.retrievalStatus === "retrieved" &&
      source.evidenceProvenance === "retrieved-page" &&
      source.contentSnippet.trim(),
  );
}

export function getSectorGroupForRegistry(sector: string): SectorScope {
  const normalized = sector.toLowerCase();
  if (/\b(bank|banking|financial|finance|insurance|lending|credit)\b/.test(normalized)) {
    return "banking";
  }
  if (/\b(construction|cement|building materials|contractor|contractors)\b/.test(normalized)) {
    return "construction";
  }
  if (/\b(real estate|property|buildings?|reit)\b/.test(normalized)) {
    return "real-estate";
  }
  if (/\b(oil|gas|petroleum|lng|upstream|downstream)\b/.test(normalized)) {
    return "oil-gas";
  }
  return "general";
}

export function sourceTextForApproval(source: EsgDriverSource): string {
  const verifiedText = [
    source.title,
    source.url,
    source.domain,
    source.contentSnippet,
  ];
  if (
    source.isContextualFallback &&
    source.evidenceProvenance === "approved-context"
  ) {
    verifiedText.push(source.snippet);
  }

  return verifiedText
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function countryAliasesForRegistry(country: string): string[] {
  const normalized = country.trim().toLowerCase();
  const aliases = [normalized];

  if (normalized === "uae" || normalized.includes("united arab emirates")) {
    aliases.push("uae", "united arab emirates", "emirati");
  }
  if (normalized.includes("saudi")) {
    aliases.push("saudi", "saudi arabia", "kingdom of saudi arabia", "ksa");
  }
  if (normalized.includes("kazakhstan")) {
    aliases.push("kazakhstan", "kazakh");
  }

  return uniqueStrings(aliases).filter((alias) => alias.length > 1);
}

export function sectorAliasesForRegistry(sector: string): string[] {
  const normalized = sector.trim().toLowerCase();
  const aliases = [normalized];

  if (/\b(bank|banking|financial|finance|lending|credit)\b/.test(normalized)) {
    aliases.push(
      "banking",
      "banks",
      "financial sector",
      "financial institutions",
      "lenders",
      "credit",
      "financed emissions",
    );
  }
  if (/\b(construction|cement|building materials|contractor|contractors)\b/.test(normalized)) {
    aliases.push("construction", "contractors", "building", "buildings", "cement");
  }
  if (/\b(real estate|property|buildings?|reit)\b/.test(normalized)) {
    aliases.push("real estate", "property", "buildings", "reit");
  }
  if (/\b(oil|gas|petroleum|lng|upstream|downstream)\b/.test(normalized)) {
    aliases.push("oil", "gas", "oil and gas", "petroleum", "lng", "methane");
  }

  return uniqueStrings(aliases).filter((alias) => alias.length > 2);
}

function matchesPattern(normalizedUrl: string, pattern: ApprovedSourceUrlPattern): boolean {
  const value = normalizePatternValue(pattern.value);
  if (!value) return false;

  if (pattern.type === "exact") return normalizedUrl === value;
  if (pattern.type === "prefix") return normalizedUrl.startsWith(value);
  if (pattern.type === "contains") return normalizedUrl.includes(value);
  if (pattern.type === "host") {
    try {
      const parsed = new URL(normalizedUrl);
      return parsed.hostname === value || parsed.hostname.endsWith(`.${value}`);
    } catch {
      return false;
    }
  }

  return false;
}

function normalizePatternValue(value: string): string | null {
  if (/^https?:\/\//i.test(value)) {
    return normalizeUrlForApproval(value);
  }
  return value.trim().replace(/^www\./, "").replace(/\/$/, "").toLowerCase() || null;
}

function isLogicApproved(record: ApprovedDriverSource, logic: EsgDriverLogic): boolean {
  // Catalog URLs are exact, workbook-reviewed mappings on an already reviewed
  // direct publisher. Their retrieved content is subjected to the stricter
  // catalog concept/claim gate below, so they are not constrained by the
  // smaller legacy logic library's historical IDs.
  if (logic.catalogArchetypeId && record.usage === "direct") return true;
  if (record.driverLogicIds?.includes(logic.id)) return true;
  const registryLogicIds = (logic as EsgDriverLogic & { registryLogicIds?: string[] })
    .registryLogicIds;
  if (
    registryLogicIds?.some((logicId) => record.driverLogicIds?.includes(logicId))
  ) {
    return true;
  }
  if (record.driverSections?.includes(logic.section)) return true;
  return !record.driverLogicIds && !record.driverSections;
}

function isTrustedCatalogApproval(
  record: ApprovedDriverSource,
  url: string,
  logic: EsgDriverLogic,
): boolean {
  if (!record.reviewedPublisherSourceId || !record.catalogExactUrl) return false;
  const reviewedRecord = APPROVED_DRIVER_SOURCES.find(
    (candidate) => candidate.id === record.reviewedPublisherSourceId,
  );
  if (!reviewedRecord || reviewedRecord.usage !== "direct") return false;
  if (!isLogicApproved(reviewedRecord, logic)) return false;

  const normalizedUrl = normalizeUrlForApproval(url);
  const exactUrl = normalizeUrlForApproval(record.catalogExactUrl);
  if (!normalizedUrl || !exactUrl || normalizedUrl !== exactUrl) return false;
  try {
    const requestedHost = normalizePublisherHostname(new URL(normalizedUrl).hostname);
    return publisherHostnameMatches(
      requestedHost,
      approvedPublisherHostnames(reviewedRecord),
    );
  } catch {
    return false;
  }
}

/** Reviewed publisher roots used to constrain catalog refresh searches. */
export function approvedPublisherHostnames(record: ApprovedDriverSource): string[] {
  const values = [
    record.fallbackUrl,
    ...record.urlPatterns
      .filter((pattern) => /^https?:\/\//i.test(pattern.value))
      .map((pattern) => pattern.value),
  ];
  return uniqueStrings(
    values.flatMap((value) => {
      try {
        return [normalizePublisherHostname(new URL(value).hostname)];
      } catch {
        return [];
      }
    }),
  );
}

function publisherHostnameMatches(
  hostname: string,
  reviewedDomains: readonly string[],
): boolean {
  const normalizedHost = normalizePublisherHostname(hostname);
  return reviewedDomains.some((domain) => {
    const normalizedDomain = normalizePublisherHostname(domain);
    return (
      normalizedHost === normalizedDomain ||
      normalizedHost.endsWith(`.${normalizedDomain}`)
    );
  });
}

function normalizePublisherHostname(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
      .hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function stableUrlToken(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function checkCountryScope(
  record: ApprovedDriverSource,
  source: EsgDriverSource,
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
): { ok: boolean; detail: string } {
  if (!isCountryScopeCompatible(record, input.country)) {
    return {
      ok: false,
      detail: `Approved country scope ${record.countries.join(", ")} does not match ${input.country}.`,
    };
  }

  if (
    record.usage === "context" &&
    source.isContextualFallback &&
    source.evidenceProvenance === "approved-context"
  ) {
    return { ok: true, detail: "" };
  }

  const text = normalizeScopeText(sourceTextForApproval(source));
  const selectedAliases = countryAliasesForRegistry(input.country);
  const hasSelectedCountry = selectedAliases.some((alias) =>
    containsScopePhrase(text, alias),
  );
  const otherCountries = otherKnownCountryAliases(input.country);
  const mentionsOtherCountry = otherCountries.some((alias) =>
    containsScopePhrase(text, alias),
  );
  const needsCountryEvidence =
    record.requiresCountryEvidence ||
    logic.type === "Country-related" ||
    Boolean(
      logic.catalogCountryScopes?.some(
        (scope) => canonicalCountry(scope) === canonicalCountry(input.country),
      ) && !logic.catalogCountryScopes?.includes("All"),
    );

  if (needsCountryEvidence && !hasSelectedCountry) {
    return {
      ok: false,
      detail: `Source does not mention ${input.country}, which is required for this country-specific driver.`,
    };
  }

  if (needsCountryEvidence && mentionsOtherCountry && !hasSelectedCountry) {
    return {
      ok: false,
      detail: `Source appears to describe another country, not ${input.country}.`,
    };
  }

  return { ok: true, detail: "" };
}

function checkSectorScope(
  record: ApprovedDriverSource,
  source: EsgDriverSource,
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
): { ok: boolean; detail: string } {
  if (!isSectorScopeCompatible(record, input.sector)) {
    return {
      ok: false,
      detail: `Approved sector scope ${record.sectors.join(", ")} does not match ${input.sector}.`,
    };
  }


  if (
    record.usage === "context" &&
    source.isContextualFallback &&
    source.evidenceProvenance === "approved-context"
  ) {
    return { ok: true, detail: "" };
  }

  const text = normalizeScopeText(
    [
      source.contentSnippet,
      source.isContextualFallback &&
      source.evidenceProvenance === "approved-context"
        ? source.snippet
        : "",
    ].join(" "),
  );
  const hasSector = sectorAliasesForRegistry(input.sector).some((alias) =>
    containsScopePhrase(text, alias),
  );
  const sectorGroup = getSectorGroupForRegistry(input.sector);
  const needsSectorEvidence =
    record.requiresSectorEvidence ||
    logic.type === "Sector-related" ||
    logic.id.includes("sector") ||
    logic.id.includes("supply-chain") ||
    catalogSectorRequiresEvidence(logic, input.sector);
  const specificallySectorScoped = record.sectors.includes(sectorGroup);

  if (needsSectorEvidence && !hasSector && !specificallySectorScoped) {
    return {
      ok: false,
      detail: `Source does not show enough ${input.sector} linkage for this sector-specific driver.`,
    };
  }

  return { ok: true, detail: "" };
}

function catalogSectorRequiresEvidence(
  logic: EsgDriverLogic,
  selectedSector: string,
): boolean {
  const scopes = logic.catalogSectorScopes || [];
  if (scopes.length === 0 || scopes.includes("All")) return false;
  if (scopes.some((scope) => getSectorGroupForRegistry(scope) === getSectorGroupForRegistry(selectedSector))) {
    return true;
  }
  const selectedFamily =
    getSectorGroupForRegistry(selectedSector) === "banking"
      ? "Financial Services"
      : getSectorGroupForRegistry(selectedSector) === "construction" ||
          getSectorGroupForRegistry(selectedSector) === "real-estate"
        ? "Built Environment"
        : getSectorGroupForRegistry(selectedSector) === "oil-gas"
          ? "Energy"
          : "Other";
  return (logic.catalogSectorFamilies || []).includes(selectedFamily);
}

const CATALOG_CONCEPT_STOPWORDS = new Set([
  "about",
  "across",
  "against",
  "based",
  "business",
  "climate",
  "companies",
  "company",
  "country",
  "current",
  "driver",
  "evidence",
  "global",
  "impact",
  "industry",
  "latest",
  "market",
  "policy",
  "requirement",
  "requirements",
  "sector",
  "selected",
  "source",
  "standard",
  "sustainability",
  "sustainable",
  "target",
  "targets",
  "through",
  "which",
  "with",
]);

function checkCatalogConceptAndClaimScope(
  record: ApprovedDriverSource,
  source: EsgDriverSource,
  logic: EsgDriverLogic,
): { ok: boolean; detail: string } {
  if (!logic.catalogArchetypeId) return { ok: true, detail: "" };

  const textTokens = new Set(
    normalizeScopeText(sourceTextForApproval(source)).match(/[a-z0-9]+/g) || [],
  );
  const conceptTerms = meaningfulCatalogTerms(
    `${logic.catalogName || ""} ${logic.logic}`,
  );
  const requiredConceptHits = conceptTerms.length >= 4 ? 2 : conceptTerms.length > 0 ? 1 : 0;
  const conceptHits = conceptTerms.filter((term) => textTokens.has(term));
  if (requiredConceptHits > 0 && conceptHits.length < requiredConceptHits) {
    return {
      ok: false,
      detail: `Retrieved page does not match catalog concept ${logic.catalogName || logic.id}.`,
    };
  }

  const claimTermSets = record.claimTypes
    .map((claim) => meaningfulCatalogTerms(claim))
    .filter((terms) => terms.length > 0);
  const claimMatches = claimTermSets.some((terms) => {
    return terms.filter((term) => textTokens.has(term)).length >= Math.min(2, terms.length);
  });
  if (claimTermSets.length > 0 && !claimMatches) {
    return {
      ok: false,
      detail: `Retrieved page does not match the reviewed publisher claim scope for ${logic.catalogName || logic.id}.`,
    };
  }

  return { ok: true, detail: "" };
}

function meaningfulCatalogTerms(value: string): string[] {
  return uniqueStrings(
    (value.toLowerCase().match(/[a-z0-9]+/g) || []).filter(
      (term) =>
        (term.length >= 4 || /^[a-z]{3}$/.test(term)) &&
        !CATALOG_CONCEPT_STOPWORDS.has(term) &&
        !/^\d+$/.test(term),
    ),
  ).slice(0, 16);
}

function isCountryScopeCompatible(
  record: ApprovedDriverSource,
  country: string,
): boolean {
  if (record.countries.includes("Global")) return true;
  const normalized = canonicalCountry(country);
  return record.countries.some((candidate) => canonicalCountry(candidate) === normalized);
}

function isSectorScopeCompatible(record: ApprovedDriverSource, sector: string): boolean {
  if (record.sectors.includes("All")) return true;
  const sectorGroup = getSectorGroupForRegistry(sector);
  return record.sectors.includes(sectorGroup);
}

function interpolateFallbackUrl(
  fallbackUrl: string,
  input: GenerateEsgDriversInput,
): string {
  return fallbackUrl.replaceAll("{countrySlug}", countrySlug(input.country));
}

function toRejectedSource(
  source: EsgDriverSource,
  driverLogicId: string,
  reason: RejectedEsgDriverSource["reason"],
  detail: string,
  rejectedAt: string,
  record?: ApprovedDriverSource,
): RejectedEsgDriverSource {
  return {
    id: source.id,
    title: source.title,
    url: source.url,
    domain: source.domain,
    driverLogicId,
    reason,
    detail,
    approvalId: record?.id,
    rejectedAt,
  };
}

function canonicalCountry(country: string): string {
  const normalized = country.trim().toLowerCase();
  if (normalized === "uae" || normalized.includes("united arab emirates")) return "uae";
  if (normalized.includes("saudi")) return "saudi-arabia";
  if (normalized.includes("kazakhstan")) return "kazakhstan";
  return normalized.replace(/[^a-z0-9]+/g, "-");
}

function countrySlug(country: string): string {
  const canonical = canonicalCountry(country);
  if (canonical === "uae") return "united-arab-emirates";
  return canonical;
}

function otherKnownCountryAliases(country: string): string[] {
  const selected = new Set(countryAliasesForRegistry(country));
  return [
    "uae",
    "united arab emirates",
    "saudi",
    "saudi arabia",
    "kingdom of saudi arabia",
    "ksa",
    "kazakhstan",
    "kazakh",
    "nigeria",
    "egypt",
    "india",
    "china",
    "united states",
    "united kingdom",
  ].filter((alias) => !selected.has(alias));
}

function safeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function normalizeScopeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsScopePhrase(normalizedText: string, phrase: string): boolean {
  const normalizedPhrase = normalizeScopeText(phrase);
  if (!normalizedPhrase) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
