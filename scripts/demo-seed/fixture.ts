/**
 * The demo record: one invented mid-career software engineer, Kenji Moriyama,
 * at four invented companies, with one open-source project of his own. Every
 * name, address, number and company here is made up; none is sampled from
 * `local/`. Dates are month precision (`YYYY-MM`), as the record's are.
 */

export const PROFILE = {
  familyNameKanji: "森山",
  givenNameKanji: "健二",
  familyNameKana: "もりやま",
  givenNameKana: "けんじ",
  nameLatin: "Kenji Moriyama",
  dateOfBirth: "1990-06",
  gender: null,
  phone: "090-0000-1234",
  email: "kenji.moriyama@example.com",
  postalCode: "100-0000",
  address: "東京都千代田区デモ町1-2-3 サンプルハイツ101",
  addressKana: "とうきょうとちよだくでもちょう1-2-3 さんぷるはいつ101",
  desiredRoleNote: "バックエンドまたはプラットフォーム領域のスタッフエンジニア職を希望します。",
  // The English résumé's header (issue #108). Its phone is a second invented
  // number, so a résumé showing the 履歴書 one is visibly wrong. Links stay
  // under example.com, like every other address here.
  resumeHeadline: "Staff Backend and Platform Engineer",
  resumeCity: "Tokyo",
  resumeCountry: "Japan",
  resumePhone: "+81 90-0000-5678",
  resumeLinkedinUrl: "https://linkedin.example.com/in/kenji-moriyama",
  resumeGithubUrl: "https://github.example.com/kenji-moriyama",
  resumePortfolioUrl: "https://kenji-moriyama.example.com",
};

export interface DemoEmployer {
  key: string;
  nameJa: string;
  nameLatin: string;
  businessDescription: string;
  industryJa: string;
  /** In English, for the résumé's job header. */
  city: string;
  capitalYen: number;
  headcount: number;
  employmentType: "full_time" | "contract";
  startedOn: string;
  endedOn: string | null;
  leavingReasonJa: string | null;
  roles: { titleJa: string; titleLatin: string; shokushuJa: string; startedOn: string; endedOn: string | null }[];
  projects: {
    key: string;
    name: string;
    nameJa: string;
    summary: string;
    summaryJa: string;
    startedOn: string;
    endedOn: string | null;
  }[];
}

