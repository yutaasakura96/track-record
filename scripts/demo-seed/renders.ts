/**
 * What the demo seed's scripted model writes when a document is generated: the
 * five documents, and a résumé and 履歴書 tailored to the platform posting.
 *
 * It stands where the model's answer would, before the seam's own parsing:
 * `generateDemoRender` hands its draft to `parseGeneratedRender`, as the real
 * adapter does, and the route then runs every check a real generation meets
 * (the English and Japanese checks, the 職務経歴書's record rows). A draft that
 * fails one is refused there, and the seed stops on it.
 *
 * Facts are cited by the start of their claim, never by id: ids are made fresh
 * on every reset, and a claim is what this file can name. A cited claim the
 * render was not given (Private, Generated, rejected) stops the seed, rather
 * than quietly leaving a sentence uncited. Employers and projects are found by
 * the name the spec gives them, in either language.
 *
 * Every word here is invented, about the invented record in `./fixture.ts`.
 */
import { parseGeneratedRender } from "~/model/generate";
import type { RenderFact, RenderSpec } from "~/model/types";
import { periodJa } from "~/render/japanese";
import { monthSpan } from "~/render/resume";
import { capitalInJapanese } from "~/render/yen";
import { gapLabelJa, gapMonthsEn } from "~/shared/career-gap";
import type { BlockKind, RenderContent } from "~/shared/render-content";
import { EMPLOYERS, INDEPENDENT_PROJECTS } from "./fixture";

/** The start of each claim this file cites, by a name a reader can follow. */
const F = {
  batchJobs: "夜間バッチ約480本",
  batchPort: "集計系ジョブ62本",
  verifyTool: "旧ジョブと新ジョブの出力差分",
  monthEnd: "月末バッチの終了時刻",
  zeroDelay: "切替後6か月間",
  reused: "作成した検証ツール",
  subLeader: "6名のチームで",
  ledgerDesign: "Proposed and designed a double-entry",
  ledgerBuild: "Built the ledger service in Go",
  ledgerMigration: "Ran a three-phase migration",
  breaks: "Reduced reconciliation breaks",
  close: "Shortened month-end close",
  p95: "Point-in-time balance queries",
  payouts: "The ledger design became the template",
  runbook: "Wrote the runbook and trained",
  ledgerAws: "Deployed on AWS ECS and RDS",
  fraudTeam: "Led a team of three building a fraud",
  fraudLang: "Designed a versioned JSON condition language",
  shadow: "Introduced shadow mode",
  ruleSpeed: "Cut the time to ship a fraud rule",
  chargeback: "Reduced the chargeback rate",
  fraudScale: "The engine evaluates about 1,200",
  squad: "Led the five-engineer checkout squad",
  budget: "Set a 170 KB checkout bundle budget",
  ssr: "Moved checkout to streamed server-side rendering",
  synthetic: "Introduced synthetic monitoring",
  tti: "Cut checkout time to interactive",
  abandonment: "Reduced mobile checkout abandonment",
  budgetAdopted: "The performance budget was adopted",
  bff: "Built the checkout backend-for-frontend",
  evalSet: "Built an offline search evaluation set",
  ltr: "Moved search ranking to learning-to-rank",
  bigQuery: "Built the nightly BigQuery and Dataflow",
  guild: "Co-founded the frontend guild",
  twelve: "Twelve teams adopted the design system",
  hackathon: "Organised the company's first internal hackathon",
  aks: "Led a team of four migrating the platform",
  iac: "Defined infrastructure in Terraform, packaged",
  split: "Moved the booking API behind a traffic split",
  slo: "Set up service-level objectives",
  services23: "Moved all 23 services to AKS",
  deploys: "Raised deployment frequency",
  cost: "Reduced infrastructure cost by 28%",
  clinical: "Designed a clinical data pipeline",
  reports: "Automated monthly clinic reports",
  noShow: "The no-show report led to a reminder",
  mentor: "Interviews backend and platform candidates",
  oncall: "Ran the platform team's on-call rotation",
  ladder: "Wrote the engineering career ladder",
  kanjigrid: "Wrote kanjigrid, a TypeScript library",
  stars: "kanjigrid has about 1,400 GitHub stars",
  contributors: "Twenty-six people have contributed",
  talk: "Spoke about vertical text on the web",
} as const;

type Cite = (typeof F)[keyof typeof F];

interface Line {
  kind: BlockKind;
  text: string;
  cites: readonly Cite[];
}

const para = (text: string, ...cites: Cite[]): Line => ({ kind: "paragraph", text, cites });
const bullet = (text: string, ...cites: Cite[]): Line => ({ kind: "bullet", text, cites });
const row = (text: string, ...cites: Cite[]): Line => ({ kind: "row", text, cites });

type EmployerKey = "hokushin" | "minatopay" | "kestrel" | "solaris";

/* ------------------------------------------------------------ the résumé */

const RESUME_SUMMARY = para(
  "Backend and platform engineer who rebuilds systems that cannot stop. Moved 23 services to Kubernetes with no unplanned downtime, cut payment reconciliation breaks from 37 a quarter to 2, and cut mobile checkout load time from 6.8 s to 2.9 s.",
  F.services23, F.breaks, F.tti,
);

