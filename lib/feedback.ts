export type FeedbackMessage = {
  status: "pending" | "success" | "warning" | "error";
  message: string;
};
