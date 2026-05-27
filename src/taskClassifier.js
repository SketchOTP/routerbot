const patterns = {
  debug: /\b(error|bug|fix|failing|stack trace|exception|regression|diagnose|debug)\b/i,
  review: /\b(review|diff|pull request|pr\b|risk|regression|security)\b/i,
  docs: /\b(readme|docs?|documentation|changelog|release notes|write-up)\b/i,
  plan: /\b(plan|architecture|design|approach|strategy|break down|roadmap)\b/i,
  explain: /\b(explain|why|how does|what does|summari[sz]e|teach me)\b/i,
  code: /\b(implement|build|create|refactor|test|typescript|javascript|python|api|component|function|class)\b/i,
  quick: /\b(quick|short|one-liner|simple|small)\b/i
};

export function classifyTask(text) {
  const scores = Object.entries(patterns).map(([task, pattern]) => ({
    task,
    score: pattern.test(text) ? 1 : 0
  }));
  const match = scores.find((item) => item.score > 0);
  return match?.task ?? "code";
}
