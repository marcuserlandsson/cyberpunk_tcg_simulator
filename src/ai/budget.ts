export interface SearchBudget { left: number }
export class SearchBudgetExhausted extends Error {}
export function spendSearchBudget(budget?: SearchBudget): void {
  if (budget && budget.left-- <= 0) throw new SearchBudgetExhausted('Search budget exhausted')
}
