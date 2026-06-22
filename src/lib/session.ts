import type { SessionOptions } from "iron-session";
import type { SalesforceTokens, OrgContext } from "@/lib/types/salesforce";

export interface SessionData {
  salesforce?: SalesforceTokens;
  orgContext?: OrgContext;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET ?? "arboard-dev-secret-32-chars-minimum!",
  cookieName: "arboard-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7,
  },
};
