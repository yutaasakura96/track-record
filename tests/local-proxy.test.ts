/**
 * The tests and global setup must reach the same proxy. When global setup
 * hardcoded the default port, a connection string with `proxyPort` ran the
 * tests against one proxy and dropped the schema behind another.
 */
import { describe, expect, it } from "vitest";
import { neonConfig } from "@neondatabase/serverless";
import { createDb } from "~/server/db/client";
import { localProxyEndpoint } from "~/server/db/local-proxy";

const endpoint = (url: string) => localProxyEndpoint(new URL(url));

describe("the local proxy endpoint", () => {
  it("is the default proxy when the connection string names none", () => {
    expect(endpoint("postgresql://postgres:postgres@localhost:5432/track_record_test?sslmode=require")).toBe(
      "http://localhost:4444/sql",
    );
  });

  it("is the proxy the connection string names with proxyPort", () => {
    expect(
      endpoint("postgresql://postgres:postgres@localhost:5432/track_record_test?sslmode=require&proxyPort=54444"),
    ).toBe("http://localhost:54444/sql");
  });

  it("keeps the connection string's host", () => {
    expect(endpoint("postgresql://postgres:postgres@db.localtest.me:5432/track_record_test")).toBe(
      "http://db.localtest.me:4444/sql",
    );
  });

  it("routes an IPv6 loopback database through the local proxy", () => {
    const previous = neonConfig.fetchEndpoint;
    try {
      createDb("postgresql://postgres:postgres@[::1]:5432/track_record_dev");
      expect(neonConfig.fetchEndpoint).toBe("http://[::1]:4444/sql");
    } finally {
      neonConfig.fetchEndpoint = previous;
    }
  });
});
