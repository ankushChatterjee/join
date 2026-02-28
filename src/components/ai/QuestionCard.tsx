// ============================================================================
// Question Card Component (Amber Theme)
// 
// Based on Opencode's question implementation:
// - Shows questions with options (radio for single, checkbox for multiple)
// - Custom text input appears when "Type your own answer" is selected
// - Multiple questions can be shown with tab navigation
// ============================================================================

import { useState, useMemo } from "react";
import { Check, ChevronLeft, ChevronRight, HelpCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiStore } from "@/stores/aiStore";
import type { PendingQuestion } from "@/ai/types";

interface QuestionCardProps {
  pendingQuestion: PendingQuestion;
}

export function QuestionCard({ pendingQuestion }: QuestionCardProps) {
  const { answerQuestion, rejectQuestion } = useAiStore();
  const questions = pendingQuestion.questions;

  // Current tab state
  const [currentTab, setCurrentTab] = useState(0);

  // Answers state: array of arrays, one per question
  const [answers, setAnswers] = useState<string[][]>(() =>
    questions.map(() => [])
  );

  // Custom text inputs state
  const [customInputs, setCustomInputs] = useState<string[]>(() =>
    questions.map(() => "")
  );

  // Editing state for custom inputs
  const [editing, setEditing] = useState<boolean[]>(() =>
    questions.map(() => false)
  );

  // Calculate how many questions are answered
  const answeredCount = useMemo(() => {
    return questions.filter((q, i) => {
      const hasSelectedOption = answers[i]?.length > 0;
      const hasCustomInput = q.custom !== false && customInputs[i]?.trim().length > 0;
      return hasSelectedOption || hasCustomInput;
    }).length;
  }, [questions, answers, customInputs]);

  const currentQuestion = questions[currentTab];
  const isLast = currentTab === questions.length - 1;
  const isFirst = currentTab === 0;

  const currentAnswer = answers[currentTab] || [];
  const currentCustomInput = customInputs[currentTab] || "";
  const isEditing = editing[currentTab] || false;
  const hasAnswer =
    currentAnswer.length > 0 ||
    (currentQuestion.custom !== false && currentCustomInput.trim().length > 0);

  const handleOptionToggle = (optionIndex: number) => {
    const option = currentQuestion.options[optionIndex];
    if (!option) return;

    if (currentQuestion.multiple) {
      // Multi-select: toggle
      setAnswers((prev) => {
        const newAnswers = [...prev];
        const current = newAnswers[currentTab] || [];
        if (current.includes(option.label)) {
          newAnswers[currentTab] = current.filter((l) => l !== option.label);
        } else {
          newAnswers[currentTab] = [...current, option.label];
        }
        return newAnswers;
      });
    } else {
      // Single-select: replace
      setAnswers((prev) => {
        const newAnswers = [...prev];
        newAnswers[currentTab] = [option.label];
        return newAnswers;
      });
      // Clear editing state for non-multiple
      if (isEditing) {
        setEditing((prev) => {
          const newEditing = [...prev];
          newEditing[currentTab] = false;
          return newEditing;
        });
      }
    }
  };

  const handleCustomToggle = () => {
    if (currentQuestion.multiple) {
      // Multi-select: toggle custom mode
      if (isEditing) {
        // Turn off editing and remove custom value from answers
        setEditing((prev) => {
          const newEditing = [...prev];
          newEditing[currentTab] = false;
          return newEditing;
        });
        const value = currentCustomInput.trim();
        if (value) {
          setAnswers((prev) => {
            const newAnswers = [...prev];
            const current = newAnswers[currentTab] || [];
            newAnswers[currentTab] = current.filter((l) => l.trim() !== value);
            return newAnswers;
          });
        }
      } else {
        // Turn on editing
        setEditing((prev) => {
          const newEditing = [...prev];
          newEditing[currentTab] = true;
          return newEditing;
        });
        // Add current custom value to answers
        const value = currentCustomInput.trim();
        if (value) {
          setAnswers((prev) => {
            const newAnswers = [...prev];
            const current = newAnswers[currentTab] || [];
            if (!current.includes(value)) {
              newAnswers[currentTab] = [...current, value];
            }
            return newAnswers;
          });
        }
      }
    } else {
      // Single-select: open editing
      setEditing((prev) => {
        const newEditing = [...prev];
        newEditing[currentTab] = true;
        return newEditing;
      });
      // Replace answer with custom
      const value = currentCustomInput.trim();
      setAnswers((prev) => {
        const newAnswers = [...prev];
        newAnswers[currentTab] = value ? [value] : [];
        return newAnswers;
      });
    }
  };

  const handleCustomChange = (value: string) => {
    setCustomInputs((prev) => {
      const newInputs = [...prev];
      newInputs[currentTab] = value;
      return newInputs;
    });

    if (currentQuestion.multiple) {
      // Multi-select: update answers to include only current custom value
      const trimmed = value.trim();
      setAnswers((prev) => {
        const newAnswers = [...prev];
        const current = newAnswers[currentTab] || [];
        // Remove previous custom values (not matching predefined options)
        const predefinedLabels = currentQuestion.options.map((o) => o.label);
        const nonCustom = current.filter((l) => predefinedLabels.includes(l));
        if (trimmed) {
          newAnswers[currentTab] = [...nonCustom, trimmed];
        } else {
          newAnswers[currentTab] = nonCustom;
        }
        return newAnswers;
      });
    } else {
      // Single-select: replace with custom value
      const trimmed = value.trim();
      setAnswers((prev) => {
        const newAnswers = [...prev];
        newAnswers[currentTab] = trimmed ? [trimmed] : [];
        return newAnswers;
      });
    }
  };

  const handleNext = () => {
    if (isEditing) {
      // Commit custom input
      setEditing((prev) => {
        const newEditing = [...prev];
        newEditing[currentTab] = false;
        return newEditing;
      });
    }

    if (isLast) {
      // Submit all answers
      handleSubmit();
    } else {
      setCurrentTab((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (isEditing) {
      setEditing((prev) => {
        const newEditing = [...prev];
        newEditing[currentTab] = false;
        return newEditing;
      });
    }
    setCurrentTab((prev) => Math.max(0, prev - 1));
  };

  const handleSubmit = () => {
    answerQuestion(pendingQuestion.toolCallId, answers);
  };

  const handleDismiss = () => {
    rejectQuestion(pendingQuestion.toolCallId);
  };

  const jumpToTab = (tab: number) => {
    if (isEditing) {
      setEditing((prev) => {
        const newEditing = [...prev];
        newEditing[currentTab] = false;
        return newEditing;
      });
    }
    setCurrentTab(tab);
  };

  return (
    <div className="my-3 overflow-hidden rounded-sm border border-amber-500/30 bg-amber-500/5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-amber-500/20 bg-amber-500/10 px-3 py-2">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-medium text-amber-300">
            {answeredCount} / {questions.length} answered
          </span>
        </div>
        <button
          onClick={handleDismiss}
          className="p-1 rounded-sm text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex gap-1 px-3 pt-3">
        {questions.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => jumpToTab(i)}
            className={cn(
              "h-1.5 rounded-full transition-all duration-200",
              i === currentTab
                ? "w-6 bg-amber-500"
                : answers[i]?.length > 0 ||
                  (questions[i].custom !== false &&
                    customInputs[i]?.trim().length > 0)
                ? "w-1.5 bg-amber-400/60"
                : "w-1.5 bg-base-700"
            )}
            aria-label={`Go to question ${i + 1}`}
          />
        ))}
      </div>

      {/* Question content */}
      <div className="px-3 pt-3 pb-2">
        <p className="text-sm text-base-100 font-medium">{currentQuestion.question}</p>
        <p className="text-xs text-base-400 mt-1">
          {currentQuestion.multiple ? "Select all that apply" : "Select one option"}
        </p>
      </div>

      {/* Options */}
      <div className="px-3 pb-3 space-y-1">
        {currentQuestion.options.map((option, i) => {
          const isSelected = currentAnswer.includes(option.label);
          return (
            <button
              key={i}
              onClick={() => handleOptionToggle(i)}
              className={cn(
                "w-full flex items-start gap-2 p-2.5 rounded-sm text-left transition-colors",
                "hover:bg-base-800/50",
                isSelected && "bg-amber-500/10 border border-amber-500/30"
              )}
            >
              <span className="mt-0.5 shrink-0">
                {currentQuestion.multiple ? (
                  <span
                    className={cn(
                      "flex items-center justify-center w-4 h-4 rounded border transition-colors",
                      isSelected
                        ? "bg-amber-500 border-amber-500"
                        : "border-base-600"
                    )}
                  >
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </span>
                ) : (
                  <span
                    className={cn(
                      "flex items-center justify-center w-4 h-4 rounded-full border transition-colors",
                      isSelected
                        ? "border-amber-500"
                        : "border-base-600"
                    )}
                  >
                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                    )}
                  </span>
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-base-100">{option.label}</span>
                {option.description && (
                  <span className="block text-xs text-base-400 mt-0.5">
                    {option.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}

        {/* Custom option */}
        {currentQuestion.custom !== false && (
          <>
            {isEditing ? (
              <div className="mt-2">
                <textarea
                  value={currentCustomInput}
                  onChange={(e) => handleCustomChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleNext();
                    }
                    if (e.key === "Escape") {
                      setEditing((prev) => {
                        const newEditing = [...prev];
                        newEditing[currentTab] = false;
                        return newEditing;
                      });
                    }
                  }}
                  placeholder="Type your own answer..."
                  className="w-full px-3 py-2 bg-base-900 border border-amber-500/30 rounded-sm text-sm text-base-100 placeholder:text-base-500 focus:outline-none focus:border-amber-500 resize-none"
                  rows={2}
                  autoFocus
                />
              </div>
            ) : (
              <button
                onClick={handleCustomToggle}
                className={cn(
                  "w-full flex items-start gap-2 p-2.5 rounded-sm text-left transition-colors mt-2",
                  "hover:bg-base-800/50 border border-dashed",
                  currentAnswer.some(
                    (a) =>
                      !currentQuestion.options.some((o) => o.label === a)
                  ) 
                    ? "bg-amber-500/10 border-amber-500/50" 
                    : "border-base-600 hover:border-base-500"
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {currentQuestion.multiple ? (
                    <span
                      className={cn(
                        "flex items-center justify-center w-4 h-4 rounded border transition-colors",
                        currentAnswer.some(
                          (a) =>
                            !currentQuestion.options.some((o) => o.label === a)
                        )
                          ? "bg-amber-500 border-amber-500"
                          : "border-base-600"
                      )}
                    >
                      {currentAnswer.some(
                        (a) =>
                          !currentQuestion.options.some((o) => o.label === a)
                      ) && <Check className="w-3 h-3 text-white" />}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "flex items-center justify-center w-4 h-4 rounded-full border transition-colors",
                        currentAnswer.some(
                          (a) =>
                            !currentQuestion.options.some((o) => o.label === a)
                        )
                          ? "border-amber-500"
                          : "border-base-600"
                      )}
                    >
                      {currentAnswer.some(
                        (a) =>
                          !currentQuestion.options.some((o) => o.label === a)
                      ) && <span className="w-2 h-2 rounded-full bg-amber-500" />}
                    </span>
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-base-100">
                    Type your own answer
                  </span>
                  <span className="block text-xs text-base-400 mt-0.5">
                    {currentCustomInput.trim() || "Enter a custom response..."}
                  </span>
                </span>
              </button>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-amber-500/20 px-3 py-2.5">
        <div className="flex items-center gap-2">
          {!isFirst && (
            <button
              onClick={handleBack}
              className="flex items-center gap-1 px-3 py-1.5 rounded-sm text-xs font-medium text-base-300 hover:text-base-100 hover:bg-base-800 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Back
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDismiss}
            className="px-3 py-1.5 rounded-sm text-xs font-medium text-base-400 hover:text-base-200 hover:bg-base-800 transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={handleNext}
            disabled={!hasAnswer}
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 rounded-sm text-xs font-medium transition-colors",
              hasAnswer
                ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                : "bg-base-800 text-base-500 cursor-not-allowed"
            )}
          >
            {isLast ? "Submit" : "Next"}
            {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