const RESUME: Record<EmployerKey, Line[]> = {
  solaris: [
    bullet("Led a team of four migrating the platform from hand-managed VMs to Azure Kubernetes Service, moving all 23 services over nine months with no unplanned downtime.", F.aks, F.services23),
    bullet("Defined infrastructure in Terraform, Helm and Argo CD, and moved the booking API behind a traffic split that sent 5% of requests to the new cluster first.", F.iac, F.split),
    bullet("Raised deployment frequency from fortnightly to several times a day and cut the rollback rate from one in five releases to under one in twenty.", F.deploys),
    bullet("Reduced infrastructure cost by 28% by rightsizing and moving batch work to spot node pools.", F.cost),
    bullet("Designed a clinical data pipeline to Azure Data Lake, dbt and Power BI with pseudonymised patient identifiers, automating monthly reports that took an analyst three days.", F.clinical, F.reports),
  ],
  kestrel: [
    bullet("Led the five-engineer checkout squad as tech lead, cutting time to interactive on a mid-range phone from 6.8 s to 2.9 s with streamed server-side rendering.", F.squad, F.tti, F.ssr),
    bullet("Reduced mobile checkout abandonment from 31% to 22%, valued at about ¥140 million in annual GMV.", F.abandonment),
    bullet("Set a 170 KB checkout bundle budget enforced in CI, later adopted by two other squads.", F.budget, F.budgetAdopted),
    bullet("Moved search ranking to learning-to-rank, raising search conversion by 9% in a four-week A/B test against an offline set built from six months of logs.", F.ltr, F.evalSet),
    bullet("Co-founded the frontend guild and replaced three component libraries with one design system, adopted by twelve teams within a year.", F.guild, F.twelve),
  ],
  minatopay: [
    bullet("Designed a double-entry, append-only payments ledger in Go, PostgreSQL and Kafka, cutting reconciliation breaks from 37 a quarter to 2 and month-end close from five working days to two.", F.ledgerDesign, F.ledgerBuild, F.breaks, F.close),
    bullet("Ran a three-phase migration with six weeks of dual-write, cutting over after 21 clean days; balance queries return in under 200 ms at p95.", F.ledgerMigration, F.p95),
    bullet("Led a team of three building a fraud rules engine in Kotlin, cutting rule changes from about a week to the same day and chargebacks from 0.42% to 0.18%.", F.fraudTeam, F.fraudLang, F.ruleSpeed, F.chargeback),
  ],
  hokushin: [
    bullet("Ported 62 aggregation jobs from COBOL to Java (Spring Batch) with Oracle partitioning, moving month-end batch completion from 5:40 to 3:10 on average.", F.batchPort, F.monthEnd),
    bullet("Built an automated output-comparison tool, reused on two later migrations; batch-caused online delays stayed at 0 for six months after cut-over.", F.verifyTool, F.reused, F.zeroDelay),
  ],
};

const RESUME_PROJECTS: Record<string, Line[]> = {
  kanjigrid: [
    bullet("Wrote kanjigrid, a TypeScript library for vertical Japanese text layout with kinsoku line-breaking and ruby, with about 1,400 GitHub stars and 9,000 weekly npm downloads.", F.kanjigrid, F.stars),
    bullet("Merged pull requests from 26 contributors and spoke about vertical text on the web at a Tokyo JavaScript meetup in 2023.", F.contributors, F.talk),
  ],
};

/** The résumé written toward the platform posting: platform work first, the rest cut to its budget. */
const TAILORED_SUMMARY = para(
  "Platform engineer who leads migrations end to end: moved 23 services from hand-managed VMs to Azure Kubernetes Service in nine months with no unplanned downtime, set service-level objectives with product teams, and cut infrastructure cost by 28%.",
  F.aks, F.services23, F.slo, F.cost,
);

const TAILORED: Record<EmployerKey, Line[]> = {
  solaris: [
    bullet("Led a team of four migrating the platform from hand-managed VMs to Azure Kubernetes Service, moving all 23 services over nine months with no unplanned downtime.", F.aks, F.services23),
    bullet("Defined infrastructure in Terraform, packaged services with Helm and deployed through Argo CD, sending 5% of booking API traffic to the new cluster first.", F.iac, F.split),
    bullet("Set up service-level objectives with Azure Monitor and Grafana and wrote the incident process; rollbacks fell from one in five releases to under one in twenty.", F.slo, F.deploys),
    bullet("Reduced infrastructure cost by 28% by rightsizing and moving batch work to spot node pools.", F.cost),
    bullet("Interviewed backend and platform candidates, mentored two mid-level engineers and moved on-call from one person a week to a follow-the-sun pair.", F.mentor, F.oncall),
  ],
  kestrel: [
    bullet("Led the five-engineer checkout squad as tech lead, cutting time to interactive on a mid-range phone from 6.8 s to 2.9 s with streamed server-side rendering.", F.squad, F.tti, F.ssr),
    bullet("Set a 170 KB checkout bundle budget enforced in CI with synthetic monitoring on a throttled device, later adopted by two other squads.", F.budget, F.synthetic, F.budgetAdopted),
    bullet("Reduced mobile checkout abandonment from 31% to 22%, valued at about ¥140 million in annual GMV.", F.abandonment),
    bullet("Co-founded the frontend guild and replaced three component libraries with one design system, adopted by twelve teams within a year.", F.guild, F.twelve),
  ],
  minatopay: [
    bullet("Designed an append-only payments ledger in Go, PostgreSQL and Kafka and migrated to it in three phases, cutting over after 21 clean days; reconciliation breaks fell from 37 a quarter to 2.", F.ledgerDesign, F.ledgerBuild, F.ledgerMigration, F.breaks),
    bullet("Led a team of three building a fraud rules engine in Kotlin, cutting rule changes from about a week to the same day and chargebacks from 0.42% to 0.18%.", F.fraudTeam, F.fraudLang, F.ruleSpeed, F.chargeback),
  ],
  hokushin: [
    bullet("Ported 62 aggregation jobs from COBOL to Java (Spring Batch) with Oracle partitioning, moving month-end batch completion from 5:40 to 3:10 on average.", F.batchPort, F.monthEnd),
  ],
};

const TAILORED_PROJECTS: Record<string, Line[]> = {
  kanjigrid: [
    bullet("Wrote kanjigrid, a TypeScript library for vertical Japanese text layout, with about 1,400 GitHub stars and 9,000 weekly npm downloads.", F.kanjigrid, F.stars),
  ],
};

/* ------------------------------------------------------------- the 履歴書 */

const MOTIVATION = [
  para("決済、EC、医療の各領域で、止められないシステムを動かしたまま作り替える仕事を続けてきました。直近では4名のチームを率い、23のサービスを9か月で計画外の停止なく Azure Kubernetes Service へ移行しました。", F.aks, F.services23),
  para("切替の判断は数値で行います。決済元帳の刷新では21日間差分がないことを確かめてから切り替え、照合差異を四半期37件から2件に減らしました。", F.ledgerMigration, F.breaks),
  para("特技は日本語の縦書き組版で、公開しているライブラリは GitHub で約1,400のスターを得ています。", F.kanjigrid, F.stars),
];

/* ----------------------------------------------------------- the 職務経歴書 */

const SHOKUMU_SUMMARY = para(
  "2015年に金融機関向けの受託開発企業でキャリアを始め、決済、EC、ヘルスケアの事業会社でバックエンドとプラットフォームの開発に携わってきました。直近では23のサービスを Azure Kubernetes Service へ計画外の停止なく移行し、前職ではモバイルの決済画面が操作可能になるまでの時間を6.8秒から2.9秒に短縮しました。既存のシステムを止めずに段階的に作り替え、結果を数値で確かめる進め方を強みとしています。",
  F.services23, F.tti,
);

