/**
 * The SPA entry point.
 *
 * Three screens carry v1, so routing is a small file rather than a framework
 * (`docs/03-technical-design.md` §1).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { ApiError } from "./api";
import "./theme.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401 means the session is gone and the app shows sign-in. Retrying it
      // would only delay that.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 2,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("The application root element is missing.");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
