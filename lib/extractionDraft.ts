import type { ExtractionResponseValue, ExtractionTemplate } from "./prismaData";

type ExtractionValues = Record<string, ExtractionResponseValue | undefined>;

export function hasUnsavedExtractionAnswers(
  fields: ExtractionTemplate["fields"],
  values: ExtractionValues,
  savedValues: ExtractionValues = {}
) {
  return fields.some((field) => {
    const value = values[field.id];
    const savedValue = savedValues[field.id];
    if (field.type === "multiple_choice") {
      const choices = [...new Set(Array.isArray(value) ? value : [])].sort();
      const savedChoices = [...new Set(Array.isArray(savedValue) ? savedValue : [])].sort();
      return choices.length !== savedChoices.length || choices.some((choice, index) => choice !== savedChoices[index]);
    }
    return (typeof value === "string" ? value.trim() : "") !==
      (typeof savedValue === "string" ? savedValue.trim() : "");
  });
}