/** What each curated group's paragraph says the skills are used for, by the group's English name. */
const SKILL_USE: Record<string, string> = {
  Languages: "を用いたバックエンドの設計・開発",
  "Cloud and platform": "による基盤の構築・移行・運用",
  Data: "によるデータ基盤と検索の構築",
  Frontend: "による Web フロントエンドの開発と性能改善",
};

interface ShokumuBullet extends Line {
  /** The project it sits under, by its key in `./fixture.ts`; none puts it under 主な実績. */
  project?: string;
}

const inProject = (project: string, line: Line): ShokumuBullet => ({ ...line, project });

const SHOKUMU: Record<EmployerKey, ShokumuBullet[]> = {
  solaris: [
    bullet("4名のチームを率い、手作業管理のVMから Azure Kubernetes Service へ全23サービスを9か月で移行、計画外停止なし", F.aks, F.services23),
    bullet("Terraform、Helm、Argo CD による構成管理とデプロイを整備し、予約APIはトラフィック分割で5%から段階移行", F.iac, F.split),
    bullet("デプロイ頻度を2週間に1回から1日数回へ向上、ロールバック率を5回に1回から20回に1回未満へ低減", F.deploys),
    bullet("ノードの適正化とバッチ処理のスポットノードプール移行により、インフラコストを28%削減", F.cost),
    bullet("Azure Monitor と Grafana でSLOを設定し、チームのインシデント対応プロセスを策定", F.slo),
    bullet("予約イベントから Azure Data Lake、dbt、Power BI への臨床データ基盤を設計し、分析担当者が毎月3日かけていたレポートを自動化", F.clinical, F.reports),
    bullet("無断キャンセルのレポートを起点にリマインド機能を実現し、無断キャンセルを17%削減", F.noShow),
    bullet("オンコールを週1名の当番から時差を活かした2名体制へ再設計", F.oncall),
    bullet("プラットフォーム職のキャリアラダーを策定し、全社で採用", F.ladder),
    bullet("バックエンド・プラットフォーム職の採用面接と、中堅エンジニア2名のメンタリングを担当", F.mentor),
  ],
  kestrel: [
    inProject("kestrel-checkout", bullet("5名のチェックアウトチームをテックリードとして統括", F.squad)),
    inProject("kestrel-checkout", bullet("ストリーミングSSRと決済SDKの遅延読み込みにより、中価格帯スマートフォンで操作可能になるまでの時間を6.8秒から2.9秒に短縮", F.ssr, F.tti)),
    inProject("kestrel-checkout", bullet("モバイル決済の離脱率を31%から22%に改善、年間流通総額で約1億4,000万円相当", F.abandonment)),
    inProject("kestrel-checkout", bullet("170 KBのバンドル予算をCIで強制し、他の2チームにも採用", F.budget, F.budgetAdopted)),
    inProject("kestrel-checkout", bullet("低速端末プロファイルでの合成監視を導入し、性能劣化をマージ当日に検知", F.synthetic)),
    inProject("kestrel-checkout", bullet("Node.js と GraphQL による決済画面のBFFを Cloud Run 上に構築", F.bff)),
    bullet("6か月分のログからオフライン検索評価セットを構築し、ランキングを learning-to-rank に移行、4週間のA/Bテストで検索経由のコンバージョンを9%改善", F.evalSet, F.ltr),
    bullet("BigQuery と Dataflow による夜間パイプラインを構築し、検索評価セットを自動更新", F.bigQuery),
    bullet("フロントエンドギルドを共同設立し、3つのコンポーネントライブラリを1つのデザインシステムに統合、1年で12チームが採用", F.guild, F.twelve),
    bullet("社内初のハッカソンを企画し、60名が参加", F.hackathon),
  ],
  minatopay: [
    inProject("minatopay-ledger", bullet("複式・追記型の決済元帳を提案・設計し、Go と PostgreSQL で Kafka の決済イベントを冪等に取り込むサービスを構築", F.ledgerDesign, F.ledgerBuild)),
    inProject("minatopay-ledger", bullet("6週間の二重書き込みと夜間比較を経て、21日間連続で差分がないことを確認してから切替", F.ledgerMigration)),
    inProject("minatopay-ledger", bullet("照合差異を四半期37件から2件に、月次決算を5営業日から2営業日に短縮", F.breaks, F.close)),
    inProject("minatopay-ledger", bullet("時点残高の照会をp95で200 ms未満で応答", F.p95)),
    inProject("minatopay-ledger", bullet("元帳の設計が支払元帳のテンプレートとして採用", F.payouts)),
    inProject("minatopay-ledger", bullet("運用手順書を整備し、オンコール担当2名に引き継ぎ", F.runbook)),
    inProject("minatopay-ledger", bullet("AWS ECS と RDS 上に Terraform で基盤を構築", F.ledgerAws)),
    inProject("minatopay-fraud", bullet("3名のチームを率い、リスク管理チームがデプロイなしで編集できる不正検知ルールエンジンを開発", F.fraudTeam)),
    inProject("minatopay-fraud", bullet("バージョン管理されたJSON条件言語を設計し、Kotlin のサービスで50 ms以内に評価", F.fraudLang)),
    inProject("minatopay-fraud", bullet("すべてのルール変更を本番トラフィックで事前評価するシャドーモードを導入", F.shadow)),
    inProject("minatopay-fraud", bullet("ルール変更のリードタイムを約1週間から当日に短縮", F.ruleSpeed)),
    inProject("minatopay-fraud", bullet("チャージバック率を2四半期で0.42%から0.18%に低減", F.chargeback)),
    inProject("minatopay-fraud", bullet("ピーク時毎秒約1,200件の決済をp99 18 msで評価", F.fraudScale)),
  ],
  hokushin: [
    inProject("hokushin-batch", bullet("夜間バッチ約480本の依存関係を JP1 から抽出し、並列実行可能なジョブが約3割あることを特定", F.batchJobs)),
    inProject("hokushin-batch", bullet("集計系ジョブ62本を COBOL から Java（Spring Batch）に移植し、Oracle のパーティション表で並列化", F.batchPort)),
    inProject("hokushin-batch", bullet("旧ジョブとの出力差分を自動で突き合わせる検証ツールを作成し、他の2つの移植案件でも再利用", F.verifyTool, F.reused)),
    inProject("hokushin-batch", bullet("月末バッチの終了時刻を平均5時40分から3時10分に短縮、切替後6か月間のオンライン開始遅延は0件", F.monthEnd, F.zeroDelay)),
    inProject("hokushin-batch", bullet("6名のチームでサブリーダーとして新人2名を指導", F.subLeader)),
  ],
};

