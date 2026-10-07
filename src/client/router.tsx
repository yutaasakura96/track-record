/**
 * Routing, and the two gates that make the first run have exactly one way
 * forward (`docs/10-screen-specifications.md`, `docs/09-user-flows.md` Flow 1):
 *
 *   no session → the sign-in screen, everywhere
 *   no profile → the profile form, and nothing else is reachable
 */
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { createMemoryHistory, createBrowserHistory } from "@tanstack/history";
import { useEffect, type ReactNode } from "react";
import { ApiError, useProfile, useSession } from "./api";
import { SignIn } from "./screens/sign-in";
import { ProfileForm } from "./screens/profile-form";
import { Overview } from "./screens/overview";
import { Record } from "./screens/record";
import { Skills } from "./screens/skills";
import { DocumentsScreen } from "./screens/documents";
import { FactReview } from "./screens/fact-review";
import { DiffReview } from "./screens/diff-review";
import { VersionHistoryScreen } from "./screens/version-history";
import { VersionEditScreen } from "./screens/version-edit";
import { FlaggedScreen } from "./screens/flagged";
import { MasterDocumentScreen } from "./screens/master-document";
import { TailoredScreen } from "./screens/tailored";
import { TooNarrow } from "./components/too-narrow";

function Shell() {
  return (
    <TooNarrow>
      <Gate>
        <Outlet />
      </Gate>
    </TooNarrow>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const session = useSession();
  const profile = useProfile();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const signedOut = session.error instanceof ApiError && session.error.status !== 500;
  // `null` is the settled answer "there is no profile yet" — see `useProfile`.
  const missingProfile = profile.data === null;

  useEffect(() => {
    // Every render needs a name to put on it, so identity comes first and
    // nothing else is reachable until it exists.
    if (!signedOut && missingProfile && path !== "/profile") {
      void navigate({ to: "/profile", replace: true });
    }
  }, [signedOut, missingProfile, path, navigate]);

  // `isPending`, not `isLoading`: the latter is true again on every refetch of a
  // query holding no data, and gating the tree on it unmounts and remounts the
  // very screen that triggers the refetch.
  //
  // Home is not held back by either read. It draws its frame at once and asks
  // for the overview while these two are still out, where waiting here meant
  // three reads one after the other behind a blank page (`docs/10` Screen 3,
  // Loading). It shows nothing of the record until both have answered.
  const home = path === "/";
  if (session.isPending) return home ? <>{children}</> : <Loading />;
  if (signedOut) return <SignIn reason={session.error as ApiError} />;
  if (profile.isPending) return home ? <>{children}</> : <Loading />;
  return <>{children}</>;
}

const Loading = () => (
  <div className="min-h-screen grid place-items-center text-small text-text-dim">Loading…</div>
);

const rootRoute = createRootRoute({ component: Shell });

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Overview,
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profile",
  component: ProfileForm,
});

const recordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/record",
  component: Record,
});

const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/skills",
  component: Skills,
});

const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents",
  component: DocumentsScreen,
});

const flaggedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/flagged",
  component: FlaggedScreen,
});

const masterDocumentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/master",
  component: MasterDocumentScreen,
});

const tailoredRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tailored",
  component: TailoredScreen,
});

const factReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/imports/$importId",
  component: FactReview,
  // `?fact=` opens the screen on one fact: where the Flagged list and the
  // master document send the author when they click into one.
  validateSearch: (search: Record<string, unknown>): { fact?: string } =>
    typeof search.fact === "string" && search.fact !== "" ? { fact: search.fact } : {},
});

const diffReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/proposals/$proposalId",
  component: DiffReview,
});

const versionHistoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/renders/$ref/history",
  component: VersionHistoryScreen,
});

const versionEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/renders/$ref/edit",
  component: VersionEditScreen,
});

const routeTree = rootRoute.addChildren([
  overviewRoute,
  profileRoute,
  recordRoute,
  skillsRoute,
  documentsRoute,
  flaggedRoute,
  masterDocumentRoute,
  tailoredRoute,
  factReviewRoute,
  diffReviewRoute,
  versionHistoryRoute,
  versionEditRoute,
]);

/**
 * The screen tests mount the real tree, gates included, over a memory history
 * of their own (`tests/client/`). One router per test keeps a navigation in one
 * test from leaking into the next.
 */
export const createAppRouter = (
  history = typeof window === "undefined" ? createMemoryHistory() : createBrowserHistory(),
) => createRouter({ routeTree, history, defaultPreload: false });

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export { factReviewRoute, diffReviewRoute, versionHistoryRoute, versionEditRoute };
