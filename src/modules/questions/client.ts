/**
 * The part of the questions a browser component may import: the shapes only.
 * Everything else comes from "@/modules/questions" (server only).
 */
export type { Answer, Choice, Question, QuestionKind } from "./types";
export type { AnswerOutcome, Undo } from "./index";
