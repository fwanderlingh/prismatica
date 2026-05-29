export type DecisionValue = "include" | "exclude" | "maybe" | "not_retrieved";

export type Stage = "title_abstract" | "full_text" | "extraction" | "risk_of_bias";

export type MaybePolicy = "advance_to_full_text" | "conflict" | "third_vote";

export type StageEvaluation =
  | { state: "awaiting_votes"; label: string }
  | { state: "advance_full_text"; label: string }
  | { state: "excluded_abstract"; label: string }
  | { state: "conflict"; label: string }
  | { state: "needs_third_vote"; label: string }
  | { state: "advance_extraction"; label: string }
  | { state: "excluded_full_text"; label: string }
  | { state: "report_not_retrieved"; label: string }
  | { state: "manual_review"; label: string };

export function evaluateStage(
  stage: "title_abstract" | "full_text",
  decisions: DecisionValue[],
  requiredVotes: number,
  maybePolicy: MaybePolicy
): StageEvaluation {
  if (decisions.length < requiredVotes) {
    return { state: "awaiting_votes", label: "Awaiting votes" };
  }

  const hasInclude = decisions.includes("include");
  const hasExclude = decisions.includes("exclude");
  const hasMaybe = decisions.includes("maybe");
  const includeCount = decisions.filter((decision) => decision === "include").length;
  const excludeCount = decisions.filter((decision) => decision === "exclude").length;

  if (hasInclude && hasExclude) {
    if (includeCount >= requiredVotes && includeCount > excludeCount) {
      return stage === "title_abstract"
        ? { state: "advance_full_text", label: "Advance to full text" }
        : { state: "advance_extraction", label: "Advance to extraction" };
    }
    if (excludeCount >= requiredVotes && excludeCount > includeCount) {
      return stage === "title_abstract"
        ? { state: "excluded_abstract", label: "Excluded at abstract" }
        : { state: "excluded_full_text", label: "Excluded with reason" };
    }
    return { state: "conflict", label: "Resolve conflict" };
  }

  if (stage === "title_abstract") {
    if (decisions.every((decision) => decision === "include")) {
      return { state: "advance_full_text", label: "Advance to full text" };
    }

    if (decisions.every((decision) => decision === "exclude")) {
      return { state: "excluded_abstract", label: "Excluded at abstract" };
    }

    if (hasMaybe) {
      if (maybePolicy === "advance_to_full_text") {
        return { state: "advance_full_text", label: "Advance to full text" };
      }
      if (maybePolicy === "third_vote") {
        return { state: "needs_third_vote", label: "Third vote needed" };
      }
      return { state: "conflict", label: "Resolve conflict" };
    }
  }

  if (stage === "full_text") {
    if (decisions.every((decision) => decision === "include")) {
      return { state: "advance_extraction", label: "Advance to extraction" };
    }

    if (decisions.every((decision) => decision === "exclude")) {
      return { state: "excluded_full_text", label: "Excluded with reason" };
    }

    if (decisions.includes("not_retrieved")) {
      return { state: "report_not_retrieved", label: "Report not retrieved" };
    }
  }

  return { state: "manual_review", label: "Manual review" };
}
