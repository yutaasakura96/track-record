/**
 * The demo record's source documents: invented case studies written the way the
 * author's real ones are (one long write-up per project, or one portfolio per
 * employer), for an invented engineer at invented companies. Nothing here is
 * sampled from `local/`.
 *
 * Each document carries the candidates the scripted importer "finds" in it.
 * Every `quote` must appear verbatim in `text`; `seed.ts` refuses to run when
 * one does not, rather than letting the pipeline discard it quietly.
 */
import type { CandidateFact } from "~/model/types";

export interface DemoDocument {
  filename: string;
  /** Employer key from `fixture.ts`, or null for work outside employment. */
  employer: string | null;
  project: string | null;
  text: string;
  candidates: CandidateFact[];
}

const hokushin = `# 地方銀行向け 夜間バッチ基盤刷新

## 概要

北辰システムズでは、地方銀行向けの勘定系周辺システムの保守開発を担当した。本書は 2015年10月から2017年3月までの夜間バッチ基盤刷新プロジェクトの記録である。

## 背景

夜間バッチは COBOL と シェルスクリプトで構成され、ジョブ数は約 480 本あった。月末処理では終了時刻が朝 6 時を超えることがあり、オンライン開始の遅延が年に数回発生していた。

## 取り組み

ジョブ定義を棚卸しし、約 480 本の依存関係を JP1 のジョブネットから抽出して一覧化した。その結果、並列実行できるジョブが全体の約 3 割あることが分かった。

集計系ジョブ 62 本を Java（Spring Batch）に移植し、Oracle のパーティション表を使って並列化した。移植したジョブは単体テストを JUnit で書き、旧ジョブとの出力差分を自動で突き合わせる検証ツールを作成した。

本番切替では、旧ジョブと新ジョブを 2 週間並行稼働させ、差分ゼロを確認してから切り替えた。

## 結果

月末バッチの終了時刻は平均 5 時 40 分から 3 時 10 分に短縮された。切替後 6 か月間、バッチ起因のオンライン開始遅延は 0 件だった。

検証ツールはその後、他の 2 つの移植案件でも再利用された。

## 担当範囲

設計、実装、テスト、本番切替手順書の作成を担当した。チームは 6 名で、2016年4月からはサブリーダーとして 2 名の新人の指導も担当した。

## 補足

本番サーバ hk-batch-prd-01 の運用手順書も改訂した。
`;

const ledger = `# MinatoPay — Rebuilding the payments ledger

## Context

MinatoPay processes card and bank-transfer payments for small online merchants. When I joined in April 2017 the ledger was a single PostgreSQL table updated in place by three different services, and finance reconciled it by hand at month end.

## Problem

Balances drifted. In the quarter before the project, finance found 37 reconciliation breaks that each took between half a day and two days to trace. Nobody could say with confidence what a merchant's balance had been on a given day.

## What I did

I proposed moving to a double-entry, append-only ledger and wrote the design document that the team adopted. Every money movement became a pair of immutable entries, and a balance became a query over entries rather than a stored number.

I built the ledger service in Go, with PostgreSQL as the store and Kafka carrying payment events from the gateway. Writes are idempotent on the payment event id, so a replayed event cannot post twice.

Migration ran in three phases: dual-write for six weeks, a nightly comparison job that reported any difference between the old balances and the new ones, and a cut-over once the comparison had been clean for 21 consecutive days.

I also wrote the runbook and trained the two on-call engineers who took over the service.

## Results

Reconciliation breaks fell from 37 in the quarter before to 2 in the quarter after cut-over, both caused by a bank file format change rather than by the ledger.

Month-end close moved from five working days to two.

Point-in-time balance queries for any merchant on any day now return in under 200 ms at the 95th percentile.

The design became the template for the payouts ledger the following year.

## Stack

Go, PostgreSQL, Kafka, Docker, AWS (ECS, RDS), Terraform.
`;

