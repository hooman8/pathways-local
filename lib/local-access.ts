import type { Identity } from "./shared";

// Identity is local and never supplied by the browser. Compose publishes this
// single-user service only on the Mac's loopback address.
export const localOwner: Identity = {
  userId: "local-owner",
  email: "owner@pathways.localhost",
  displayName: "Local owner",
};

export function appOrigin() {
  const origin = new URL(process.env.APP_BASE_URL ?? `http://localhost:${process.env.NODE_ENV === "production" ? "8080" : "5173"}`);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || !["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error("APP_BASE_URL must be a localhost URL. This edition is for one local user.");
  }
  return origin;
}

export function assertLocalRequest(request: Request) {
  const expected = appOrigin();
  // Use the actual Host header, not a forwarded host. Reject DNS rebinding and
  // cross-site reads before opening the database.
  if (request.headers.get("host") !== expected.host || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new Error("Open the workspace at its configured localhost address.");
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== expected.origin) throw new Error("This request must come from the local workspace.");
}

export function assertSameOrigin(request: Request) {
  assertLocalRequest(request);
  if (request.headers.get("origin") !== appOrigin().origin || request.headers.get("x-pathways-client") !== "1") {
    throw new Error("This request must come from the local workspace.");
  }
}
