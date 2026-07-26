import { Platform, StyleSheet } from 'react-native';
import { VITRUVIUS_NATIVE_MIN_TOUCH_TARGET } from '../services/NativeInteractionPolicy';

export const colors = {
  bg: '#F5F5F7',
  card: '#FFFFFF',
  fill: '#F2F2F7',
  text: '#1D1D1F',
  muted: '#6E6E73',
  tertiaryText: '#9A9AA0',
  line: '#E5E5EA',
  primary: '#007AFF',
  primarySoft: '#EAF4FF',
  success: '#34C759',
  successSoft: '#EAF8EE',
  warning: '#FF9500',
  warningSoft: '#FFF4E5',
  insight: '#6B5DD3',
  insightSoft: '#F0EEFF',
  dangerSoft: '#FFECEC',
  danger: '#FF3B30',
};

export const styles = StyleSheet.create({
  appFrame: {
    flex: 1,
  },

  content: {
    padding: 18,
    paddingBottom: 110,
  },

  header: {
    paddingTop: 10,
    paddingBottom: 22,
  },

  kicker: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },

  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
  },

  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 7,
    fontWeight: '500',
  },

  screenTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },

  screenTitle: {
    flex: 1,
    marginBottom: 16,
  },

  screenTitleActionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 10,
    textTransform: 'uppercase',
  },


  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },

  countPill: {
    minWidth: 34,
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  countPillDanger: {
    backgroundColor: colors.dangerSoft,
  },

  countPillText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  countPillTextDanger: {
    color: colors.danger,
  },

  mutedNote: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    marginBottom: 16,
  },

  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 10,
    minHeight: 54,
    justifyContent: 'center',
  },

  secondaryButton: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 10,
    minHeight: 54,
    justifyContent: 'center',
  },

  compactButton: {
    flex: 1,
    minHeight: 64,
    marginBottom: 0,
  },

  disabledButton: {
    opacity: 0.45,
  },

  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    maxWidth: '100%',
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },

  secondaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },

  panel: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  panelTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },

  bodyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },

  locationPanel: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  locationPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },

  locationDetailText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    marginTop: 7,
  },

  locationActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },

  areaChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },

  areaChip: {
    backgroundColor: colors.fill,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },

  areaChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  areaChipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },

  areaChipTextSelected: {
    color: '#FFFFFF',
  },

  areaManagerCard: {
    backgroundColor: colors.fill,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    marginTop: 12,
  },

  areaNameInput: {
    marginTop: 14,
  },

  draftRecoveryCard: {
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: '#FFD8A3',
    borderRadius: 12,
    padding: 15,
    marginBottom: 14,
  },

  draftRecoveryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },

  draftIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  draftRecoveryTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },

  draftRecoveryProject: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 3,
  },

  draftStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 13,
  },

  draftStatText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },

  draftStatDot: {
    color: colors.muted,
    fontSize: 13,
    paddingHorizontal: 7,
  },

  draftActionRow: {
    flexDirection: 'row',
    gap: 9,
  },

  resumeDraftButton: {
    flex: 1,
    backgroundColor: colors.warning,
    borderRadius: 9,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },

  resumeDraftText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },

  discardDraftButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 9,
    minHeight: 46,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },

  discardDraftText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '800',
  },

  draftSavedIndicator: {
    backgroundColor: colors.successSoft,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 11,
    marginBottom: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },

  draftSavedText: {
    color: '#248A3D',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },

  dashboardCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderColor: colors.line,
    borderWidth: 1,
  },

  dashboardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },

  statsGrid: {
    flexDirection: 'row',
    gap: 8,
  },

  miniStat: {
    flex: 1,
    backgroundColor: colors.fill,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },

  miniStatDanger: {
    backgroundColor: colors.dangerSoft,
  },

  miniStatValue: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '800',
  },

  miniStatValueDanger: {
    color: colors.danger,
  },

  miniStatLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },

  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },

  smallAction: {
    backgroundColor: colors.primarySoft,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },

  smallActionText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  smallActionDanger: {
    backgroundColor: colors.dangerSoft,
  },

  smallActionDangerText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '800',
  },

  addProjectCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },

  projectRow: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderColor: colors.line,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  savedRow: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderColor: colors.line,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  scheduleItemCard: {
    alignItems: 'stretch',
    flexDirection: 'column',
    gap: 8,
    padding: 12,
  },

  scheduleItemHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },

  scheduleItemHeaderText: {
    minWidth: 0,
  },

  scheduleItemTitle: {
    flexShrink: 1,
    fontSize: 18,
    lineHeight: 24,
  },

  scheduleItemContext: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
  },

  scheduleItemBody: {
    alignSelf: 'stretch',
    width: '100%',
  },

  contactRow: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderColor: colors.line,
    borderWidth: 1,
  },


  contactRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },

  deliveryChoiceBlock: {
    marginTop: 12,
    width: '100%',
  },

  choiceChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  deliveryChoiceChip: {
    maxWidth: '100%',
    backgroundColor: colors.fill,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexShrink: 1,
  },

  deliveryChoiceChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  deliveryChoiceText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    maxWidth: 230,
  },

  deliveryChoiceTextActive: {
    color: '#FFFFFF',
  },

  rowMain: {
    flex: 1,
  },

  rowIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  projectName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },

  rowSub: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },

  contactSummary: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  contactSummaryText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },

  contactSummaryAction: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },

  contactSelectText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  contactSelectTextSelected: {
    color: colors.danger,
  },

  inlineLink: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    marginBottom: 12,
  },

  inlineLinkText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },

  progressPanel: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },

  progressStat: {
    flex: 1,
    alignItems: 'center',
  },

  progressDivider: {
    width: 1,
    height: 34,
    backgroundColor: colors.line,
  },

  progressNumber: {
    color: colors.primary,
    fontSize: 28,
    fontWeight: '800',
  },

  progressText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },

  emptyState: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },

  photoCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  photoHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginBottom: 12,
  },

  photoThumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.line,
  },

  photoMeta: {
    flex: 1,
  },

  photoTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },

  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },

  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },

  categoryChipActive: {
    backgroundColor: colors.primary,
  },

  categoryText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },

  categoryTextActive: {
    color: '#FFFFFF',
  },

  photoPreviewBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionPanel: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: '#CFE6FF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },

  actionPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 12,
  },

  actionPanelTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },

  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  statusButton: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },

  statusButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  statusButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },

  statusButtonTextActive: {
    color: '#FFFFFF',
  },

  dateHelpError: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
    marginTop: -7,
    marginBottom: 10,
  },

  photoControlRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },

  photoControlButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },

  photoControlButtonDisabled: {
    backgroundColor: colors.fill,
  },

  photoControlText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  photoControlTextDisabled: {
    color: colors.tertiaryText,
  },

  documentCurrentBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    backgroundColor: colors.successSoft,
  },

  documentCurrentControl: {
    flex: 0,
    marginBottom: 10,
  },

  photoModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.96)',
  },

  photoModalSafeArea: {
    flex: 1,
  },

  photoModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },

  photoModalTitleWrap: {
    flex: 1,
  },

  photoModalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },

  photoModalCaption: {
    color: '#D1D1D6',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },

  photoModalCloseButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sheetModalBackdrop: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  sheetModalSafeArea: {
    flex: 1,
  },

  sheetModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },

  sheetModalTitleWrap: {
    flex: 1,
  },

  sheetModalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },

  sheetModalCaption: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },

  sheetModalCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },

  photoModalImage: {
    flex: 1,
    width: '100%',
  },

  photoModalBottomBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 12 : 16,
  },

  photoModalBottomCloseButton: {
    minHeight: 54,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  photoModalBottomCloseText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },

  iconOnlyDangerButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  iconOnlyButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },

  input: {
    minHeight: 46,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },

  notesInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },

  previewCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderColor: colors.line,
    borderWidth: 1,
  },

  previewLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 7,
  },

  subjectText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },

  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 14,
  },

  previewBody: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },

  sendRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },

  dataActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    alignItems: 'stretch',
  },

  sectionLabelNoMargin: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },

  addLocationInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },

  addLocationInlineInput: {
    flex: 1,
    marginBottom: 0,
  },

  addLocationInlineButton: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  areaListCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    marginTop: 8,
  },

  areaListHeaderRow: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  areaListRow: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  areaStatusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  statusDotSaved: {
    backgroundColor: colors.success,
  },

  statusDotMissing: {
    backgroundColor: colors.tertiaryText,
  },

  areaListRadius: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
    minWidth: 58,
    textAlign: 'right',
  },

  detailModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },

  detailModalCardFrame: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
  },

  detailModalCardContent: {
    padding: 18,
    paddingBottom: Platform.OS === 'ios' ? 34 : 18,
  },

  detailModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },

  detailCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  radiusEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  radiusEditInput: {
    flex: 1,
  },

  radiusEditUnit: {
    color: colors.muted,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
  },

  locationSummaryCard: {
    backgroundColor: colors.fill,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    marginBottom: 12,
  },

  setupProgressCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: 8,
    padding: 12,
    marginTop: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#CFE6FF',
  },

  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },

  checklistText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },

  headerCompact: {
    paddingTop: 10,
    paddingBottom: 14,
  },

  dashboardSummaryCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderColor: colors.line,
    borderWidth: 1,
  },

  dashboardSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },

  dashboardManageButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },

  dashboardManageText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  dashboardMetricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  dashboardMetricCard: {
    width: '48%',
    backgroundColor: colors.fill,
    borderRadius: 11,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 86,
    borderWidth: 1,
    borderColor: colors.line,
  },

  dashboardMetricDanger: {
    backgroundColor: colors.dangerSoft,
    borderColor: '#FFD1D1',
  },

  dashboardMetricIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  dashboardMetricValue: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: '900',
  },

  dashboardMetricValueDanger: {
    color: colors.danger,
  },

  dashboardMetricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },

  quickActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },

  quickActionButton: {
    width: '48%',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.line,
    borderWidth: 1,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
  },

  quickActionButtonPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  quickActionText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '800',
    textAlign: 'center',
  },

  quickActionTextPrimary: {
    color: '#FFFFFF',
  },

  attentionCard: {
    backgroundColor: colors.card,
    borderRadius: 11,
    padding: 13,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  attentionCardUrgent: {
    borderColor: '#FFD1D1',
    backgroundColor: '#FFF8F8',
  },

  activityRow: {
    backgroundColor: colors.card,
    borderRadius: 11,
    padding: 13,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  projectFinderPanel: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 15,
    marginBottom: 18,
    borderColor: colors.line,
    borderWidth: 1,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  phase2SelectorButton: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    borderColor: 'rgba(0,0,0,0.18)',
    borderWidth: 1,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  phase2SelectorLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },

  phase2SelectorValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },

  phase2BriefCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderColor: colors.line,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  phase2BriefIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  phase2BriefIconAttention: {
    backgroundColor: colors.warningSoft,
  },

  phase2BriefIconHealthy: {
    backgroundColor: colors.successSoft,
  },

  phase2BriefIconProblem: {
    backgroundColor: colors.dangerSoft,
  },

  projectWorkspaceHero: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  projectWorkspaceHeroImage: {
    width: '100%',
    height: 180,
    resizeMode: 'cover',
  },

  projectWorkspaceHeroPlaceholder: {
    height: 130,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.fill,
  },

  projectWorkspaceCoverActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 10,
  },

  projectWorkspaceCoverButton: {
    flexBasis: '46%',
    minHeight: 44,
    paddingHorizontal: 8,
  },

  projectWorkspaceCoverTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingTop: 12,
  },

  overviewPageWrap: {
    flex: 1,
  },

  overviewPageGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 280,
  },

  overviewGreetingHeader: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  overviewGreetingCopy: {
    flex: 1,
  },

  overviewGreetingText: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
  },

  overviewGreetingDate: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },

  overviewAskDaveButton: {
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 13,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderColor: 'rgba(32,83,158,0.18)',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },

  overviewAskDaveText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  overviewHealthCard: {
    marginTop: 10,
    marginBottom: 20,
    borderRadius: 20,
    padding: 20,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 5,
  },

  overviewDashboardSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },

  overviewHealthEyebrow: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 3,
  },

  overviewHealthTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },

  overviewHealthMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },

  overviewHealthMetric: {
    flex: 1,
  },

  overviewHealthMetricValue: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '800',
    marginBottom: 3,
  },

  overviewHealthMetricLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },

  overviewDashboardHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 10,
  },

  overviewDashboardHeading: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
  },

  overviewDashboardLink: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    paddingVertical: 8,
  },

  overviewPriorityCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderColor: colors.line,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 22,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 4,
  },

  overviewPriorityImage: {
    width: '100%',
    height: 176,
    resizeMode: 'cover',
  },

  overviewPriorityClearPanel: {
    height: 130,
    backgroundColor: colors.primarySoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
  },

  overviewPriorityClearIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },

  overviewPriorityClearCopy: {
    gap: 2,
  },

  overviewPriorityClearTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
  },

  overviewPriorityClearText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },

  overviewPriorityContent: {
    padding: 18,
  },

  overviewPriorityBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.warningSoft,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 9,
    marginBottom: 10,
  },

  overviewPriorityBadgeText: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.7,
  },

  overviewPriorityClearBadgeText: {
    color: colors.success,
  },

  overviewPriorityProject: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '800',
    marginBottom: 6,
  },

  overviewPriorityRecommendation: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: 7,
  },

  overviewPrioritySupport: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 15,
  },

  overviewPriorityObservation: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
  },

  overviewPriorityObservationText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },

  overviewPriorityButton: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 15,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  overviewPriorityButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },

  overviewDailyBriefCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderColor: colors.line,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 4,
    marginBottom: 22,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  overviewBriefRow: {
    minHeight: 66,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  overviewBriefIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  overviewBriefProject: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },

  overviewBriefText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },

  overviewBriefEmpty: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 18,
  },

  overviewProjectCard: {
    minHeight: 116,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 11,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  overviewProjectImage: {
    width: 92,
    height: 92,
    borderRadius: 12,
    resizeMode: 'cover',
  },

  overviewProjectImagePlaceholder: {
    width: 92,
    height: 92,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  overviewProjectContent: {
    flex: 1,
  },

  overviewProjectTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 5,
  },

  overviewProjectTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },

  overviewProjectHealth: {
    fontSize: 11,
    fontWeight: '900',
  },

  overviewProjectSummary: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 7,
  },

  overviewProjectActivity: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },

  overviewActivityCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderColor: colors.line,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 6,
    marginBottom: 12,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  overviewActivityGroup: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    paddingTop: 12,
    paddingBottom: 3,
  },

  overviewActivityRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  overviewActivityIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  overviewActivityProject: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },

  overviewActivityText: {
    color: colors.muted,
    fontSize: 12,
  },

  overviewActivityTime: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },

  overviewHeroCard: {
    marginTop: 8,
    borderRadius: 20,
    overflow: 'hidden',
    height: 190,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.18)',
  },

  overviewHeroPhoto: {
    opacity: 0.55,
  },

  overviewHeroContent: {
    flex: 1,
    padding: 18,
    justifyContent: 'space-between',
  },

  overviewHeroLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.75)',
  },

  overviewHeroNumber: {
    fontSize: 52,
    fontWeight: '800',
    lineHeight: 56,
  },

  overviewHeroCaption: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.88)',
    marginTop: 2,
  },

  overviewHeroPill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },

  overviewHeroPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  overviewBentoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },

  overviewBentoCardTouchable: {
    flexBasis: '47%',
    flexGrow: 1,
  },

  overviewBentoCard: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.18)',
  },

  overviewBentoIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },

  overviewBentoNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },

  overviewBentoLabel: {
    fontSize: 12,
    color: colors.muted,
  },

  overviewSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 20,
    marginBottom: 6,
  },

  overviewSectionLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
  },

  overviewGroupedList: {
    gap: 8,
  },

  overviewGroupedCell: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.18)',
    overflow: 'hidden',
  },

  overviewGroupedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },

  overviewRowIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  overviewRowSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },

  overviewRowSubtitle: {
    fontSize: 13,
    color: colors.muted,
  },

  overviewDueTodayPillWrap: {
    paddingLeft: 58,
    paddingRight: 14,
    paddingBottom: 12,
    marginTop: -2,
  },

  overviewDueTodayPill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },

  overviewDueTodayText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.warning,
  },

  projectSelectorBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  projectSelectorScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.34)',
  },

  projectSelectorRow: {
    minHeight: 60,
    borderRadius: 8,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 12,
    marginBottom: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  projectSelectorRowSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },

  phase2ProjectCard: {
    minHeight: 116,
    borderRadius: 16,
    padding: 11,
    marginBottom: 12,
    borderColor: colors.line,
    borderWidth: 1,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  phase2ProjectThumb: {
    width: 92,
    height: 92,
    borderRadius: 12,
    backgroundColor: colors.fill,
    resizeMode: 'cover',
  },

  phase2ProjectThumbPlaceholder: {
    width: 92,
    height: 92,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  phase2ProjectTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },

  phase2ProjectTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },

  phase2ProjectStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  phase2ProjectStatusText: {
    fontSize: 10,
    fontWeight: '900',
  },

  phase2ProjectSummary: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 7,
  },

  phase2ProjectActivity: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },

  phase2BackButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    borderRadius: 8,
    borderColor: colors.line,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.card,
  },

  phase2ToolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },

  phase2ToolCard: {
    width: '48%',
    minHeight: 112,
    borderRadius: 8,
    borderColor: colors.line,
    borderWidth: 1,
    backgroundColor: colors.card,
    padding: 12,
    justifyContent: 'space-between',
  },

  phase2ToolLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 8,
  },

  phase3StepRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },

  phase3StepPill: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    borderColor: colors.line,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    paddingHorizontal: 6,
  },

  phase3StepPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  phase3StepPillComplete: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },

  phase3StepText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },

  phase3StepTextActive: {
    color: colors.text,
  },

  phase3MainTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 12,
  },

  phase3AutoCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
    borderColor: colors.line,
    borderWidth: 1,
    gap: 10,
  },

  repeatPhotoReferenceImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
    backgroundColor: colors.fill,
  },

  phase3CompactRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 10,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
  },

  phase3ChangeButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  phase3SummaryCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 14,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },

  phase3ThumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },

  phase3Thumb: {
    width: 76,
    height: 76,
    borderRadius: 8,
    backgroundColor: colors.fill,
  },

  phase3ChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginBottom: 16,
  },

  phase3ContextChip: {
    minHeight: 44,
    borderRadius: 999,
    borderColor: colors.line,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  phase3ContextChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  phase3ContextText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },

  phase3ContextTextSelected: {
    color: '#FFFFFF',
  },

  phase4PieCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderColor: colors.line,
    borderWidth: 1,
  },

  phase4SafetyFinding: {
    backgroundColor: colors.dangerSoft,
    borderColor: '#FFD1D1',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    gap: 10,
  },

  phase4SafetyTitle: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 4,
  },

  phase4DetailBlock: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    marginTop: 10,
    paddingTop: 10,
  },

  pieFindingRow: {
    borderRadius: 8,
    padding: 11,
    marginBottom: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },

  pieInterpretationActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },

  updateTopControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  updateSearchPanel: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    borderColor: colors.line,
    borderWidth: 1,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  updateSearchBox: {
    flex: 1,
    backgroundColor: colors.fill,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },

  updateFilterButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  updateFilterSummary: {
    minHeight: 54,
    borderRadius: 8,
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },

  updateSegmentRow: {
    flexDirection: 'row',
    backgroundColor: colors.fill,
    borderRadius: 12,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 4,
    marginBottom: 16,
  },

  updateSegment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },

  updateSegmentSelected: {
    backgroundColor: colors.primary,
  },

  updateSegmentText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },

  updateSegmentTextSelected: {
    color: '#FFFFFF',
  },

  updateCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 118,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  updateGroupHeader: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
    marginBottom: 9,
  },

  updateCardMedia: {
    width: 104,
    height: 92,
    position: 'relative',
  },

  updateCardThumb: {
    width: 104,
    height: 92,
    borderRadius: 10,
    backgroundColor: colors.fill,
    resizeMode: 'cover',
  },

  updateCardThumbPlaceholder: {
    width: 104,
    height: 92,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  updatePhotoStatusPill: {
    position: 'absolute',
    left: 7,
    bottom: 7,
    color: '#FFFFFF',
    backgroundColor: 'rgba(10, 34, 61, 0.86)',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },

  updateCardProject: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },

  updateCardSummary: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 8,
  },

  updateHistoricalEvidenceLabel: {
    color: colors.muted,
    backgroundColor: colors.fill,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginBottom: 8,
  },

  updateCardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },

  updateCardType: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },

  updateCardMetaDot: {
    color: colors.muted,
    fontSize: 12,
  },

  updateCardTime: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },

  updateCardActions: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  updateEmptyState: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  updateEmptyTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 7,
  },

  updateEmptyText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 14,
  },

  updateEmptyPrompt: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },

  updateFooterAction: {
    paddingTop: 4,
    paddingBottom: 6,
  },

  updateOverflowSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    borderColor: colors.line,
    borderWidth: 1,
  },

  projectSearchBox: {
    backgroundColor: colors.fill,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 12,
  },

  projectSearchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: 8,
  },

  projectSearchClearButton: {
    width: 44,
    height: 44,
    marginRight: -10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  projectFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },

  projectFilterChip: {
    backgroundColor: colors.fill,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },

  projectFilterChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  projectFilterText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },

  projectFilterTextSelected: {
    color: '#FFFFFF',
  },

  projectFinderStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },

  projectFinderRow: {
    backgroundColor: colors.card,
    borderRadius: 11,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  favoriteButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  compactStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 8,
  },

  compactStatText: {
    color: colors.muted,
    backgroundColor: colors.fill,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 7,
    fontSize: 11,
    fontWeight: '800',
  },

  compactStatDanger: {
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
  },

  projectFinderActions: {
    alignItems: 'flex-end',
    gap: 7,
  },

  dashboardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },

  compactLocationRow: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderColor: colors.line,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  compactActionColumn: {
    alignItems: 'flex-end',
    gap: 6,
    maxWidth: 96,
  },

  compactInlineAction: {
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 9,
    minHeight: VITRUVIUS_NATIVE_MIN_TOUCH_TARGET,
    minWidth: VITRUVIUS_NATIVE_MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },

  compactInlineActionText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
  },

  scheduleProjectCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderColor: colors.line,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  scheduleProjectHeader: {
    minHeight: 112,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  scheduleProjectIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleProjectTitle: {
    color: colors.text,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
  },
  scheduleProjectTasks: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.fill,
    padding: 10,
    paddingBottom: 0,
  },

  scheduleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusPillText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  percentText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '900',
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.line,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primary,
  },

  projectTaskPanel: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  taskUpdateContextCard: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    marginBottom: 14,
    padding: 14,
  },
  projectTaskEyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  projectTaskMetrics: {
    flexDirection: 'row',
    gap: 8,
  },
  projectTaskMetric: {
    backgroundColor: colors.fill,
    borderRadius: 12,
    flex: 1,
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  projectTaskMetricValue: {
    color: colors.text,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
  },
  projectTaskMetricLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  projectTaskForecast: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  projectTaskFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  projectTaskFilterButton: {
    backgroundColor: colors.fill,
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  projectTaskFilterButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  projectTaskFilterText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  projectTaskFilterTextActive: {
    color: '#FFFFFF',
  },
  projectTaskGroup: {
    gap: 10,
  },
  projectTaskGroupHeader: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
    borderLeftWidth: 5,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 12,
    minHeight: 62,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  projectTaskGroupHeaderComplete: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
  },
  projectTaskGroupTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  projectTaskGroupDetail: {
    color: colors.muted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    marginTop: 2,
  },
  projectTaskEmpty: {
    color: colors.muted,
    fontSize: 14,
    paddingVertical: 18,
    textAlign: 'center',
  },

  scheduleFieldEvidenceCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    marginTop: 10,
    padding: 10,
  },
  scheduleFieldEvidenceTitle: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  scheduleFieldEvidenceText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  scheduleFieldEvidenceAction: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    marginTop: 5,
  },
  scheduleVerificationCard: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warning,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    marginTop: 10,
    padding: 12,
  },
  scheduleVerificationTitle: {
    color: colors.warning,
    flex: 1,
    fontSize: 13,
    fontWeight: '900',
  },
  scheduleVerificationText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  scheduleVerificationActions: {
    gap: 10,
    paddingBottom: 12,
  },

});