const fraud = `# MinatoPay — Fraud rules engine

## Context

By 2019 MinatoPay's chargeback rate was rising, and fraud rules lived as hard-coded conditions inside the payment API. Changing a rule meant a deploy, and the risk team waited a week on average for one.

## What I did

I led a team of three to build a rules engine the risk team could edit themselves. Rules are expressed in a small JSON-based condition language, versioned, and evaluated in a separate Kotlin service that the payment API calls with a 50 ms budget.

Every rule change goes through shadow mode first: the new rule is evaluated on live traffic and its decisions are logged without affecting payments, so the risk team can see what it would have blocked before turning it on.

I worked with the risk lead, Aiko Tanabe, to define the first 40 rules and migrate the hard-coded ones.

## Results

The time to ship a rule change fell from about a week to the same day.

The chargeback rate fell from 0.42% to 0.18% over the following two quarters.

The engine evaluates around 1,200 payments per second at peak with p99 latency of 18 ms.

## Stack

Kotlin, Spring Boot, Redis, PostgreSQL, AWS.
`;

const checkout = `# Kestrel Commerce — Checkout performance

## Context

Kestrel Commerce runs an online marketplace for independent fashion brands. In 2021 the checkout was a React single-page app talking to a Node.js backend-for-frontend, and mobile conversion lagged desktop badly.

## Problem

On a mid-range Android phone over 4G, checkout took 6.8 seconds to become interactive. Analytics showed that 31% of mobile sessions that reached checkout left before the payment step.

## What I did

As tech lead for the checkout squad (five engineers), I set a performance budget and made it part of CI: a pull request that pushed the checkout bundle past 170 KB compressed failed the build.

We moved checkout to server-side rendering with streaming, split the payment SDK into a lazily loaded chunk, and removed two analytics scripts that blocked the main thread.

I introduced synthetic monitoring on a throttled device profile so regressions showed up the day they merged rather than in the monthly report.

## Results

Time to interactive on the reference device fell from 6.8 seconds to 2.9 seconds.

Mobile checkout abandonment fell from 31% to 22% over the following quarter, which the finance team valued at roughly ¥140 million in annual gross merchandise value.

The performance budget is still enforced in CI and was adopted by two other squads.

## Stack

TypeScript, React, Next.js, Node.js, GraphQL, Google Cloud (Cloud Run), GitHub Actions.
`;

const search = `# Kestrel Commerce — Search relevance and the design system

## Search relevance

Search drove 45% of marketplace revenue, but results were ranked by a hand-tuned Elasticsearch query that nobody wanted to touch.

I built an offline evaluation set from six months of search logs, with click-through and purchase as relevance labels, so that every ranking change could be scored before it shipped.

With that in place, the team moved to learning-to-rank on top of Elasticsearch. Search conversion rose by 9% in an A/B test that ran for four weeks across all traffic.

I also built the BigQuery pipeline that feeds the evaluation set, refreshed nightly with Dataflow.

## Design system

In 2022 I co-founded the frontend guild and led the effort to replace three diverging component libraries with one design system, published as an internal npm package with Storybook documentation.

Twelve teams adopted it within a year. New screens were built noticeably faster once teams stopped re-implementing form controls.

## Stack

Elasticsearch, Python, BigQuery, Dataflow, TypeScript, React, Storybook.
`;

const solaris = `# Solaris Health — Portfolio, 2024 to present

Solaris Health builds software for clinics: appointment booking, electronic medical records and a patient app. I joined in January 2024 as a staff engineer on the platform team.

## Project 1 — Moving the platform to Azure Kubernetes Service

### Context

The product ran on hand-managed virtual machines at a hosting company, deployed by a shell script that one person understood. Releases happened every two weeks, at night, and roughly one in five needed a rollback.

### What I did

I led the migration to Azure Kubernetes Service with a team of four. Infrastructure is defined in Terraform, applications are packaged with Helm, and deployments go through Argo CD from a single Git repository.

I wrote the migration plan service by service, starting with stateless services and finishing with the booking API, which we moved behind a traffic split so that 5% of requests went to the new cluster first.

I set up Azure Monitor and Grafana dashboards with service-level objectives for the booking API, and wrote the incident process the team now uses.

### Results

All 23 services moved to AKS over nine months with no unplanned downtime during cut-over.

Deployments went from every two weeks to several times a day, and the rollback rate fell from about one in five releases to under one in twenty.

Infrastructure cost fell by 28% after rightsizing, mostly from moving batch work to spot node pools.

## Project 2 — Clinical data pipeline

### Context

Clinics wanted reports on no-shows and waiting times, and the product team wanted the same data for planning. Each report was a SQL query run by hand against the production database.

### What I did

I designed a data pipeline that copies booking and visit events into Azure Data Lake, transforms them with dbt, and serves them to Power BI. Patient identifiers are pseudonymised before they leave the production network.

I worked with the clinic operations team at Sakura Family Clinic to define the first five reports.

### Results

Monthly clinic reports are now generated automatically instead of taking an analyst three days each month.

The no-show report led to a reminder feature that cut no-shows by 17% at the clinics that enabled it.

## Other

I interview backend and platform candidates and mentor two mid-level engineers.

The cluster's internal API gateway sits at 10.20.4.15, which is documented in the runbook.
`;

