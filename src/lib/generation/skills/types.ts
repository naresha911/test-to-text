export type SkillAuthorInput = {
  skill: string;
  grade: number | null;
  difficultyStep: number;
  hasImages: boolean;
};

export type SkillAuthorPlan = {
  skill: string;
  kind: "vision" | "language";
  systemAddendum: string;
  requiresImages: boolean;
};