export const EMPLOYERS: DemoEmployer[] = [
  {
    key: "hokushin",
    nameJa: "株式会社北辰システムズ",
    nameLatin: "Hokushin Systems Co., Ltd.",
    businessDescription: "金融機関向けシステムの受託開発・保守を行う独立系SIer。",
    industryJa: "情報通信業（受託開発）",
    city: "Tokyo",
    capitalYen: 300_000_000,
    headcount: 850,
    employmentType: "full_time",
    startedOn: "2015-04",
    endedOn: "2017-03",
    leavingReasonJa: "一身上の都合により",
    roles: [
      { titleJa: "プログラマー", titleLatin: "Programmer", shokushuJa: "アプリケーションエンジニア", startedOn: "2015-04", endedOn: "2016-03" },
      { titleJa: "システムエンジニア（サブリーダー）", titleLatin: "Systems Engineer", shokushuJa: "アプリケーションエンジニア", startedOn: "2016-04", endedOn: "2017-03" },
    ],
    projects: [
      {
        key: "hokushin-batch",
        name: "Night batch platform renewal for a regional bank",
        nameJa: "地方銀行向け夜間バッチ基盤刷新",
        summary: "Moved month-end batch jobs from COBOL to Spring Batch and parallelised them.",
        summaryJa: "月末バッチをCOBOLからSpring Batchへ移行し、並列化。",
        startedOn: "2015-10",
        endedOn: "2017-03",
      },
    ],
  },
  {
    key: "minatopay",
    nameJa: "株式会社ミナトペイ",
    nameLatin: "MinatoPay Inc.",
    businessDescription: "中小規模のEC事業者向けにオンライン決済サービスを提供するフィンテック企業。",
    industryJa: "金融業（決済代行）",
    city: "Tokyo",
    capitalYen: 1_200_000_000,
    headcount: 140,
    employmentType: "full_time",
    startedOn: "2017-04",
    endedOn: "2020-06",
    leavingReasonJa: "一身上の都合により",
    roles: [
      { titleJa: "バックエンドエンジニア", titleLatin: "Backend Engineer", shokushuJa: "バックエンドエンジニア", startedOn: "2017-04", endedOn: "2018-12" },
      { titleJa: "シニアバックエンドエンジニア", titleLatin: "Senior Backend Engineer", shokushuJa: "バックエンドエンジニア", startedOn: "2019-01", endedOn: "2020-06" },
    ],
    projects: [
      {
        key: "minatopay-ledger",
        name: "Payments ledger rebuild",
        nameJa: "決済元帳の再構築",
        summary: "Replaced an update-in-place balance table with a double-entry, append-only ledger.",
        summaryJa: "上書き更新の残高テーブルを、複式・追記型の元帳に置き換え。",
        startedOn: "2017-06",
        endedOn: "2018-09",
      },
      {
        key: "minatopay-fraud",
        name: "Fraud rules engine",
        nameJa: "不正検知ルールエンジン",
        summary: "A rules engine the risk team edits without a deploy, with shadow-mode evaluation.",
        summaryJa: "リスク管理チームがデプロイなしで編集できる、シャドーモード評価付きのルールエンジン。",
        startedOn: "2019-02",
        endedOn: "2020-03",
      },
    ],
  },
  {
    key: "kestrel",
    nameJa: "ケストレルコマース株式会社",
    nameLatin: "Kestrel Commerce K.K.",
    businessDescription: "独立系ファッションブランド向けのオンラインマーケットプレイスを運営。",
    industryJa: "小売業（EC）",
    city: "Tokyo",
    capitalYen: 2_500_000_000,
    headcount: 420,
    employmentType: "full_time",
    startedOn: "2020-07",
    endedOn: "2023-12",
    leavingReasonJa: "一身上の都合により",
    roles: [
      { titleJa: "シニアソフトウェアエンジニア", titleLatin: "Senior Software Engineer", shokushuJa: "フロントエンド／バックエンドエンジニア", startedOn: "2020-07", endedOn: "2021-03" },
      { titleJa: "テックリード", titleLatin: "Tech Lead, Checkout", shokushuJa: "テックリード", startedOn: "2021-04", endedOn: "2023-12" },
    ],
    projects: [
      {
        key: "kestrel-checkout",
        name: "Checkout performance",
        nameJa: "チェックアウト高速化",
        summary: "Halved checkout time to interactive on mobile and put a performance budget in CI.",
        summaryJa: "モバイルの決済画面が操作可能になるまでの時間を半減し、CIにパフォーマンス予算を導入。",
        startedOn: "2021-04",
        endedOn: "2022-03",
      },
    ],
  },
  {
    key: "solaris",
    nameJa: "株式会社ソラリスヘルス",
    nameLatin: "Solaris Health Inc.",
    businessDescription: "クリニック向けの予約・電子カルテ・患者アプリを提供するヘルステック企業。",
    industryJa: "情報通信業（SaaS）",
    city: "Tokyo",
    capitalYen: 800_000_000,
    headcount: 210,
    employmentType: "full_time",
    startedOn: "2024-01",
    endedOn: null,
    leavingReasonJa: null,
    roles: [
      { titleJa: "スタッフエンジニア（プラットフォーム）", titleLatin: "Staff Engineer, Platform", shokushuJa: "プラットフォームエンジニア", startedOn: "2024-01", endedOn: null },
    ],
    projects: [],
  },
];

/** Work outside employment: the English résumé's PROJECTS section. */
export const INDEPENDENT_PROJECTS = [
  {
    key: "kanjigrid",
    name: "kanjigrid (open source)",
    nameJa: "kanjigrid（オープンソース）",
    summary: "A TypeScript library for vertical Japanese text layout in the browser.",
    summaryJa: "ブラウザで日本語の縦書きを組版するTypeScriptライブラリ。",
    startedOn: "2019-05",
    endedOn: null,
  },
];

export const EDUCATIONS = [
  {
    institution: "Tokyo Metropolitan Midorino High School",
    institutionJa: "東京都立みどり野高等学校",
    faculty: "普通科",
    degree: null,
    fieldOfStudy: null,
    level: "secondary_upper" as const,
    startedOn: "2006-04",
    endedOn: "2009-03",
    outcome: "graduated" as const,
  },
  {
    institution: "Minato University of Science and Technology",
    institutionJa: "みなと科学技術大学",
    faculty: "工学部 情報工学科",
    degree: "Bachelor of Engineering",
    fieldOfStudy: "Information Engineering",
    level: "tertiary" as const,
    startedOn: "2009-04",
    endedOn: "2013-03",
    outcome: "graduated" as const,
  },
  {
    institution: "Minato University of Science and Technology, Graduate School",
    institutionJa: "みなと科学技術大学大学院",
    faculty: "工学研究科 情報工学専攻 修士課程",
    degree: "Master of Engineering",
    fieldOfStudy: "Information Engineering",
    level: "postgraduate" as const,
    startedOn: "2013-04",
    endedOn: "2015-03",
    outcome: "completed" as const,
  },
];

