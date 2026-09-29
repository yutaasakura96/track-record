/**
 * The overlap matcher itself (`src/overlap`, `docs/06` 2026-09-28).
 *
 * `overlap.test.ts` reaches it over HTTP, scoped by user and employer. These pin
 * what "likely the same" and "a number differs" mean on claims alone. Every
 * claim here is invented.
 */
import { describe, expect, it } from "vitest";
import { MAX_MATCHES, overlapMatcher, type OverlapFact } from "~/overlap";

const fact = (id: string, claim: string, technologies: string[] = []): OverlapFact => ({
  id,
  claim,
  technologies,
});

/** One employer's accepted facts, the way a first-person retelling states them. */
const POOL = [
  fact("batch", "Cut the nightly settlement batch from six hours to 90 minutes", ["Airflow"]),
  fact("oracle", "Migrated the order management system from an on-premises Oracle database to PostgreSQL"),
  fact("team", "Led a team of 4 engineers on the warehouse routing rewrite"),
  fact("cloud", "Reduced monthly cloud spend by 30% by rightsizing instances", ["AWS"]),
  fact("review", "Introduced code review for every change to the billing service"),
  fact("runbook", "Wrote the runbook for the nightly batch on-call rotation"),
  fact("yakan", "夜間バッチの処理時間を6時間から90分に短縮した", ["Airflow"]),
  fact("zaiko", "倉庫管理システムの在庫照会APIを設計・実装した", ["Java"]),
];

const match = overlapMatcher(POOL);

describe("likely the same", () => {
  it("matches a claim restated in other words", () => {
    expect(match(fact("c", "Reduced nightly batch runtime from 6 hours to 90 minutes"))).toEqual([
      { id: "batch", conflict: false },
    ]);
    expect(match(fact("c", "Migrated the order system from Oracle to PostgreSQL"))).toEqual([
      { id: "oracle", conflict: false },
    ]);
  });

  it("matches a Japanese claim restated in other words", () => {
    expect(match(fact("c", "夜間バッチの所要時間を6時間から90分へ短縮"))).toEqual([
      { id: "yakan", conflict: false },
    ]);
    expect(match(fact("c", "在庫照会APIを設計し実装した"))).toEqual([{ id: "zaiko", conflict: false }]);
  });

  it("does not match a different claim at the same employer", () => {
    expect(match(fact("c", "Added OAuth sign-in to the customer portal"))).toEqual([]);
    expect(match(fact("c", "Reduced page load time of the tracking site by 50%"))).toEqual([]);
    expect(match(fact("c", "新人エンジニア向けの研修資料を作成した"))).toEqual([]);
  });

  it("does not let shared words about the batch make the runbook a match", () => {
    const found = match(fact("c", "Reduced nightly batch runtime from 6 hours to 90 minutes"));
    expect(found.map((m) => m.id)).not.toContain("runbook");
  });

  it("never matches a fact to itself", () => {
    expect(match(POOL[0]!)).toEqual([]);
  });

  it("returns no more than the card holds, best first", () => {
    const many = overlapMatcher([
      fact("a", "Rewrote the nightly settlement batch in set-based SQL"),
      fact("b", "Rewrote the nightly settlement batch in set-based SQL on Airflow"),
      fact("c", "Rewrote the nightly settlement batch"),
      fact("d", "Rewrote the settlement batch"),
      fact("e", "Rewrote the nightly settlement batch in set-based SQL, scheduled on Airflow"),
    ]);
    const found = many(fact("x", "Rewrote the nightly settlement batch in set-based SQL"));
    expect(found).toHaveLength(MAX_MATCHES);
    expect(found[0]!.id).toBe("a");
  });

  it("does not find a restatement in the other language, the known limit", () => {
    expect(match(fact("c", "Designed and implemented the inventory lookup API", ["Java"]))).toEqual([]);
  });
});

describe("a number that differs", () => {
  it("marks a match whose figure differs as a conflict", () => {
    expect(match(fact("c", "Reduced the nightly settlement batch runtime to 80 minutes"))).toEqual([
      { id: "batch", conflict: true },
    ]);
    expect(match(fact("c", "Lowered monthly cloud costs by 40% through instance rightsizing"))).toEqual([
      { id: "cloud", conflict: true },
    ]);
    expect(match(fact("c", "夜間バッチ処理を80分まで短縮した"))).toEqual([{ id: "yakan", conflict: true }]);
  });

  it("does not mark a claim that names fewer of the same figures", () => {
    const pool = overlapMatcher([fact("full", "Reduced nightly batch runtime from 6 hours to 90 minutes")]);
    expect(pool(fact("c", "Reduced nightly batch runtime to 90 minutes"))).toEqual([
      { id: "full", conflict: false },
    ]);
  });

  it("reads a figure and its scale as one number, in either language", () => {
    const pool = overlapMatcher([fact("yen", "Cut annual licence costs by 12 million yen")]);
    expect(pool(fact("c", "Cut annual licence costs by 1,200万 yen"))).toEqual([{ id: "yen", conflict: false }]);
    expect(pool(fact("c", "Cut annual licence costs by 1億2000万 yen"))).toEqual([{ id: "yen", conflict: true }]);
  });

  it("does not read a product name as a number", () => {
    const pool = overlapMatcher([fact("s3", "Moved report archives from EC2 disks to S3")]);
    expect(pool(fact("c", "Moved the report archives to S3 from EC2 disks"))).toEqual([
      { id: "s3", conflict: false },
    ]);
  });

  it("counts a year toward a conflict, but not as evidence two claims are one", () => {
    const pool = overlapMatcher([
      fact("launch", "Launched the driver app in 2022"),
      fact("hire", "Hired the first data engineer in 2023"),
    ]);
    expect(pool(fact("c", "Launched the driver app in 2023"))).toEqual([{ id: "launch", conflict: true }]);
    expect(pool(fact("c", "Moved payroll to a new vendor in 2023"))).toEqual([]);
  });
});
