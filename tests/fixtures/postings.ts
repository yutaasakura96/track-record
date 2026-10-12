/**
 * Job postings for the tests of reading one (issue #73).
 *
 * INVENTED, every company, title and line. Nothing here is sampled from a real
 * posting or from `local/`. Each posting stands beside the reading a model is
 * expected to return for it, which is what the stubbed seam answers with.
 */
import type { PostingReading } from "~/model/types";

export const POSTING_EN = `Senior Backend Engineer — Vellum Tideworks

Vellum Tideworks builds the scheduling service that harbour pilots and tug crews plan their day on.

What you will do
- Own the berth-allocation service and its nightly replanning job.
- Take the service off its single database before the next shipping season.

What we ask for
- Six or more years building backend services in Go or Kotlin
- PostgreSQL in production, including a migration with no downtime
- Has been on call for a service other people depend on

Nice to have
- Experience with tide and weather data feeds

We offer a four-day week and a relocation allowance. Apply through the careers page.`;

export const READING_EN: PostingReading = {
  company: "Vellum Tideworks",
  position: "Senior Backend Engineer",
  requirements: [
    "Six or more years building backend services in Go or Kotlin",
    "PostgreSQL in production, including a migration with no downtime",
    "Has been on call for a service other people depend on",
  ],
};

export const POSTING_JA = `【募集職種】バックエンドエンジニア（配船システム刷新）

株式会社あおば港湾テクノロジーは、港湾の配船計画サービスを開発・運用しています。

■ 業務内容
配船計画システムの刷新プロジェクトにおける設計・開発・運用

■ 必須条件
・Go または Kotlin での開発経験 5年以上
・PostgreSQL の設計・運用経験
・要件定義から参画した経験

■ 歓迎条件
・物流業界での業務経験`;

export const READING_JA: PostingReading = {
  company: "株式会社あおば港湾テクノロジー",
  position: "バックエンドエンジニア（配船システム刷新）",
  requirements: ["Go または Kotlin での開発経験 5年以上", "PostgreSQL の設計・運用経験", "要件定義から参画した経験"],
};

/** Long enough to be read, and not a job posting: the reading finds nothing in it. */
export const NOT_A_POSTING = "Minutes of the allotment society, third Thursday. The water butt is to be mended.";