export const CERTIFICATIONS = [
  { name: "Applied Information Technology Engineer Examination", nameJa: "応用情報技術者試験", issuingOrganization: "IPA", kind: "technical" as const, issuedOn: "2016-06", expiresOn: null, technologies: [] },
  { name: "AWS Certified Solutions Architect – Associate", nameJa: "AWS認定ソリューションアーキテクト – アソシエイト", issuingOrganization: "Amazon Web Services", kind: "technical" as const, issuedOn: "2019-03", expiresOn: "2022-03", technologies: ["AWS"] },
  { name: "Certified Kubernetes Administrator (CKA)", nameJa: "Certified Kubernetes Administrator (CKA)", issuingOrganization: "The Linux Foundation", kind: "technical" as const, issuedOn: "2025-02", expiresOn: "2027-02", technologies: ["Kubernetes"] },
  { name: "Microsoft Certified: Azure Solutions Architect Expert", nameJa: "Microsoft認定 Azure Solutions Architect Expert", issuingOrganization: "Microsoft", kind: "technical" as const, issuedOn: "2024-09", expiresOn: "2026-11", technologies: ["Azure"] },
  { name: "TOEIC Listening & Reading 865", nameJa: "TOEIC Listening & Reading Test 865点", issuingOrganization: "IIBC", kind: "language" as const, issuedOn: "2018-11", expiresOn: null, technologies: [] },
  { name: "Ordinary Driving Licence", nameJa: "普通自動車第一種運転免許", issuingOrganization: "Prefectural Public Safety Commission", kind: "other" as const, issuedOn: "2012-08", expiresOn: null, technologies: [] },
];

/** Work that left no document: entered through Quick capture, so Attested and with no passage. */
export const CAPTURED = [
  { employer: "solaris", month: "2025-06", claim: "Ran the platform team's on-call rotation redesign, moving from one person a week to a follow-the-sun pair", technologies: [] },
  { employer: "solaris", month: "2025-11", claim: "Wrote the engineering career ladder for platform roles, adopted company-wide", technologies: [] },
  { employer: "kestrel", month: "2023-05", claim: "Organised the company's first internal hackathon, with 60 participants", technologies: [] },
];

/** The author's skills section. Every name must be a technology some fact or certification names. */
export const SKILL_GROUPS = [
  { name: "Languages", nameJa: "言語", skills: ["Go", "TypeScript", "Kotlin", "Java", "Python"] },
  { name: "Cloud and platform", nameJa: "クラウド・基盤", skills: ["Azure", "Azure Kubernetes Service", "Kubernetes", "Terraform", "Argo CD", "AWS", "Google Cloud"] },
  { name: "Data", nameJa: "データ", skills: ["PostgreSQL", "Kafka", "BigQuery", "dbt", "Elasticsearch", "Oracle Database"] },
  { name: "Frontend", nameJa: "フロントエンド", skills: ["React", "Next.js", "Storybook"] },
];

const PLATFORM_JD = `Northwind Clinics Cloud — Staff Platform Engineer (Tokyo, hybrid)

We run scheduling and records software for 1,800 clinics across Japan. Our platform team owns the Kubernetes estate on Azure, CI/CD and observability.

What you will do
- Own the reliability of our AKS clusters and the deployment path from merge to production.
- Lead the move from hand-written Terraform modules to a self-service platform for product teams.
- Set service-level objectives with product teams and run the incident process.
- Mentor engineers and take part in hiring.

What we look for
- 8+ years building and operating production systems.
- Deep experience with Kubernetes, Terraform and one major cloud (Azure preferred).
- Experience leading a migration end to end.
- Business-level English and Japanese.`;

const FINTECH_JD = `Harbor Ledger — Senior Backend Engineer, Payments

Harbor Ledger builds accounting infrastructure for marketplaces. You will join the payments core team.

Responsibilities
- Design and build services that move money correctly: idempotent, auditable, reconcilable.
- Work with finance and risk to turn requirements into systems.
- Improve the reliability of our Go services on AWS.

Requirements
- 5+ years of backend engineering, ideally in payments or fintech.
- Go or Kotlin in production; PostgreSQL; event streaming (Kafka or similar).
- Experience with double-entry ledgers is a strong plus.`;

