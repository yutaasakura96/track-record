/**
 * A refused English résumé, said where the author is. Most refusals are a
 * sentence; one refused for a job header with no city or no title also links
 * to each field to fill in, on the career timeline. Generation, the page, the
 * proposal preview and each download refuse it the same way (`docs/06`,
 * 2026-10-22), so every one of those says it with these links.
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

/** A link per gap the refusal named; nothing for any other failure. */
export function JobHeaderLinks({ error }: { error: unknown }) {
  const gaps = jobHeaderGaps(error);
  if (gaps.length === 0) return null;
  return (
    <>
      {" "}
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

/** A refused write's words, and the links when it names job headers. */
export function generateFailure(error: unknown): ReactNode {
  if (jobHeaderGaps(error).length === 0) return failureText(error);
  return (
    <>
      {failureText(error)}
      <JobHeaderLinks error={error} />
    </>
  );
}
