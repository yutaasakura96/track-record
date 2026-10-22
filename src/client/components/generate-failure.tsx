/**
 * A refused generation, said where the button is. Most refusals are a sentence;
 * an English résumé refused for a job header with no city or no title also
 * links to each field to fill in, on the career timeline.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ApiError, failureText } from "../api";

/** One job the server named, and what its header lacks. Mirrors `IncompleteJobHeader`. */
interface JobHeaderGap {
  employerId: string;
  name: string;
  missing: ("city" | "role")[];
}

const FIX_LABEL = { city: "city", role: "role" } as const;

const jobHeaderGaps = (error: unknown): JobHeaderGap[] =>
  error instanceof ApiError && Array.isArray(error.details.jobHeaders)
    ? (error.details.jobHeaders as JobHeaderGap[])
    : [];

export function generateFailure(error: unknown): ReactNode {
  const gaps = jobHeaderGaps(error);
  if (gaps.length === 0) return failureText(error);
  return (
    <>
      {failureText(error)}{" "}
      {gaps.flatMap((gap) =>
        gap.missing.map((fix) => (
          <Link
            key={`${gap.employerId}-${fix}`}
            to="/record"
            search={{ employer: gap.employerId, fix }}
            className="mr-8 text-accent-link hover:text-accent-link-hover underline"
          >
            {`Add the ${FIX_LABEL[fix]} for ${gap.name}`}
          </Link>
        )),
      )}
    </>
  );
}
