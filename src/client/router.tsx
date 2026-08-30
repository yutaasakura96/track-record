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
import { FactReview } from "./screens/fact-review";
import { DiffReview } from "./screens/diff-review";
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
  const missingProfile = profile.error instanceof ApiError && profile.error.status === 404;

  useEffect(() => {
    // Every render needs a name to put on it, so identity comes first and
    // nothing else is reachable until it exists.
    if (!signedOut && missingProfile && path !== "/profile") {
      void navigate({ to: "/profile", replace: true });
    }
  }, [signedOut, missingProfile, path, navigate]);

  if (session.isLoading) return <Loading />;
  if (signedOut) return <SignIn reason={session.error as ApiError} />;
  if (profile.isLoading) return <Loading />;
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

const factReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/imports/$importId",
  component: FactReview,
});

const diffReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/proposals/$proposalId",
  component: DiffReview,
});

const routeTree = rootRoute.addChildren([
  overviewRoute,
  profileRoute,
  factReviewRoute,
  diffReviewRoute,
]);

export const router = createRouter({
  routeTree,
  history: typeof window === "undefined" ? createMemoryHistory() : createBrowserHistory(),
  defaultPreload: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export { factReviewRoute, diffReviewRoute };
