import { getHubSpotClient } from './client';

export interface PipelineStage {
  id: string;
  label: string;
  displayOrder: number;
  metadata: {
    isClosed?: boolean;
    probability?: number;
  };
}

export interface Pipeline {
  id: string;
  label: string;
  displayOrder: number;
  stages: PipelineStage[];
}

export async function getAllPipelines(): Promise<Pipeline[]> {
  const client = getHubSpotClient();

  const response = await client.crm.pipelines.pipelinesApi.getAll('deals');

  return response.results.map((pipeline) => ({
    id: pipeline.id,
    label: pipeline.label,
    displayOrder: pipeline.displayOrder,
    stages: pipeline.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      displayOrder: stage.displayOrder,
      metadata: {
        isClosed: stage.metadata?.isClosed === 'true',
        probability: stage.metadata?.probability
          ? parseFloat(stage.metadata.probability)
          : undefined,
      },
    })),
  }));
}

// Helper to create a stage ID -> name lookup map
export async function getStageNameMap(): Promise<Map<string, string>> {
  const pipelines = await getAllPipelines();
  const map = new Map<string, string>();

  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      map.set(stage.id, stage.label);
    }
  }

  return map;
}