const ECOMMERCE_JD = `Kumo Market — Engineering Manager, Web Platform

Kumo Market is a second-hand marketplace with 8 million monthly users. We are hiring an engineering manager for the web platform team (7 engineers).

You will
- Lead the team that owns our Next.js web app, design system and web performance.
- Hire and grow engineers.
- Partner with product on the roadmap.

You have
- Experience leading a frontend or full-stack team.
- Strong React and TypeScript; web performance work you can point to.
- Japanese at business level.`;

const DATA_JD = `Aozora Analytics — Data Platform Engineer

Build the pipelines behind our healthcare analytics product: ingestion, dbt models, and a semantic layer for Power BI.

Must have: Python, SQL, dbt, a cloud data lake (Azure or GCP). Healthcare data experience a plus.`;

export interface DemoApplication {
  company: string;
  position: string;
  postingUrl: string | null;
  jobDescription: string;
  requirements: string[];
  /**
   * Days before the run that it was added. Every day here counts back from the
   * run, so a reset in any month shows the same timeline, list order and `gone quiet`.
   */
  addedDaysAgo: number;
  /** Steps reached, in order, with the day each happened (days, not months). */
  steps: { status: "applied" | "resume_passed" | "interview_1" | "interview_2" | "interview_final" | "offer" | "rejected" | "withdrawn"; daysAgo: number }[];
  interviews: { daysAgo: number; round: "interview_1" | "interview_2" | "interview_final" | "other"; who: string; howItWent: string; questions: string[] }[];
}

export const APPLICATIONS: DemoApplication[] = [
  {
    company: "Northwind Clinics Cloud",
    position: "Staff Platform Engineer",
    postingUrl: "https://careers.example.com/northwind/staff-platform",
    jobDescription: PLATFORM_JD,
    requirements: ["8+ years in production systems", "Kubernetes, Terraform, Azure", "Led a migration end to end", "Business English and Japanese"],
    addedDaysAgo: 25,
    steps: [
      { status: "applied", daysAgo: 25 },
      { status: "resume_passed", daysAgo: 18 },
      { status: "interview_1", daysAgo: 11 },
    ],
    interviews: [
      {
        daysAgo: 11,
        round: "interview_1",
        who: "Engineering manager, platform",
        howItWent: "Good. Most of the hour was on the AKS migration: how I sequenced services and why the booking API went last. They pushed on the rollback-rate number and I could explain how we measured it. Weaker on the cost question — I said 28% without the before figure to hand.",
        questions: [
          "Walk me through a migration you led from start to finish.",
          "How did you decide the order in which services moved?",
          "How did you measure the rollback rate before and after?",
          "What would you do differently?",
          "How do you set an SLO with a product team that has never had one?",
        ],
      },
    ],
  },
  {
    company: "Harbor Ledger",
    position: "Senior Backend Engineer, Payments",
    postingUrl: null,
    jobDescription: FINTECH_JD,
    requirements: ["5+ years backend, payments or fintech", "Go or Kotlin, PostgreSQL, Kafka", "Double-entry ledgers"],
    addedDaysAgo: 22,
    steps: [{ status: "applied", daysAgo: 22 }],
    interviews: [],
  },
  {
    company: "Kumo Market",
    position: "Engineering Manager, Web Platform",
    postingUrl: "https://jobs.example.com/kumo/em-web-platform",
    jobDescription: ECOMMERCE_JD,
    requirements: ["Led a frontend or full-stack team", "React and TypeScript", "Web performance results", "Business Japanese"],
    addedDaysAgo: 60,
    steps: [
      { status: "applied", daysAgo: 60 },
      { status: "resume_passed", daysAgo: 53 },
      { status: "interview_1", daysAgo: 45 },
      { status: "rejected", daysAgo: 37 },
    ],
    interviews: [
      {
        daysAgo: 45,
        round: "interview_1",
        who: "VP Engineering",
        howItWent: "They wanted more people-management depth than I have; the checkout story landed, the hiring questions did not.",
        questions: [
          "Tell me about a time you had to let someone go or manage underperformance.",
          "How did you get two other squads to adopt your performance budget?",
          "How do you balance hands-on work with management?",
        ],
      },
    ],
  },
  {
    company: "Aozora Analytics",
    position: "Data Platform Engineer",
    postingUrl: null,
    jobDescription: DATA_JD,
    requirements: ["Python, SQL, dbt", "Azure or GCP data lake", "Healthcare data"],
    addedDaysAgo: 2,
    steps: [],
    interviews: [],
  },
];
