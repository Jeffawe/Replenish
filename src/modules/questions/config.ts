/** Every tunable number in the questions lives here. Change a value and nothing else needs to change. */
export const DEFAULT_QUESTION_CONFIG = {
  /** At most this many questions about one product at a time. */
  maxPerProduct: 3,
  /** A stock count newer than this many days means we don't ask for another. */
  freshCountDays: 14,
  /** Ask for a stock count when confidence is below this. */
  askStockBelowConfidence: 0.6,
  /** A product that is low or out with confidence below this turns the button red. */
  importantBelowConfidence: 0.5,
  /** "Not now" keeps a question quiet for this many days. */
  snoozeDays: 7,
  /** The check-in modal shows at most this many questions, at most this often. */
  checkInQuestions: 3,
  checkInEveryDays: 3,
  /** "How long does one last?" answers. */
  lastsFor: [
    { days: 7, label: "About a week" },
    { days: 14, label: "2 weeks" },
    { days: 30, label: "A month" },
    { days: 75, label: "2–3 months" },
  ],
  /** "How much is left when you buy more?" answers, as a share of a usual purchase. */
  leftover: [
    { share: 0, label: "Almost none" },
    { share: 0.25, label: "About a quarter" },
    { share: 0.5, label: "About half" },
  ],
};

export type QuestionConfig = typeof DEFAULT_QUESTION_CONFIG;