const kanjigrid = `# kanjigrid — an open-source library

kanjigrid is a small TypeScript library I wrote in 2019 for laying out Japanese text in vertical grids (genkō yōshi style) in the browser. It handles line-breaking rules (kinsoku shori) and ruby annotations.

It has around 1,400 stars on GitHub and is downloaded about 9,000 times a week from npm.

I maintain it alone, with occasional contributions. Twenty-six people have contributed at least one merged pull request.

In 2023 I gave a talk about it at a JavaScript meetup in Tokyo, titled "Vertical text on the web is harder than it looks".

Stack: TypeScript, Canvas API, Vitest.
`;

export const DOCUMENTS: DemoDocument[] = [
  {
    filename: "hokushin-yakan-batch.md",
    employer: "hokushin",
    project: "hokushin-batch",
    text: hokushin,
    candidates: [
      {
        claim: "夜間バッチ約480本のジョブ依存関係を JP1 のジョブネットから抽出して一覧化し、並列実行可能なジョブが約3割あることを特定した",
        quote: "ジョブ定義を棚卸しし、約 480 本の依存関係を JP1 のジョブネットから抽出して一覧化した。その結果、並列実行できるジョブが全体の約 3 割あることが分かった。",
        technologies: ["JP1"],
        provenance: "measured",
      },
      {
        claim: "集計系ジョブ62本を COBOL から Java（Spring Batch）に移植し、Oracle のパーティション表で並列化した",
        quote: "集計系ジョブ 62 本を Java（Spring Batch）に移植し、Oracle のパーティション表を使って並列化した。",
        technologies: ["Java", "Spring Batch", "Oracle Database", "COBOL"],
        provenance: "measured",
      },
      {
        claim: "旧ジョブと新ジョブの出力差分を自動で突き合わせる検証ツールを作成した",
        quote: "旧ジョブとの出力差分を自動で突き合わせる検証ツールを作成した。",
        technologies: ["Java", "JUnit"],
        provenance: "attested",
      },
      {
        claim: "月末バッチの終了時刻を平均5時40分から3時10分に短縮した",
        quote: "月末バッチの終了時刻は平均 5 時 40 分から 3 時 10 分に短縮された。",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "切替後6か月間、バッチ起因のオンライン開始遅延を0件に抑えた",
        quote: "切替後 6 か月間、バッチ起因のオンライン開始遅延は 0 件だった。",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "作成した検証ツールが他の2つの移植案件でも再利用された",
        quote: "検証ツールはその後、他の 2 つの移植案件でも再利用された。",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "6名のチームでサブリーダーとして新人2名を指導した",
        quote: "チームは 6 名で、2016年4月からはサブリーダーとして 2 名の新人の指導も担当した。",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "本番バッチサーバ hk-batch-prd-01 の運用手順書を改訂した",
        quote: "本番サーバ hk-batch-prd-01 の運用手順書も改訂した。",
        technologies: [],
        provenance: "attested",
        confidential: true,
        note: "It names an internal server.",
      },
    ],
  },
  {
    filename: "minatopay-ledger.md",
    employer: "minatopay",
    project: "minatopay-ledger",
    text: ledger,
    candidates: [
      {
        claim: "Proposed and designed a double-entry, append-only payments ledger that the team adopted",
        quote: "I proposed moving to a double-entry, append-only ledger and wrote the design document that the team adopted.",
        technologies: [],
        provenance: "attested",
      },
      {
        claim: "Built the ledger service in Go on PostgreSQL, consuming payment events from Kafka with idempotent writes",
        quote: "I built the ledger service in Go, with PostgreSQL as the store and Kafka carrying payment events from the gateway. Writes are idempotent on the payment event id, so a replayed event cannot post twice.",
        technologies: ["Go", "PostgreSQL", "Kafka"],
        provenance: "attested",
      },
      {
        claim: "Ran a three-phase migration: six weeks of dual-write, a nightly comparison job, and cut-over after 21 consecutive clean days",
        quote: "Migration ran in three phases: dual-write for six weeks, a nightly comparison job that reported any difference between the old balances and the new ones, and a cut-over once the comparison had been clean for 21 consecutive days.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Reduced reconciliation breaks from 37 a quarter to 2",
        quote: "Reconciliation breaks fell from 37 in the quarter before to 2 in the quarter after cut-over",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Shortened month-end close from five working days to two",
        quote: "Month-end close moved from five working days to two.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Point-in-time balance queries return in under 200 ms at p95",
        quote: "Point-in-time balance queries for any merchant on any day now return in under 200 ms at the 95th percentile.",
        technologies: ["PostgreSQL"],
        provenance: "measured",
      },
      {
        claim: "The ledger design became the template for the payouts ledger",
        quote: "The design became the template for the payouts ledger the following year.",
        technologies: [],
        provenance: "attested",
      },
      {
        claim: "Wrote the runbook and trained two on-call engineers to take over the service",
        quote: "I also wrote the runbook and trained the two on-call engineers who took over the service.",
        technologies: [],
        provenance: "attested",
      },
      {
        claim: "Cut payment processing costs by 30% through the ledger rewrite",
        quote: "Month-end close moved from five working days to two.",
        technologies: [],
        provenance: "generated",
        unsure: true,
        note: "The passage gives a close time, not a cost.",
      },
      {
        claim: "Deployed on AWS ECS and RDS with infrastructure in Terraform",
        quote: "Go, PostgreSQL, Kafka, Docker, AWS (ECS, RDS), Terraform.",
        technologies: ["Docker", "AWS", "Terraform"],
        provenance: "attested",
      },
    ],
  },
  {
    filename: "minatopay-fraud-rules.md",
    employer: "minatopay",
    project: "minatopay-fraud",
    text: fraud,
    candidates: [
      {
        claim: "Led a team of three building a fraud rules engine the risk team could edit without a deploy",
        quote: "I led a team of three to build a rules engine the risk team could edit themselves.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Designed a versioned JSON condition language evaluated by a Kotlin service within a 50 ms budget",
        quote: "Rules are expressed in a small JSON-based condition language, versioned, and evaluated in a separate Kotlin service that the payment API calls with a 50 ms budget.",
        technologies: ["Kotlin"],
        provenance: "measured",
      },
      {
        claim: "Introduced shadow mode so every rule change is evaluated on live traffic before it takes effect",
        quote: "Every rule change goes through shadow mode first: the new rule is evaluated on live traffic and its decisions are logged without affecting payments",
        technologies: [],
        provenance: "attested",
      },
      {
        claim: "Defined the first 40 rules with risk lead Aiko Tanabe",
        quote: "I worked with the risk lead, Aiko Tanabe, to define the first 40 rules and migrate the hard-coded ones.",
        technologies: [],
        provenance: "measured",
        confidential: true,
        note: "It names a person other than the author.",
      },
      {
        claim: "Cut the time to ship a fraud rule change from about a week to the same day",
        quote: "The time to ship a rule change fell from about a week to the same day.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Reduced the chargeback rate from 0.42% to 0.18% over two quarters",
        quote: "The chargeback rate fell from 0.42% to 0.18% over the following two quarters.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "The engine evaluates about 1,200 payments per second at peak with 18 ms p99 latency",
        quote: "The engine evaluates around 1,200 payments per second at peak with p99 latency of 18 ms.",
        technologies: ["Kotlin", "Spring Boot", "Redis"],
        provenance: "measured",
      },
    ],
  },
  {
    filename: "kestrel-checkout-performance.md",
    employer: "kestrel",
    project: "kestrel-checkout",
    text: checkout,
    candidates: [
      {
        claim: "Led the five-engineer checkout squad as tech lead",
        quote: "As tech lead for the checkout squad (five engineers)",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Set a 170 KB checkout bundle budget enforced in CI",
        quote: "a pull request that pushed the checkout bundle past 170 KB compressed failed the build.",
        technologies: ["GitHub Actions"],
        provenance: "measured",
      },
      {
        claim: "Moved checkout to streamed server-side rendering and lazy-loaded the payment SDK",
        quote: "We moved checkout to server-side rendering with streaming, split the payment SDK into a lazily loaded chunk, and removed two analytics scripts that blocked the main thread.",
        technologies: ["Next.js", "React", "TypeScript"],
        provenance: "attested",
      },
      {
        claim: "Introduced synthetic monitoring on a throttled device profile to catch regressions the day they merged",
        quote: "I introduced synthetic monitoring on a throttled device profile so regressions showed up the day they merged rather than in the monthly report.",
        technologies: [],
        provenance: "attested",
      },
      {
        claim: "Cut checkout time to interactive on a mid-range phone from 6.8 s to 2.9 s",
        quote: "Time to interactive on the reference device fell from 6.8 seconds to 2.9 seconds.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Reduced mobile checkout abandonment from 31% to 22%, valued at about ¥140 million in annual GMV",
        quote: "Mobile checkout abandonment fell from 31% to 22% over the following quarter, which the finance team valued at roughly ¥140 million in annual gross merchandise value.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "The performance budget was adopted by two other squads",
        quote: "The performance budget is still enforced in CI and was adopted by two other squads.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Built the checkout backend-for-frontend in Node.js and GraphQL on Cloud Run",
        quote: "TypeScript, React, Next.js, Node.js, GraphQL, Google Cloud (Cloud Run), GitHub Actions.",
        technologies: ["Node.js", "GraphQL", "Google Cloud"],
        provenance: "attested",
        unsure: true,
        note: "The stack line lists the technologies but does not say who built the backend.",
      },
    ],
  },
  {
    filename: "kestrel-search-and-design-system.md",
    employer: "kestrel",
    project: null,
    text: search,
    candidates: [
      {
        claim: "Built an offline search evaluation set from six months of logs, labelled by click-through and purchase",
        quote: "I built an offline evaluation set from six months of search logs, with click-through and purchase as relevance labels, so that every ranking change could be scored before it shipped.",
        technologies: ["Elasticsearch", "Python"],
        provenance: "measured",
      },
      {
        claim: "Moved search ranking to learning-to-rank, raising search conversion by 9% in a four-week A/B test",
        quote: "the team moved to learning-to-rank on top of Elasticsearch. Search conversion rose by 9% in an A/B test that ran for four weeks across all traffic.",
        technologies: ["Elasticsearch"],
        provenance: "measured",
      },
      {
        claim: "Built the nightly BigQuery and Dataflow pipeline that feeds the search evaluation set",
        quote: "I also built the BigQuery pipeline that feeds the evaluation set, refreshed nightly with Dataflow.",
        technologies: ["BigQuery", "Dataflow"],
        provenance: "attested",
      },
      {
        claim: "Co-founded the frontend guild and led the replacement of three component libraries with one design system",
        quote: "In 2022 I co-founded the frontend guild and led the effort to replace three diverging component libraries with one design system, published as an internal npm package with Storybook documentation.",
        technologies: ["React", "Storybook", "TypeScript"],
        provenance: "measured",
      },
      {
        claim: "Twelve teams adopted the design system within a year",
        quote: "Twelve teams adopted it within a year.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "The design system made new screens 40% faster to build",
        quote: "New screens were built noticeably faster once teams stopped re-implementing form controls.",
        technologies: [],
        provenance: "generated",
        note: "The passage says faster, with no figure.",
      },
    ],
  },
  {
    filename: "solaris-health-portfolio.md",
    employer: "solaris",
    project: null,
    text: solaris,
    candidates: [
      {
        claim: "Led a team of four migrating the platform from hand-managed VMs to Azure Kubernetes Service",
        quote: "I led the migration to Azure Kubernetes Service with a team of four.",
        technologies: ["Azure Kubernetes Service", "Kubernetes", "Azure"],
        provenance: "measured",
      },
      {
        claim: "Defined infrastructure in Terraform, packaged services with Helm and deployed through Argo CD",
        quote: "Infrastructure is defined in Terraform, applications are packaged with Helm, and deployments go through Argo CD from a single Git repository.",
        technologies: ["Terraform", "Helm", "Argo CD"],
        provenance: "attested",
      },
      {
        claim: "Moved the booking API behind a traffic split, sending 5% of requests to the new cluster first",
        quote: "finishing with the booking API, which we moved behind a traffic split so that 5% of requests went to the new cluster first.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Set up service-level objectives with Azure Monitor and Grafana and wrote the team's incident process",
        quote: "I set up Azure Monitor and Grafana dashboards with service-level objectives for the booking API, and wrote the incident process the team now uses.",
        technologies: ["Azure Monitor", "Grafana"],
        provenance: "attested",
      },
      {
        claim: "Moved all 23 services to AKS over nine months with no unplanned downtime",
        quote: "All 23 services moved to AKS over nine months with no unplanned downtime during cut-over.",
        technologies: ["Azure Kubernetes Service"],
        provenance: "measured",
      },
      {
        claim: "Raised deployment frequency from fortnightly to several times a day and cut the rollback rate from one in five to under one in twenty",
        quote: "Deployments went from every two weeks to several times a day, and the rollback rate fell from about one in five releases to under one in twenty.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Reduced infrastructure cost by 28% by rightsizing and moving batch work to spot node pools",
        quote: "Infrastructure cost fell by 28% after rightsizing, mostly from moving batch work to spot node pools.",
        technologies: ["Kubernetes"],
        provenance: "measured",
      },
      {
        claim: "Designed a clinical data pipeline from booking events to Azure Data Lake, dbt and Power BI, with patient identifiers pseudonymised",
        quote: "I designed a data pipeline that copies booking and visit events into Azure Data Lake, transforms them with dbt, and serves them to Power BI. Patient identifiers are pseudonymised before they leave the production network.",
        technologies: ["Azure Data Lake", "dbt", "Power BI"],
        provenance: "attested",
      },
      {
        claim: "Defined the first five clinic reports with the operations team at Sakura Family Clinic",
        quote: "I worked with the clinic operations team at Sakura Family Clinic to define the first five reports.",
        technologies: [],
        provenance: "measured",
        confidential: true,
        note: "It names a client.",
      },
      {
        claim: "Automated monthly clinic reports that took an analyst three days each month",
        quote: "Monthly clinic reports are now generated automatically instead of taking an analyst three days each month.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "The no-show report led to a reminder feature that cut no-shows by 17%",
        quote: "The no-show report led to a reminder feature that cut no-shows by 17% at the clinics that enabled it.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Interviews backend and platform candidates and mentors two mid-level engineers",
        quote: "I interview backend and platform candidates and mentor two mid-level engineers.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Documented the internal API gateway address 10.20.4.15 in the runbook",
        quote: "The cluster's internal API gateway sits at 10.20.4.15, which is documented in the runbook.",
        technologies: [],
        provenance: "attested",
      },
    ],
  },
  {
    filename: "kanjigrid-oss.md",
    employer: null,
    project: "kanjigrid",
    text: kanjigrid,
    candidates: [
      {
        claim: "Wrote kanjigrid, a TypeScript library for vertical Japanese text layout with kinsoku line-breaking and ruby",
        quote: "kanjigrid is a small TypeScript library I wrote in 2019 for laying out Japanese text in vertical grids (genkō yōshi style) in the browser. It handles line-breaking rules (kinsoku shori) and ruby annotations.",
        technologies: ["TypeScript", "Canvas API"],
        provenance: "attested",
      },
      {
        claim: "kanjigrid has about 1,400 GitHub stars and is downloaded about 9,000 times a week from npm",
        quote: "It has around 1,400 stars on GitHub and is downloaded about 9,000 times a week from npm.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Twenty-six people have contributed merged pull requests to kanjigrid",
        quote: "Twenty-six people have contributed at least one merged pull request.",
        technologies: [],
        provenance: "measured",
      },
      {
        claim: "Spoke about vertical text on the web at a Tokyo JavaScript meetup in 2023",
        quote: "In 2023 I gave a talk about it at a JavaScript meetup in Tokyo, titled \"Vertical text on the web is harder than it looks\".",
        technologies: [],
        provenance: "attested",
      },
    ],
  },
];
