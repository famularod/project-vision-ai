import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  appendDAVETaskFillInstruction,
  buildDAVETaskFillPatch,
  confirmDAVETaskFillField,
  parseDAVETaskFillTranscript,
  resolveDAVETaskFillCandidate,
  type DAVETaskFillField,
  type DAVETaskFillFieldName,
  type DAVETaskFillPatch,
  type DAVETaskFillTaskCandidate,
  type DAVETaskFillUnderstanding,
  type DAVETaskFillValues,
} from '../services/DAVETaskFieldParser';
import { colors, radius, spacing } from '../theme';
import { PROJECT_ITEM_TYPES } from '../types';
import { DAVEVoiceCaptureSheet } from './DAVEVoiceCaptureSheet';

export type DAVETaskFillProjectRecord = {
  id?: string | null;
  name: string;
};

const REVIEW_FIELD_NAMES: readonly DAVETaskFillFieldName[] = [
  'taskName',
  'itemType',
  'projectName',
  'locationName',
  'startDate',
  'finishDate',
  'milestone',
  'percentComplete',
  'status',
  'owner',
  'contractor',
  'nextAction',
  'notes',
  'priority',
];

const FIELD_LABELS: Record<DAVETaskFillFieldName, string> = {
  taskName: 'Task',
  itemType: 'Item type',
  projectName: 'Project',
  locationName: 'Area / location',
  startDate: 'Start date',
  finishDate: 'Finish / due date',
  milestone: 'Milestone',
  owner: 'Owner',
  contractor: 'Trade / contractor',
  percentComplete: 'Percent complete',
  status: 'Status',
  priority: 'Priority',
  notes: 'Notes',
  nextAction: 'Next action',
};

const GUIDED_FIELD_NAMES: readonly DAVETaskFillFieldName[] = [
  'taskName',
  'itemType',
  'projectName',
  'locationName',
  'startDate',
  'finishDate',
  'milestone',
  'owner',
  'contractor',
  'percentComplete',
  'priority',
  'status',
  'nextAction',
  'notes',
];

const GUIDED_QUESTIONS: Record<DAVETaskFillFieldName, {
  question: string;
  placeholder: string;
  required: boolean;
  multiline?: boolean;
}> = {
  taskName: { question: 'What should this task be called?', placeholder: 'Example: Install east lobby doors', required: true },
  itemType: { question: 'What kind of project item is this?', placeholder: 'Choose an item type', required: true },
  projectName: { question: 'Which project does this belong to?', placeholder: 'Project name', required: true },
  locationName: { question: 'Where will this work happen?', placeholder: 'Area or location', required: false },
  startDate: { question: 'When should the work start?', placeholder: 'MM/DD/YYYY, today, or tomorrow', required: false },
  finishDate: { question: 'When should it finish or be due?', placeholder: 'MM/DD/YYYY, today, or tomorrow', required: false },
  milestone: { question: 'Is this tied to a milestone?', placeholder: 'Milestone name', required: false },
  owner: { question: 'Who owns this item internally?', placeholder: 'Owner name', required: false },
  contractor: { question: 'Which contractor or trade is responsible?', placeholder: 'Contractor or trade', required: false },
  percentComplete: { question: 'How much is complete right now?', placeholder: '0 to 100', required: true },
  priority: { question: 'What priority should this have?', placeholder: 'Choose a priority', required: true },
  status: { question: 'What is the current status?', placeholder: 'Choose a status', required: true },
  nextAction: { question: 'What is the next accountable action?', placeholder: 'Smallest clear next step', required: false },
  notes: { question: 'What else should the team know?', placeholder: 'Constraints, context, or instructions', required: false, multiline: true },
};