const SELF_PR = [
  para("一貫して取り組んできたのは、止められないシステムを止めずに作り替えることです。決済元帳の刷新では、6週間の二重書き込みと夜間比較で新旧の残高を突き合わせ、21日間差分がないことを確認してから切り替えました。照合差異は四半期37件から2件に減りました。", F.ledgerMigration, F.breaks),
  para("同じ進め方をプラットフォームでも続けています。予約APIは5%のトラフィックから新しいクラスタへ流し、23のサービスを9か月で計画外の停止なく Azure Kubernetes Service へ移しました。デプロイは2週間に1回から1日数回になり、ロールバック率は5回に1回から20回に1回未満に下がりました。", F.split, F.services23, F.deploys),
  para("チームづくりにも力を入れています。フロントエンドギルドを共同で立ち上げてデザインシステムを1つにまとめ、1年で12チームに採用されました。現在は採用面接と中堅エンジニア2名のメンタリングを担当しています。今後も、事業を止めずに基盤を作り替える役割で貢献したいと考えています。", F.guild, F.twelve, F.mentor),
];

/* ------------------------------------------------------ the career stories */

interface Chapter {
  heading: string;
  lines: Line[];
}

interface Story {
  opening: Chapter;
  employers: Record<EmployerKey, Chapter>;
  independent: Chapter;
  ahead: Chapter;
  anchorsHeading: string;
  /** Each employer's figures, after the name and dates the record supplies. */
  anchors: Record<EmployerKey, Line>;
  /** The rows after the employers': independent work, and anything else asked about in numbers. */
  anchorsAfter: Line[];
  routingHeading: string;
  routing: Line[];
  /** The routing row a gap gets, from its months and its explanation. */
  gapRow: (gap: RenderSpec["careerGaps"][number]) => Line;
}

const EN_HEADINGS: Record<EmployerKey, string> = {
  hokushin: "Hokushin Systems Co., Ltd.: a bank's overnight jobs",
  minatopay: "MinatoPay Inc.: money that has to add up",
  kestrel: "Kestrel Commerce K.K.: checkout, search and a guild",
  solaris: "Solaris Health Inc.: the platform under the clinics",
};

