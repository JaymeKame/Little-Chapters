export interface ImageReviewPanelDiagnostic {
  panel: number;
  settingMatches: boolean;
  characterMatches: boolean;
  actionMatches: boolean;
  noContradiction: boolean;
  meaningfullyDifferent: boolean;
  continuityMatches: boolean;
  confidence: number;
}

export interface ImageGenerationAttemptDiagnostic {
  attempt: number;
  providerStatus: number | null;
  reviewStatus: number | null;
  reviewApproved: boolean;
  reasons: string[];
  panels: ImageReviewPanelDiagnostic[];
}

export function safeReviewerReasonCodes(reasons: string[]): string[] {
  return [...new Set(reasons.map((reason) => reason.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)).filter(Boolean))].slice(0, 8);
}

export function panelPasses(panel: ImageReviewPanelDiagnostic): boolean {
  return panel.settingMatches && panel.characterMatches && panel.actionMatches && panel.noContradiction
    && panel.meaningfullyDifferent && panel.continuityMatches && panel.confidence >= 0.7;
}

/** Global approval cannot veto a storyboard whose complete per-panel contract
 * passes. Conversely, global approval cannot rescue a deficient panel. */
export function reviewPasses(globalApproved: boolean, panels: ImageReviewPanelDiagnostic[], expectedPanels: number): boolean {
  void globalApproved;
  return panels.length === expectedPanels && panels.every(panelPasses);
}

export function imageRepairFeedback(panels: ImageReviewPanelDiagnostic[], reasons: string[]): string {
  const feedback: string[] = [];
  for (const panel of panels) {
    const failed = (['settingMatches','characterMatches','actionMatches','noContradiction','meaningfullyDifferent','continuityMatches'] as const)
      .filter((key) => !panel[key]).map((key) => key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`));
    if (panel.confidence < 0.7) failed.push('review confidence');
    if (failed.length) feedback.push(`Panel ${panel.panel}: repair ${failed.join(', ')}.`);
  }
  if (!feedback.length && reasons.length) feedback.push(`Repair reviewer concerns: ${safeReviewerReasonCodes(reasons).join(', ')}.`);
  return feedback.slice(0, 4).join(' ');
}