export function DAVETaskFillAssistant({
  active,
  initiallyGuided = false,
  projectNames,
  projectRecords,
  locationNames,
  ownerNames,
  contractorNames,
  milestoneNames = [],
  taskCandidates,
  currentValues,
  onApply,
}: {
  active: boolean;
  initiallyGuided?: boolean;
  projectNames: readonly string[];
  projectRecords: readonly DAVETaskFillProjectRecord[];
  locationNames: readonly string[];
  ownerNames: readonly string[];
  contractorNames: readonly string[];
  milestoneNames?: readonly string[];
  taskCandidates: readonly DAVETaskFillTaskCandidate[];
  currentValues: DAVETaskFillValues;
  onApply: (patch: DAVETaskFillPatch) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voicePurpose, setVoicePurpose] = useState<'instruction' | 'guided'>('instruction');
  const [instruction, setInstruction] = useState('');
  const [review, setReview] = useState<DAVETaskFillUnderstanding | null>(null);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const [applied, setApplied] = useState(false);
  const [guided, setGuided] = useState(false);
  const [guidedIndex, setGuidedIndex] = useState(0);
  const [guidedAnswer, setGuidedAnswer] = useState('');
  const [guidedError, setGuidedError] = useState<string | null>(null);
  const [guidedSkipped, setGuidedSkipped] = useState<Set<DAVETaskFillFieldName>>(() => new Set());
  const [guidedComplete, setGuidedComplete] = useState(false);
  const guidedStartedForOpenRef = useRef(false);
  const candidateLocations = useMemo(() => uniqueOptions(locationNames), [locationNames]);
  const candidateProjects = useMemo(() => uniqueOptions(projectNames), [projectNames]);
  const currentProjectName = currentValues.projectName || candidateProjects[0] || '';
  const currentProjectId = projectRecords.find(project =>
    project.name.trim().toLowerCase() === currentProjectName.trim().toLowerCase(),
  )?.id?.trim() || null;
  const currentGuidedField = GUIDED_FIELD_NAMES[guidedIndex];
  const currentGuidedQuestion = GUIDED_QUESTIONS[currentGuidedField];
  const guidedOptions = guidedOptionsForField(currentGuidedField, {
    projectNames: candidateProjects,
    locationNames: candidateLocations,
    ownerNames,
    contractorNames,
    milestoneNames,
  });

  function startGuidedQuestions() {
    setExpanded(true);
    setGuided(true);
    setGuidedIndex(0);
    setGuidedAnswer(guidedValue(currentValues, GUIDED_FIELD_NAMES[0]));
    setGuidedError(null);
    setGuidedSkipped(new Set());
    setGuidedComplete(false);
  }

  useEffect(() => {
    if (!active) {
      guidedStartedForOpenRef.current = false;
      return;
    }
    if (!initiallyGuided || guidedStartedForOpenRef.current) return;
    guidedStartedForOpenRef.current = true;
    startGuidedQuestions();
    // Only start once for each modal opening. Current form values are read by
    // the explicit question transitions after that point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, initiallyGuided]);

  useEffect(() => {
    if (active) return;
    setExpanded(false);
    setVoiceOpen(false);
    setInstruction('');
    setReview(null);
    setDuplicateConfirmed(false);
    setApplied(false);
    setGuided(false);
    setGuidedIndex(0);
    setGuidedAnswer('');
    setGuidedError(null);
    setGuidedSkipped(new Set());
    setGuidedComplete(false);
  }, [active]);

  function goToGuidedQuestion(nextIndex: number) {
    if (nextIndex >= GUIDED_FIELD_NAMES.length) {
      setGuidedComplete(true);
      return;
    }
    const boundedIndex = Math.max(0, nextIndex);
    setGuidedIndex(boundedIndex);
    setGuidedAnswer(guidedValue(currentValues, GUIDED_FIELD_NAMES[boundedIndex]));
    setGuidedError(null);
  }

  function saveGuidedAnswer() {
    const result = guidedPatchForAnswer(currentGuidedField, guidedAnswer, {
      projectNames: candidateProjects,
      locationNames: candidateLocations,
      ownerNames,
      contractorNames,
      milestoneNames,
      taskCandidates,
      currentValues,
    });
    if (result.error) {
      setGuidedError(result.error);
      return;
    }
    if (Object.keys(result.patch).length > 0) onApply(result.patch);
    setGuidedSkipped(previous => {
      const next = new Set(previous);
      next.delete(currentGuidedField);
      return next;
    });
    goToGuidedQuestion(guidedIndex + 1);
  }

  function skipGuidedAnswer() {
    if (currentGuidedQuestion.required) return;
    setGuidedSkipped(previous => new Set(previous).add(currentGuidedField));
    goToGuidedQuestion(guidedIndex + 1);
  }

  function editInstruction(nextInstruction: string) {
    setInstruction(nextInstruction);
    setReview(null);
    setDuplicateConfirmed(false);
    setApplied(false);
  }

  function reviewInstruction() {
    setReview(parseDAVETaskFillTranscript(instruction, {
      mode: 'create',
      projectNames: candidateProjects,
      locationNames: candidateLocations,
      ownerNames,
      contractorNames,
      taskCandidates,
      currentValues,
    }));
    setDuplicateConfirmed(false);
    setApplied(false);
  }

  function cancelFill() {
    setVoiceOpen(false);
    setInstruction('');
    setReview(null);
    setDuplicateConfirmed(false);
    setApplied(false);
    setGuided(false);
    setGuidedIndex(0);
    setGuidedAnswer('');
    setGuidedError(null);
    setGuidedSkipped(new Set());
    setGuidedComplete(false);
    setExpanded(false);
  }

  function applyReviewedChanges() {
    if (!review) return;
    const patch = buildDAVETaskFillPatch(review, currentValues);
    if (Object.keys(patch).length === 0) return;
    onApply(patch);
    setApplied(true);
  }

  const unresolvedBlockingGap = review?.gaps.some(gap =>
    gap.blocking && !(gap.kind === 'duplicate_task' && duplicateConfirmed),
  ) ?? false;
  const proposedFields = review
    ? REVIEW_FIELD_NAMES.filter(fieldName => {
        const field = review.fields[fieldName] as DAVETaskFillField<unknown>;
        return field.value !== null || field.sourceText || field.candidates.length > 0;
      })
    : [];

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(value => !value)}
        accessibilityRole="button"
        accessibilityLabel="Fill task with voice or text"
        accessibilityState={{ expanded }}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="sparkles-outline" size={20} color={colors.primary} />
        </View>
        <View style={styles.main}>
          <Text style={styles.title}>Fill with voice or text</Text>
          <Text style={styles.subtitle}>Describe the task, review the proposed fields, then apply them.</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
          size={20}
          color={colors.primary}
        />
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.body}>
          {guided ? guidedComplete ? (
            <View style={styles.guidedCompleteCard}>
              <Ionicons name="checkmark-circle-outline" size={28} color={colors.success} />
              <Text style={styles.guidedCompleteTitle}>All task fields reviewed</Text>
              <Text style={styles.guidedCompleteText}>
                The answers are in the task form below. {guidedSkipped.size > 0
                  ? `${guidedSkipped.size} optional ${guidedSkipped.size === 1 ? 'field was' : 'fields were'} intentionally skipped. `
                  : ''}Review the form, then save when it is correct.
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => {
                  setGuided(false);
                  setExpanded(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Review completed task form"
              >
                <Text style={styles.primaryButtonText}>Review Task Form</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.guidedCard}>
              <View style={styles.guidedProgressRow}>
                <Text style={styles.guidedStep}>Question {guidedIndex + 1} of {GUIDED_FIELD_NAMES.length}</Text>
                <Text style={currentGuidedQuestion.required ? styles.requiredTag : styles.optionalTag}>
                  {currentGuidedQuestion.required ? 'Required' : 'Optional'}
                </Text>
              </View>
              <Text style={styles.guidedQuestion}>{currentGuidedQuestion.question}</Text>
              <Text style={styles.guidedFieldLabel}>{FIELD_LABELS[currentGuidedField]}</Text>
              {guidedOptions.length > 0 ? (
                <View style={styles.candidates}>
                  {guidedOptions.map(option => {
                    const selected = option.toLocaleLowerCase() === guidedAnswer.trim().toLocaleLowerCase();
                    return (
                      <TouchableOpacity
                        key={option}
                        style={[styles.guidedChoice, selected && styles.guidedChoiceSelected]}
                        onPress={() => {
                          setGuidedAnswer(option);
                          setGuidedError(null);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${FIELD_LABELS[currentGuidedField]} ${option}`}
                      >
                        <Text style={[styles.guidedChoiceText, selected && styles.guidedChoiceTextSelected]}>{option}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
              <TextInput
                accessibilityLabel={`Answer ${FIELD_LABELS[currentGuidedField]}`}
                style={[styles.guidedInput, currentGuidedQuestion.multiline && styles.guidedInputMultiline]}
                value={guidedAnswer}
                onChangeText={value => {
                  setGuidedAnswer(value);
                  setGuidedError(null);
                }}
                placeholder={currentGuidedQuestion.placeholder}
                placeholderTextColor={colors.mutedText}
                keyboardType={currentGuidedField === 'percentComplete' ? 'number-pad' : 'default'}
                multiline={Boolean(currentGuidedQuestion.multiline)}
                textAlignVertical={currentGuidedQuestion.multiline ? 'top' : 'center'}
              />
              {guidedError ? <Text style={styles.guidedError}>{guidedError}</Text> : null}
              <TouchableOpacity
                style={styles.recordAnswerButton}
                onPress={() => {
                  setVoicePurpose('guided');
                  setVoiceOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Record answer for ${FIELD_LABELS[currentGuidedField]}`}
              >
                <Ionicons name="mic-outline" size={18} color={colors.primary} />
                <Text style={styles.secondaryButtonText}>Record Answer</Text>
              </TouchableOpacity>
              <View style={styles.guidedNavigation}>
                {guidedIndex > 0 ? (
                  <TouchableOpacity
                    style={styles.guidedBackButton}
                    onPress={() => goToGuidedQuestion(guidedIndex - 1)}
                    accessibilityRole="button"
                    accessibilityLabel="Previous task question"
                  >
                    <Text style={styles.secondaryButtonText}>Back</Text>
                  </TouchableOpacity>
                ) : null}
                {!currentGuidedQuestion.required ? (
                  <TouchableOpacity
                    style={styles.guidedBackButton}
                    onPress={skipGuidedAnswer}
                    accessibilityRole="button"
                    accessibilityLabel={`Skip optional ${FIELD_LABELS[currentGuidedField]}`}
                  >
                    <Text style={styles.secondaryButtonText}>Not Applicable</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[styles.primaryButton, !guidedAnswer.trim() && styles.disabled]}
                  onPress={saveGuidedAnswer}
                  accessibilityRole="button"
                  accessibilityLabel={`Save ${FIELD_LABELS[currentGuidedField]} answer and continue`}
                  disabled={!guidedAnswer.trim()}
                >
                  <Text style={styles.primaryButtonText}>
                    {guidedIndex === GUIDED_FIELD_NAMES.length - 1 ? 'Finish Questions' : 'Save & Continue'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={styles.guidedStartCard}
                onPress={startGuidedQuestions}
                accessibilityRole="button"
                accessibilityLabel="Start guided task questions"
              >
                <Ionicons name="help-circle-outline" size={22} color={colors.primary} />
                <View style={styles.main}>
                  <Text style={styles.guidedStartTitle}>Answer guided questions</Text>
                  <Text style={styles.guidedStartText}>Review every task field one at a time so important details are not missed.</Text>
                </View>
                <Ionicons name="chevron-forward-outline" size={20} color={colors.primary} />
              </TouchableOpacity>

              <Text style={styles.orText}>or describe several fields at once</Text>
              <Text style={styles.label}>Editable instruction</Text>
              <TextInput
                accessibilityLabel="Editable task instruction"
                style={styles.instruction}
                value={instruction}
                onChangeText={editInstruction}
                placeholder="Example: Task Install east lobby doors, area East Lobby, owner David, due tomorrow, 50 percent."
                placeholderTextColor={colors.mutedText}
                multiline
              />
              <View style={styles.actions}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setVoicePurpose('instruction');
                setVoiceOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Record task instruction"
            >
              <Ionicons name="mic-outline" size={19} color={colors.primary} />
              <Text style={styles.secondaryButtonText}>Record</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, !instruction.trim() && styles.disabled]}
              onPress={reviewInstruction}
              accessibilityRole="button"
              accessibilityLabel="Review proposed task changes"
              disabled={!instruction.trim()}
            >
              <Ionicons name="list-outline" size={19} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>Review Changes</Text>
            </TouchableOpacity>
              </View>

              {review ? (
            <View style={styles.reviewCard}>
              <View style={styles.reviewHeader}>
                <View style={styles.main}>
                  <Text style={styles.reviewTitle}>Proposed field changes</Text>
                  <Text style={styles.reviewHelp}>Nothing changes until you tap Apply to Task Form.</Text>
                </View>
                <Ionicons name="eye-outline" size={20} color={colors.primary} />
              </View>

              {proposedFields.map(fieldName => {
                const field = review.fields[fieldName] as DAVETaskFillField<unknown>;
                return (
                  <View key={fieldName} style={styles.proposalRow}>
                    <Text style={styles.proposalLabel}>{FIELD_LABELS[fieldName]}</Text>
                    {field.value !== null ? (
                      <Text style={styles.proposalValue}>{formatFieldValue(fieldName, field.value)}</Text>
                    ) : (
                      <Text style={styles.unresolvedValue}>Needs a choice</Text>
                    )}
                    <Text style={styles.confidenceText}>
                      {field.needsConfirmation
                        ? 'Confirm before applying'
                        : `${Math.round(field.confidence * 100)}% field match`}
                    </Text>
                    {field.candidates.length > 1 ? (
                      <View style={styles.candidates}>
                        {field.candidates.map(candidate => (
                          <TouchableOpacity
                            key={String(candidate)}
                            style={styles.candidateButton}
                            onPress={() => setReview(current => current
                              ? resolveDAVETaskFillCandidate(current, fieldName, String(candidate))
                              : current)}
                            accessibilityRole="button"
                            accessibilityLabel={`Use ${String(candidate)} for ${FIELD_LABELS[fieldName]}`}
                          >
                            <Text style={styles.candidateText}>{String(candidate)}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : field.needsConfirmation && field.value !== null ? (
                      <TouchableOpacity
                        style={styles.confirmButton}
                        onPress={() => setReview(current => current
                          ? confirmDAVETaskFillField(current, fieldName)
                          : current)}
                        accessibilityRole="button"
                        accessibilityLabel={`Confirm ${FIELD_LABELS[fieldName]}`}
                      >
                        <Text style={styles.confirmText}>Use this value</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}

              {review.warnings.map(warning => (
                <View key={warning} style={styles.warningRow}>
                  <Ionicons name="warning-outline" size={18} color={colors.warning} />
                  <Text style={styles.warningText}>{warning}</Text>
                </View>
              ))}

              {review.gaps.map((gap, index) => {
                if (gap.kind === 'duplicate_task' && duplicateConfirmed) return null;
                return (
                  <View key={`${gap.field}-${gap.kind}-${index}`} style={styles.gapCard}>
                    <Text style={styles.gapText}>{gap.message}</Text>
                    {gap.candidates.map(candidate => (
                      <Text key={candidate} style={styles.gapCandidate}>• {candidate}</Text>
                    ))}
                    {gap.kind === 'duplicate_task' ? (
                      <TouchableOpacity
                        style={styles.confirmButton}
                        onPress={() => setDuplicateConfirmed(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Confirm separate new task"
                      >
                        <Text style={styles.confirmText}>Create a separate task</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}

              <TouchableOpacity
                style={[
                  styles.applyButton,
                  (unresolvedBlockingGap || applied) && styles.disabled,
                ]}
                onPress={applyReviewedChanges}
                accessibilityRole="button"
                accessibilityLabel="Apply proposed changes to task form"
                disabled={unresolvedBlockingGap || applied}
              >
                <Ionicons
                  name={applied ? 'checkmark-circle-outline' : 'arrow-down-circle-outline'}
                  size={20}
                  color="#FFFFFF"
                />
                <Text style={styles.primaryButtonText}>
                  {applied ? 'Applied to Task Form' : 'Apply to Task Form'}
                </Text>
              </TouchableOpacity>
              {applied ? (
                <Text style={styles.appliedHelp}>Review the form below, then use Save Task when it is correct.</Text>
              ) : null}
            </View>
              ) : null}
            </>
          )}

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={cancelFill}
            accessibilityRole="button"
            accessibilityLabel="Cancel task fill"
          >
            <Text style={styles.cancelText}>{guided ? 'Cancel Guided Questions' : 'Cancel Task Fill'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <DAVEVoiceCaptureSheet
        visible={voiceOpen}
        projectId={currentProjectId}
        projectName={currentProjectName}
        candidateProjects={candidateProjects}
        candidateLocations={candidateLocations}
        title={voicePurpose === 'guided' ? `Answer: ${FIELD_LABELS[currentGuidedField]}` : 'Record Task Instruction'}
        prompt={voicePurpose === 'guided' ? currentGuidedQuestion.question : 'Describe the task fields to fill'}
        guidance={voicePurpose === 'guided'
          ? 'Give one clear answer. You can edit the transcript before saving it.'
          : 'Include only what you want to add or change. You can edit the transcript before review.'}
        continueLabel="Use Transcript"
        showWalkContext={false}
        onMemoryReady={result => {
          if (voicePurpose === 'guided') {
            setGuidedAnswer(result.transcript.trim());
            setGuidedError(null);
          } else {
            editInstruction(appendDAVETaskFillInstruction(instruction, result.transcript));
          }
          setVoiceOpen(false);
        }}
        onProjectChange={() => undefined}
        onTypeInstead={() => setVoiceOpen(false)}
        onCancel={() => setVoiceOpen(false)}
      />
    </View>
  );
}

function guidedValue(values: DAVETaskFillValues, fieldName: DAVETaskFillFieldName): string {
  const value = values[fieldName];
  return value === null || value === undefined ? '' : String(value);
}

function guidedOptionsForField(
  fieldName: DAVETaskFillFieldName,
  options: {
    projectNames: readonly string[];
    locationNames: readonly string[];
    ownerNames: readonly string[];
    contractorNames: readonly string[];
    milestoneNames: readonly string[];
  },
): string[] {
  if (fieldName === 'itemType') return [...PROJECT_ITEM_TYPES];
  if (fieldName === 'projectName') return uniqueOptions(options.projectNames);
  if (fieldName === 'locationName') return uniqueOptions(options.locationNames);
  if (fieldName === 'owner') return uniqueOptions(options.ownerNames);
  if (fieldName === 'contractor') return uniqueOptions(options.contractorNames);
  if (fieldName === 'milestone') return uniqueOptions(options.milestoneNames);
  if (fieldName === 'percentComplete') return ['0', '25', '50', '75', '100'];
  if (fieldName === 'priority') return ['Low', 'Medium', 'High'];
  if (fieldName === 'status') return ['Not Started', 'In Progress', 'Waiting', 'Complete'];
  if (fieldName === 'startDate' || fieldName === 'finishDate') return ['Today', 'Tomorrow'];
  return [];
}

function guidedPatchForAnswer(
  fieldName: DAVETaskFillFieldName,
  rawAnswer: string,
  context: {
    projectNames: readonly string[];
    locationNames: readonly string[];
    ownerNames: readonly string[];
    contractorNames: readonly string[];
    milestoneNames: readonly string[];
    taskCandidates: readonly DAVETaskFillTaskCandidate[];
    currentValues: DAVETaskFillValues;
  },
): { patch: DAVETaskFillPatch; error: string | null } {
  const answer = rawAnswer.trim();
  if (!answer) {
    return { patch: {}, error: `${FIELD_LABELS[fieldName]} needs an answer.` };
  }

  if (fieldName === 'percentComplete') {
    const match = answer.match(/\d{1,3}/);
    const percent = match ? Number(match[0]) : Number.NaN;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return { patch: {}, error: 'Enter a percentage from 0 to 100.' };
    }
    return { patch: { percentComplete: percent }, error: null };
  }

  if (fieldName === 'startDate' || fieldName === 'finishDate') {
    const label = fieldName === 'startDate' ? 'start date' : 'due date';
    const parsed = parseDAVETaskFillTranscript(`${label}: ${answer}`, {
      mode: 'create',
      currentValues: context.currentValues,
    });
    const value = parsed.fields[fieldName].value;
    if (!value) {
      return { patch: {}, error: 'Use a clear date such as MM/DD/YYYY, today, or tomorrow.' };
    }
    return { patch: { [fieldName]: value } as DAVETaskFillPatch, error: null };
  }

  if (fieldName === 'itemType' || fieldName === 'status' || fieldName === 'priority') {
    const supported = guidedOptionsForField(fieldName, context);
    const normalizedAnswer = answer.toLocaleLowerCase();
    const exact = supported.find(option => option.toLocaleLowerCase() === normalizedAnswer);
    if (exact) {
      return { patch: { [fieldName]: exact } as DAVETaskFillPatch, error: null };
    }
    const parsed = parseDAVETaskFillTranscript(`${FIELD_LABELS[fieldName]}: ${answer}`, {
      mode: 'create',
      projectNames: context.projectNames,
      locationNames: context.locationNames,
      ownerNames: context.ownerNames,
      contractorNames: context.contractorNames,
      taskCandidates: context.taskCandidates,
      currentValues: context.currentValues,
    });
    const value = parsed.fields[fieldName].value;
    if (value === null) {
      return { patch: {}, error: `Choose a valid ${FIELD_LABELS[fieldName].toLocaleLowerCase()}.` };
    }
    return { patch: { [fieldName]: value } as DAVETaskFillPatch, error: null };
  }

  return { patch: { [fieldName]: answer } as DAVETaskFillPatch, error: null };
}

function formatFieldValue(fieldName: DAVETaskFillFieldName, value: unknown): string {
  if (fieldName === 'percentComplete') return `${String(value)}%`;
  return String(value);
}

function uniqueOptions(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.map(value => value.trim()).filter(value => {
    if (!value) return false;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const styles = StyleSheet.create({
  container: {
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 66,
    padding: spacing.md,
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  main: { flex: 1 },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  subtitle: { color: colors.mutedText, fontSize: 13, lineHeight: 18, marginTop: 2 },
  body: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1, padding: spacing.md },
  guidedStartCard: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 72,
    padding: spacing.md,
  },
  guidedStartTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  guidedStartText: { color: colors.mutedText, fontSize: 13, lineHeight: 18, marginTop: 2 },
  orText: { color: colors.mutedText, fontSize: 12, fontWeight: '700', marginVertical: spacing.md, textAlign: 'center' },
  guidedCard: { gap: spacing.sm },
  guidedProgressRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  guidedStep: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  requiredTag: { backgroundColor: colors.primarySoft, borderRadius: 999, color: colors.primary, fontSize: 12, fontWeight: '800', overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 4 },
  optionalTag: { backgroundColor: colors.surfaceMuted, borderRadius: 999, color: colors.mutedText, fontSize: 12, fontWeight: '800', overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 4 },
  guidedQuestion: { color: colors.text, fontSize: 20, fontWeight: '800', lineHeight: 27 },
  guidedFieldLabel: { color: colors.mutedText, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  guidedInput: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: 16, minHeight: 50, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  guidedInputMultiline: { minHeight: 110 },
  guidedError: { color: colors.danger, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  guidedChoice: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: 999, borderWidth: 1, justifyContent: 'center', minHeight: 42, paddingHorizontal: spacing.sm },
  guidedChoiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  guidedChoiceText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  guidedChoiceTextSelected: { color: '#FFFFFF' },
  recordAnswerButton: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.sm },
  guidedNavigation: { alignItems: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  guidedBackButton: { alignItems: 'center', borderColor: colors.primary, borderRadius: radius.md, borderWidth: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.md },
  guidedCompleteCard: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  guidedCompleteTitle: { color: colors.text, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  guidedCompleteText: { color: colors.mutedText, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  label: { color: colors.text, fontSize: 14, fontWeight: '800', marginBottom: spacing.xs },
  instruction: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 110,
    padding: spacing.sm,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  reviewCard: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  reviewHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  reviewTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  reviewHelp: { color: colors.mutedText, fontSize: 12, lineHeight: 17, marginTop: 2 },
  proposalRow: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1, padding: spacing.md },
  proposalLabel: { color: colors.mutedText, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  proposalValue: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 3 },
  unresolvedValue: { color: colors.warning, fontSize: 15, fontWeight: '800', marginTop: 3 },
  confidenceText: { color: colors.mutedText, fontSize: 12, marginTop: 3 },
  candidates: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  candidateButton: { backgroundColor: colors.primarySoft, borderRadius: 999, minHeight: 40, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  candidateText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  confirmButton: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', marginTop: spacing.xs, paddingHorizontal: spacing.sm },
  confirmText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  warningRow: { alignItems: 'flex-start', backgroundColor: colors.warningSoft, borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: spacing.xs, padding: spacing.sm },
  warningText: { color: colors.text, flex: 1, fontSize: 13, lineHeight: 18 },
  gapCard: { backgroundColor: colors.warningSoft, borderTopColor: colors.border, borderTopWidth: 1, padding: spacing.sm },
  gapText: { color: colors.text, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  gapCandidate: { color: colors.mutedText, fontSize: 12, lineHeight: 18, marginTop: 2 },
  applyButton: { alignItems: 'center', backgroundColor: colors.primary, flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', minHeight: 52, margin: spacing.md, borderRadius: radius.md },
  appliedHelp: { color: colors.success, fontSize: 13, fontWeight: '700', lineHeight: 18, paddingBottom: spacing.md, paddingHorizontal: spacing.md, textAlign: 'center' },
  cancelButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: spacing.xs },
  cancelText: { color: colors.mutedText, fontSize: 14, fontWeight: '700' },
});