const STORY_EN: Story = {
  opening: {
    heading: "Where it started",
    lines: [
      para("My career has been about one kind of problem: replacing a system that cannot stop while it keeps running. A bank's night batch, a payments ledger, a checkout and a clinic platform were each rebuilt in place, and each cut-over waited until a comparison or a measurement said it was safe.", F.ledgerMigration, F.services23),
      para("Outside work the same interest runs through kanjigrid, a library for vertical Japanese text, which is how I learned to maintain something used by people I will never meet.", F.kanjigrid),
    ],
  },
  employers: {
    hokushin: {
      heading: EN_HEADINGS.hokushin,
      lines: [
        para("I joined Hokushin Systems Co., Ltd., a systems integrator for financial institutions, as a programmer in April 2015 and worked on a regional bank's night batch. I mapped the dependencies of about 480 jobs from the JP1 job nets and found that about 30% of them could run in parallel.", F.batchJobs),
        para("We ported 62 aggregation jobs from COBOL to Java on Spring Batch and parallelised them with Oracle partitioned tables. I built the tool that compared old and new output automatically, and month-end batch completion moved from 5:40 to 3:10 on average, with no batch-caused delay to the online start in the six months after cut-over.", F.batchPort, F.verifyTool, F.monthEnd, F.zeroDelay),
        para("The comparison tool was reused on two later migrations. From April 2016 I was sub-leader in a team of six, training two new hires, and I left in March 2017 to work for a product company.", F.reused, F.subLeader),
      ],
    },
    minatopay: {
      heading: EN_HEADINGS.minatopay,
      lines: [
        para("I joined MinatoPay Inc., a payments company for small online merchants, as a backend engineer in April 2017. The ledger was a table updated in place by several services, and finance reconciled it by hand. I proposed a double-entry, append-only ledger, the team adopted it, and I built the service in Go on PostgreSQL, consuming payment events from Kafka with idempotent writes.", F.ledgerDesign, F.ledgerBuild),
        para("The migration ran in three phases: six weeks of dual-write, a nightly comparison job, and a cut-over after 21 clean days. Reconciliation breaks fell from 37 a quarter to 2, month-end close went from five working days to two, and point-in-time balance queries return in under 200 ms at p95.", F.ledgerMigration, F.breaks, F.close, F.p95),
        para("The design became the template for the payouts ledger. The service ran on AWS ECS and RDS with its infrastructure in Terraform, and I wrote the runbook and trained two on-call engineers to take it over.", F.payouts, F.ledgerAws, F.runbook),
        para("As a senior engineer I then led a team of three building a fraud rules engine the risk team could edit without a deploy: a versioned JSON condition language evaluated by a Kotlin service within a 50 ms budget, with shadow mode so every change ran on live traffic first.", F.fraudTeam, F.fraudLang, F.shadow),
        para("Rule changes went from about a week to the same day, and the chargeback rate fell from 0.42% to 0.18% over two quarters. At peak the engine evaluates about 1,200 payments per second with 18 ms p99 latency. I left in June 2020 to work on a consumer product.", F.ruleSpeed, F.chargeback, F.fraudScale),
      ],
    },
    kestrel: {
      heading: EN_HEADINGS.kestrel,
      lines: [
        para("I joined Kestrel Commerce K.K., a marketplace for independent fashion brands, as a senior software engineer in July 2020, and became tech lead of the five-engineer checkout squad in April 2021. On a mid-range phone, checkout took 6.8 s to become interactive.", F.squad, F.tti),
        para("We moved checkout to streamed server-side rendering, lazy-loaded the payment SDK and set a 170 KB bundle budget enforced in CI, with synthetic monitoring on a throttled device to catch regressions the day they merged. Time to interactive fell to 2.9 s, mobile abandonment from 31% to 22%, worth about ¥140 million a year in GMV, and two other squads adopted the budget.", F.ssr, F.budget, F.synthetic, F.tti, F.abandonment, F.budgetAdopted),
        para("I built the checkout backend-for-frontend in Node.js and GraphQL on Cloud Run. On search, I built an offline evaluation set from six months of logs, kept fresh by a nightly BigQuery and Dataflow pipeline, and moved ranking to learning-to-rank; a four-week A/B test showed search conversion up 9%.", F.bff, F.evalSet, F.bigQuery, F.ltr),
        para("I co-founded the frontend guild and led the replacement of three component libraries with one design system, which twelve teams adopted within a year, and organised the company's first internal hackathon, with 60 participants. I left in September 2023.", F.guild, F.twelve, F.hackathon),
      ],
    },
    solaris: {
      heading: EN_HEADINGS.solaris,
      lines: [
        para("After three months for a family move and the job search, I joined Solaris Health Inc., which provides booking, records and patient apps to clinics, as staff engineer for the platform in January 2024. I led a team of four moving the platform from hand-managed VMs to Azure Kubernetes Service, defined in Terraform, packaged with Helm and deployed through Argo CD.", F.aks, F.iac),
        para("The booking API went last and went carefully, with 5% of its requests sent to the new cluster first. All 23 services moved over nine months with no unplanned downtime. Deployments went from fortnightly to several times a day, and the rollback rate from one in five to under one in twenty.", F.split, F.services23, F.deploys),
        para("Rightsizing and spot node pools for batch work cut infrastructure cost by 28%. I set up service-level objectives with Azure Monitor and Grafana, wrote the incident process, and redesigned on-call from one person a week to a follow-the-sun pair.", F.cost, F.slo, F.oncall),
        para("I designed the clinical data pipeline from booking events to Azure Data Lake, dbt and Power BI, with patient identifiers pseudonymised. It automated monthly clinic reports that had taken an analyst three days, and the no-show report led to a reminder feature that cut no-shows by 17%.", F.clinical, F.reports, F.noShow),
        para("I interview backend and platform candidates, mentor two mid-level engineers, and wrote the platform career ladder the company adopted.", F.mentor, F.ladder),
      ],
    },
  },
  independent: {
    heading: "kanjigrid: work outside employment",
    lines: [
      para("kanjigrid is a TypeScript library I wrote for vertical Japanese text layout in the browser, with kinsoku line-breaking and ruby. It has about 1,400 GitHub stars and 9,000 weekly npm downloads, and 26 people have contributed merged pull requests.", F.kanjigrid, F.stars, F.contributors),
      para("In 2023 I spoke about vertical text on the web at a Tokyo JavaScript meetup. It is the one place where I set the direction alone, review strangers' code and answer for every decision in public.", F.talk),
    ],
  },
  ahead: {
    heading: "What comes next",
    lines: [
      para("I am looking for a staff engineer role in backend or platform work, in Tokyo with hybrid working. The record argues for platform work that changes how product teams ship: the migration, the service-level objectives and the career ladder are the parts I would choose to do again.", F.services23, F.slo, F.ladder),
    ],
  },
  anchorsHeading: "Figures to defend",
  anchors: {
    hokushin: row("about 480 jobs mapped, 62 ported; month-end finish 5:40 to 3:10; 0 online delays in 6 months", F.batchJobs, F.batchPort, F.monthEnd, F.zeroDelay),
    minatopay: row("breaks 37 to 2 a quarter; close 5 to 2 working days; under 200 ms at p95; chargebacks 0.42% to 0.18%; 1,200 payments a second at 18 ms p99", F.breaks, F.close, F.p95, F.chargeback, F.fraudScale),
    kestrel: row("time to interactive 6.8 s to 2.9 s; abandonment 31% to 22%, about ¥140 million; 170 KB budget; search conversion up 9%; twelve teams on the design system", F.tti, F.abandonment, F.budget, F.ltr, F.twelve),
    solaris: row("23 services in nine months, no unplanned downtime; rollbacks one in five to under one in twenty; cost down 28%; no-shows down 17%", F.services23, F.deploys, F.cost, F.noShow),
  },
  anchorsAfter: [row("kanjigrid: about 1,400 stars, 9,000 weekly downloads, 26 contributors", F.stars, F.contributors)],
  routingHeading: "Questions and where they land",
  routing: [
    row(`Walk me through a migration you led from start to finish. → ${EN_HEADINGS.solaris} · 23 services in nine months`, F.services23, F.aks),
    row(`How did you decide the order in which services moved? → ${EN_HEADINGS.solaris} · the booking API last, 5% first`, F.split),
    row(`How did you measure the rollback rate before and after? → ${EN_HEADINGS.solaris} · one in five to under one in twenty`, F.deploys),
    row(`How do you set an SLO with a product team that has never had one? → ${EN_HEADINGS.solaris} · Azure Monitor, Grafana and the incident process`, F.slo),
    row(`Where did the 28% cost saving come from? → ${EN_HEADINGS.solaris} · rightsizing and spot node pools`, F.cost),
    row(`How did you know the new ledger was right before cutting over? → ${EN_HEADINGS.minatopay} · 21 clean days of nightly comparison`, F.ledgerMigration),
    row(`What did the ledger change for finance? → ${EN_HEADINGS.minatopay} · breaks 37 to 2, close five days to two`, F.breaks, F.close),
    row(`How did the risk team change rules without a deploy? → ${EN_HEADINGS.minatopay} · the JSON condition language and shadow mode`, F.fraudLang, F.shadow),
    row(`What did the checkout work change for the business? → ${EN_HEADINGS.kestrel} · abandonment 31% to 22%`, F.abandonment),
    row(`How did you stop checkout getting slow again? → ${EN_HEADINGS.kestrel} · the 170 KB budget and synthetic monitoring`, F.budget, F.synthetic),
    row(`How did you get other teams to adopt your work? → ${EN_HEADINGS.kestrel} · two squads took the budget, twelve teams the design system`, F.budgetAdopted, F.twelve),
    row(`How did you prove a ported batch job was correct? → ${EN_HEADINGS.hokushin} · the output comparison tool`, F.verifyTool, F.reused),
    row(`How do you grow other engineers? → ${EN_HEADINGS.solaris} · two mentees and the career ladder`, F.mentor, F.ladder),
    row(`Why did you leave each company? → the last paragraph of each employer's chapter`),
    row(`What do you do outside work? → kanjigrid: work outside employment · 26 contributors`, F.contributors),
    row(`What are you looking for next? → What comes next`),
  ],
  gapRow: (gap) =>
    row(`What were you doing from ${gapMonthsEn(gap)}? → ${EN_HEADINGS.solaris} · ${gap.explanation === null ? "no note on the record yet" : "a family move and the job search, as the record's note says"}`),
};

const JA_HEADINGS: Record<EmployerKey, string> = {
  hokushin: "株式会社北辰システムズ：夜間バッチの刷新",
  minatopay: "株式会社ミナトペイ：合わなければならないお金",
  kestrel: "ケストレルコマース株式会社：決済画面、検索、ギルド",
  solaris: "株式会社ソラリスヘルス：クリニックを支える基盤",
};

