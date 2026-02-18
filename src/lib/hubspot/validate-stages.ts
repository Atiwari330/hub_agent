/**
 * Pipeline health check: compares HubSpot's live pipeline stages against
 * the stages our code knows about (ALL_KNOWN_STAGE_IDS).
 *
 * Run during sync to detect:
 * - New stages added in HubSpot that our queues don't cover
 * - Config stages that no longer exist in HubSpot (stale entries)
 */

import { getAllPipelines } from './pipelines';
import { ALL_KNOWN_STAGE_IDS, SALES_PIPELINE_STAGES } from './stage-config';
import { SYNC_CONFIG } from './sync-config';

export interface StageValidationResult {
  hasWarnings: boolean;
  unknownStages: { id: string; label: string }[];
  removedStages: { id: string; label: string }[];
}

export async function validatePipelineStages(): Promise<StageValidationResult> {
  const pipelines = await getAllPipelines();
  const salesPipeline = pipelines.find((p) => p.id === SYNC_CONFIG.TARGET_PIPELINE_ID);

  if (!salesPipeline) {
    console.warn('validatePipelineStages: Sales Pipeline not found in HubSpot!');
    return { hasWarnings: true, unknownStages: [], removedStages: [] };
  }

  const hubSpotStageIds = new Set(salesPipeline.stages.map((s) => s.id));

  // Stages in HubSpot that we don't know about
  const unknownStages = salesPipeline.stages
    .filter((s) => !ALL_KNOWN_STAGE_IDS.has(s.id))
    .map((s) => ({ id: s.id, label: s.label }));

  // Stages in our config that no longer exist in HubSpot
  const removedStages: { id: string; label: string }[] = [];
  for (const stage of Object.values(SALES_PIPELINE_STAGES)) {
    if (!hubSpotStageIds.has(stage.id)) {
      removedStages.push({ id: stage.id, label: stage.label });
    }
  }

  const hasWarnings = unknownStages.length > 0 || removedStages.length > 0;

  if (unknownStages.length > 0) {
    console.warn(
      'Unknown HubSpot stages detected (not in stage-config.ts):',
      unknownStages.map((s) => `${s.label} (${s.id})`).join(', ')
    );
  }

  if (removedStages.length > 0) {
    console.warn(
      'Configured stages missing from HubSpot (may have been removed):',
      removedStages.map((s) => `${s.label} (${s.id})`).join(', ')
    );
  }

  return { hasWarnings, unknownStages, removedStages };
}
