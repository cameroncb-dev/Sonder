import type { Issue, IssueCode } from "@sonder/contracts";

/** Thrown by connector operations. Always carries at least one structured issue. */
export class ConnectorError extends Error {
  readonly issues: Issue[];

  constructor(issues: Issue[] | Issue) {
    const list = Array.isArray(issues) ? issues : [issues];
    super(list.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    this.name = "ConnectorError";
    this.issues = list;
  }

  get code(): IssueCode {
    return this.issues[0]!.code;
  }
}