const STORY_JA: Story = {
  opening: {
    heading: "止めずに作り替える",
    lines: [
      para("私のキャリアは、止められないシステムを動かしたまま作り替える仕事の連続でした。銀行の夜間バッチ、決済元帳、ECの決済画面、クリニック向けの基盤と対象は変わりましたが、切り替えるのはいつも比較や計測で安全を確かめてからでした。", F.ledgerMigration, F.services23),
      para("仕事の外では、日本語の縦書きを組版するライブラリ kanjigrid を公開しています。使う人の顔が見えないものを保守し続ける経験は、ここで身につきました。", F.kanjigrid),
    ],
  },
  employers: {
    hokushin: {
      heading: JA_HEADINGS.hokushin,
      lines: [
        para("2015年4月、金融機関向けの受託開発を行う株式会社北辰システムズにプログラマーとして入社し、地方銀行の夜間バッチを担当しました。約480本のジョブの依存関係を JP1 のジョブネットから抽出して一覧化し、約3割のジョブが並列実行できることを突き止めました。", F.batchJobs),
        para("集計系ジョブ62本を COBOL から Java（Spring Batch）へ移植し、Oracle のパーティション表で並列化しました。旧ジョブとの出力差分を自動で突き合わせる検証ツールを作り、月末バッチの終了時刻は平均5時40分から3時10分になりました。切替後6か月間、バッチ起因のオンライン開始遅延は0件でした。", F.batchPort, F.verifyTool, F.monthEnd, F.zeroDelay),
        para("検証ツールはその後、他の2つの移植案件でも使われました。2016年4月からは6名のチームのサブリーダーとして新人2名を指導し、2017年3月に退職しました。", F.reused, F.subLeader),
      ],
    },
    minatopay: {
      heading: JA_HEADINGS.minatopay,
      lines: [
        para("2017年4月、中小規模のEC事業者向けに決済サービスを提供する株式会社ミナトペイにバックエンドエンジニアとして入社しました。残高は複数のサービスが上書き更新するテーブルで管理され、経理が月末に手作業で照合していました。そこで複式・追記型の元帳を提案し、採用された設計を Go と PostgreSQL で実装して、Kafka の決済イベントを冪等に取り込むようにしました。", F.ledgerDesign, F.ledgerBuild),
        para("移行は3段階で進めました。6週間の二重書き込み、夜間の比較ジョブ、そして21日間差分がないことを確認してからの切替です。照合差異は四半期37件から2件に、月次決算は5営業日から2営業日になり、時点残高の照会はp95で200 ms未満で返ります。", F.ledgerMigration, F.breaks, F.close, F.p95),
        para("この設計は支払元帳のテンプレートにもなりました。基盤は AWS ECS と RDS で、構成は Terraform で管理しました。運用手順書を書き、オンコール担当2名に引き継ぎました。", F.payouts, F.ledgerAws, F.runbook),
        para("シニアエンジニアになってからは、3名のチームを率いて不正検知ルールエンジンを作りました。リスク管理チームがデプロイなしで編集できる、バージョン管理されたJSON条件言語を Kotlin のサービスが50 ms以内で評価し、ルール変更はシャドーモードで本番トラフィックに当ててから有効にします。", F.fraudTeam, F.fraudLang, F.shadow),
        para("ルール変更は約1週間から当日にまで短くなり、チャージバック率は2四半期で0.42%から0.18%に下がりました。ピーク時には毎秒約1,200件の決済をp99 18 msで評価しています。2020年6月に退職しました。", F.ruleSpeed, F.chargeback, F.fraudScale),
      ],
    },
    kestrel: {
      heading: JA_HEADINGS.kestrel,
      lines: [
        para("2020年7月、独立系ファッションブランド向けのマーケットプレイスを運営するケストレルコマース株式会社に入社し、2021年4月からは5名のチェックアウトチームのテックリードを務めました。中価格帯のスマートフォンでは、決済画面が操作可能になるまで6.8秒かかっていました。", F.squad, F.tti),
        para("決済画面をストリーミングSSRに移し、決済SDKを遅延読み込みにして、170 KBのバンドル予算をCIで強制しました。低速端末での合成監視で、劣化はマージ当日に見つかります。操作可能までの時間は2.9秒になり、モバイルの離脱率は31%から22%に下がりました。年間流通総額で約1億4,000万円に相当し、予算は他の2チームにも採用されました。", F.ssr, F.budget, F.synthetic, F.tti, F.abandonment, F.budgetAdopted),
        para("決済画面のBFFは Node.js と GraphQL で Cloud Run 上に作りました。検索では6か月分のログからオフライン評価セットを作り、BigQuery と Dataflow の夜間パイプラインで更新して、ランキングを learning-to-rank に移しました。4週間のA/Bテストで、検索経由のコンバージョンは9%上がりました。", F.bff, F.evalSet, F.bigQuery, F.ltr),
        para("フロントエンドギルドを共同で立ち上げ、3つのコンポーネントライブラリを1つのデザインシステムにまとめ、1年で12チームに採用されました。社内初のハッカソンも企画し、60名が参加しました。2023年9月に退職しました。", F.guild, F.twelve, F.hackathon),
      ],
    },
    solaris: {
      heading: JA_HEADINGS.solaris,
      lines: [
        para("家族の転居と転職活動のための3か月を経て、2024年1月、クリニック向けに予約・電子カルテ・患者アプリを提供する株式会社ソラリスヘルスにプラットフォーム担当のスタッフエンジニアとして入社しました。4名のチームを率い、手作業で管理していたVMから Azure Kubernetes Service へ基盤を移しました。構成は Terraform、Helm、Argo CD で管理しています。", F.aks, F.iac),
        para("予約APIは最後に、まず5%のリクエストだけを新しいクラスタに流しました。23のサービスすべてを9か月で計画外の停止なく移し、デプロイは2週間に1回から1日数回に、ロールバック率は5回に1回から20回に1回未満になりました。", F.split, F.services23, F.deploys),
        para("ノードの適正化とバッチ処理のスポットノードプール移行で、インフラコストを28%削減しました。Azure Monitor と Grafana でSLOを設定してインシデント対応の手順を書き、オンコールを週1名の当番から時差を活かした2名体制に変えました。", F.cost, F.slo, F.oncall),
        para("予約イベントから Azure Data Lake、dbt、Power BI へ流れる臨床データ基盤も設計し、患者識別子は仮名化しました。分析担当者が毎月3日かけていたレポートは自動化され、無断キャンセルのレポートから生まれたリマインド機能で無断キャンセルは17%減りました。", F.clinical, F.reports, F.noShow),
        para("現在はバックエンドとプラットフォームの採用面接を担当し、中堅エンジニア2名をメンタリングしています。プラットフォーム職のキャリアラダーも書き、全社で採用されました。", F.mentor, F.ladder),
      ],
    },
  },
  independent: {
    heading: "kanjigrid：仕事の外で作ったもの",
    lines: [
      para("kanjigrid は、ブラウザで日本語の縦書きを組版する TypeScript のライブラリで、禁則処理とルビに対応しています。GitHub で約1,400のスターを得て、npm では週に約9,000回ダウンロードされ、26人がプルリクエストをマージしてくれました。", F.kanjigrid, F.stars, F.contributors),
      para("2023年には東京の JavaScript の勉強会で、縦書きについて話しました。方向を一人で決め、知らない人のコードをレビューし、すべての判断に公開の場で責任を持つ場所です。", F.talk),
    ],
  },
  ahead: {
    heading: "これから",
    lines: [
      para("次は、バックエンドまたはプラットフォーム領域のスタッフエンジニアとして、東京でハイブリッド勤務ができる職場を考えています。移行、SLO、キャリアラダーのように、プロダクトチームの開発の仕方そのものを変える仕事を続けたいと思っています。", F.services23, F.slo, F.ladder),
    ],
  },
  anchorsHeading: "数字の確認表",
  anchors: {
    hokushin: row("ジョブ約480本を一覧化、62本を移植、月末終了5時40分→3時10分、6か月間遅延0件", F.batchJobs, F.batchPort, F.monthEnd, F.zeroDelay),
    minatopay: row("照合差異37件→2件、月次決算5営業日→2営業日、p95で200 ms未満、チャージバック率0.42%→0.18%、毎秒約1,200件をp99 18 ms", F.breaks, F.close, F.p95, F.chargeback, F.fraudScale),
    kestrel: row("操作可能まで6.8秒→2.9秒、離脱率31%→22%（約1億4,000万円）、予算170 KB、検索コンバージョン9%改善、12チームが採用", F.tti, F.abandonment, F.budget, F.ltr, F.twelve),
    solaris: row("23サービスを9か月で移行・計画外停止なし、ロールバック率5回に1回→20回に1回未満、コスト28%削減、無断キャンセル17%減", F.services23, F.deploys, F.cost, F.noShow),
  },
  anchorsAfter: [row("kanjigrid：スター約1,400、週約9,000ダウンロード、貢献者26人", F.stars, F.contributors)],
  routingHeading: "想定質問と答える章",
  routing: [
    row(`主導した移行を最初から最後まで説明してください → ${JA_HEADINGS.solaris}・23サービスを9か月`, F.services23, F.aks),
    row(`移行するサービスの順番はどう決めましたか → ${JA_HEADINGS.solaris}・予約APIは最後に5%から`, F.split),
    row(`ロールバック率は前後でどう測りましたか → ${JA_HEADINGS.solaris}・5回に1回から20回に1回未満`, F.deploys),
    row(`SLOを持ったことのないチームとどう合意しますか → ${JA_HEADINGS.solaris}・Azure Monitor、Grafana、インシデント対応`, F.slo),
    row(`28%のコスト削減は何によるものですか → ${JA_HEADINGS.solaris}・ノードの適正化とスポットノードプール`, F.cost),
    row(`新しい元帳が正しいと切替前にどう確かめましたか → ${JA_HEADINGS.minatopay}・21日間の夜間比較`, F.ledgerMigration),
    row(`元帳の刷新で経理の仕事はどう変わりましたか → ${JA_HEADINGS.minatopay}・照合差異37件→2件、決算5日→2日`, F.breaks, F.close),
    row(`リスク管理チームはデプロイなしでどうルールを変えるのですか → ${JA_HEADINGS.minatopay}・JSON条件言語とシャドーモード`, F.fraudLang, F.shadow),
    row(`決済画面の改善は事業に何をもたらしましたか → ${JA_HEADINGS.kestrel}・離脱率31%→22%`, F.abandonment),
    row(`決済画面が再び遅くならないよう何をしましたか → ${JA_HEADINGS.kestrel}・170 KBの予算と合成監視`, F.budget, F.synthetic),
    row(`他のチームにどう採用してもらいましたか → ${JA_HEADINGS.kestrel}・予算は2チーム、デザインシステムは12チーム`, F.budgetAdopted, F.twelve),
    row(`移植したバッチが正しいことをどう証明しましたか → ${JA_HEADINGS.hokushin}・出力差分の検証ツール`, F.verifyTool, F.reused),
    row(`後輩やチームメンバーをどう育てていますか → ${JA_HEADINGS.solaris}・メンタリング2名とキャリアラダー`, F.mentor, F.ladder),
    row("それぞれの会社を辞めた理由は何ですか → 各社の章の最後の段落"),
    row(`仕事以外で取り組んでいることはありますか → kanjigrid：仕事の外で作ったもの・貢献者26人`, F.contributors),
    row("次に何をしたいですか → これから"),
  ],
  gapRow: (gap) =>
    row(`${gapLabelJa(gap)}は何をしていましたか → ${JA_HEADINGS.solaris}・${gap.explanation ?? "記録に説明がまだありません"}`),
};

/* ------------------------------------------------------------- assembling */

interface DraftSection {
  key: string;
  heading: string;
  blocks: { kind: BlockKind; text: string; factIds: string[] }[];
}

/** The fact a claim's start names, among those this render was given. */
function factId(facts: readonly RenderFact[], cite: Cite): string {
  const found = facts.filter((f) => f.claim.startsWith(cite));
  if (found.length !== 1) {
    throw new Error(`The demo render cites "${cite}", which ${found.length === 0 ? "it was not given" : "names more than one fact"}.`);
  }
  return found[0]!.id;
}

const draftBlocks = (facts: readonly RenderFact[], lines: readonly Line[]) =>
  lines.map((line) => ({ kind: line.kind, text: line.text, factIds: line.cites.map((cite) => factId(facts, cite)) }));

function employerKey(name: string): EmployerKey {
  const employer = EMPLOYERS.find((e) => e.nameJa === name || e.nameLatin === name);
  if (!employer) throw new Error(`The demo render has no employer named ${name}.`);
  return employer.key as EmployerKey;
}

function projectKey(name: string): string {
  const project = [...EMPLOYERS.flatMap((e) => e.projects), ...INDEPENDENT_PROJECTS].find(
    (p) => p.name === name || p.nameJa === name,
  );
  if (!project) throw new Error(`The demo render has no project named ${name}.`);
  return project.key;
}

function resume(facts: readonly RenderFact[], spec: RenderSpec): DraftSection[] {
  const tailored = spec.jobDescription !== null;
  const bullets = tailored ? TAILORED : RESUME;
  const projects = tailored ? TAILORED_PROJECTS : RESUME_PROJECTS;
  return [
    { key: "summary", heading: "Summary", blocks: draftBlocks(facts, [tailored ? TAILORED_SUMMARY : RESUME_SUMMARY]) },
    ...spec.employers.map((e) => ({
      key: `employer:${e.id}`,
      heading: e.name,
      blocks: draftBlocks(facts, bullets[employerKey(e.name)]),
    })),
    ...spec.projects
      .filter((p) => p.employerId === null)
      .map((p) => ({ key: `project:${p.id}`, heading: p.name, blocks: draftBlocks(facts, projects[projectKey(p.name)] ?? []) })),
  ];
}

function rirekisho(facts: readonly RenderFact[], spec: RenderSpec): DraftSection[] {
  const tailored = spec.jobDescription !== null;
  const motivation = tailored
    ? [
        { kind: "paragraph" as const, text: spec.application!.motivationNote!, factIds: [] },
        ...draftBlocks(facts, MOTIVATION.slice(0, 2)),
      ]
    : draftBlocks(facts, MOTIVATION);
  return [
    { key: "motivation", heading: "志望動機・特技・アピールポイントなど", blocks: motivation },
    {
      key: "kibou",
      heading: "本人希望欄",
      blocks: [{ kind: "paragraph", text: (tailored ? spec.application?.kibouNote : null) ?? spec.desiredRoleNote ?? "貴社規定に従います。", factIds: [] }],
    },
  ];
}

function shokumu(facts: readonly RenderFact[], spec: RenderSpec): DraftSection[] {
  const skills = (spec.curatedSkills ?? []).flatMap((group) => {
    const use = SKILL_USE[group.name];
    if (!group.nameJa || use === undefined) throw new Error(`The demo 職務経歴書 has no wording for the group ${group.name}.`);
    const behind = facts.filter((f) => f.technologies.some((t) => group.skills.includes(t))).map((f) => f.id);
    return [
      { kind: "row" as const, text: group.nameJa, factIds: [] },
      { kind: "paragraph" as const, text: `${group.skills.join("、")}${use}`, factIds: behind },
    ];
  });

  const experience = spec.employers.flatMap((e) => {
    const key = employerKey(e.name);
    const written = SHOKUMU[key];
    const at = facts.filter((f) => f.employer?.id === e.id);
    const scale = [
      ...(e.capitalYen !== null ? [`資本金：${capitalInJapanese(e.capitalYen)}`] : []),
      ...(e.headcount !== null ? [`従業員数：${e.headcount}名`] : []),
    ];
    const projects = spec.projects.filter((p) => p.employerId === e.id);
    const loose = written.filter((line) => line.project === undefined);
    const technologies = [...new Set(at.flatMap((f) => f.technologies))];
    return [
      { kind: "paragraph" as const, text: e.name, factIds: [] },
      ...(e.businessDescription ? [{ kind: "row" as const, text: `事業内容：${e.businessDescription}`, factIds: [] }] : []),
      ...(scale.length > 0 ? [{ kind: "row" as const, text: scale.join("　"), factIds: [] }] : []),
      ...projects.flatMap((p) => [
        { kind: "row" as const, text: `プロジェクト：${p.name}${p.summaryJa ? `　${p.summaryJa}` : ""}`, factIds: [] },
        { kind: "row" as const, text: "技術的成果：", factIds: [] },
        ...draftBlocks(facts, written.filter((line) => line.project === projectKey(p.name))),
      ]),
      ...(loose.length > 0 ? [{ kind: "row" as const, text: "主な実績：", factIds: [] }, ...draftBlocks(facts, loose)] : []),
      ...(technologies.length > 0
        ? [{ kind: "row" as const, text: `技術スタック：${technologies.join("、")}`, factIds: at.filter((f) => f.technologies.length > 0).map((f) => f.id) }]
        : []),
    ];
  });

  return [
    { key: "summary", heading: "経歴要約", blocks: draftBlocks(facts, [SHOKUMU_SUMMARY]) },
    { key: "skills", heading: "活かせるスキル・経験", blocks: skills },
    { key: "experience", heading: "職務経歴", blocks: experience },
    { key: "self_pr", heading: "自己PR", blocks: draftBlocks(facts, SELF_PR) },
  ];
}

function story(facts: readonly RenderFact[], spec: RenderSpec, written: Story): DraftSection[] {
  // Each employer's row opens with its name and dates as the record holds them.
  const opening = (e: RenderSpec["employers"][number]) =>
    spec.language === "ja"
      ? `${e.name}（${periodJa(e.startedOn, e.endedOn)}）：`
      : `${e.name} (${monthSpan(e.startedOn, e.endedOn)}): `;
  const anchors = [
    ...spec.employers.map((e) => {
      const figures = written.anchors[employerKey(e.name)];
      return { ...figures, text: `${opening(e)}${figures.text}` };
    }),
    ...written.anchorsAfter,
  ];
  return [
    { key: "opening", heading: written.opening.heading, blocks: draftBlocks(facts, written.opening.lines) },
    ...spec.employers.map((e) => {
      const chapter = written.employers[employerKey(e.name)];
      return { key: `employer:${e.id}`, heading: chapter.heading, blocks: draftBlocks(facts, chapter.lines) };
    }),
    ...(spec.workOutsideEmployment
      ? [{ key: "independent", heading: written.independent.heading, blocks: draftBlocks(facts, written.independent.lines) }]
      : []),
    { key: "ahead", heading: written.ahead.heading, blocks: draftBlocks(facts, written.ahead.lines) },
    { key: "anchors", heading: written.anchorsHeading, blocks: draftBlocks(facts, anchors) },
    {
      key: "routing",
      heading: written.routingHeading,
      blocks: draftBlocks(facts, [...written.routing, ...spec.careerGaps.map(written.gapRow)]),
    },
  ];
}

/** The demo's answer to `generateRender`, parsed as the real adapter parses the model's. */
export function generateDemoRender(facts: RenderFact[], spec: RenderSpec): RenderContent {
  const draft = (() => {
    switch (spec.kind) {
      case "english_resume":
        return resume(facts, spec);
      case "rirekisho":
        return rirekisho(facts, spec);
      case "shokumu_keirekisho":
        return shokumu(facts, spec);
      case "career_story_en":
        return story(facts, spec, STORY_EN);
      case "career_story_ja":
        return story(facts, spec, STORY_JA);
    }
  })();
  return parseGeneratedRender({ sections: draft }, spec);
}
