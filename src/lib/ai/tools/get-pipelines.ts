import { tool } from 'ai';
import { z } from 'zod';
import { getAllPipelines } from '@/lib/hubspot/pipelines';

export const getPipelinesTool = tool({
  description: 'Get all deal pipelines and their stages with human-readable names. Use this to translate stage IDs to readable stage names like "Proposal", "Negotiation", "Closed Won", etc.',
  inputSchema: z.object({}),
  execute: async () => {
    const pipelines = await getAllPipelines();

    return {
      pipelineCount: pipelines.length,
      pipelines: pipelines.map((p) => ({
        id: p.id,
        name: p.label,
        stages: p.stages
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((s) => ({
            id: s.id,
            name: s.label,
            order: s.displayOrder,
            isClosed: s.metadata.isClosed || false,
            probability: s.metadata.probability,
          })),
      })),
      // Flat lookup for convenience
      stageLookup: pipelines.flatMap((p) =>
        p.stages.map((s) => ({
          stageId: s.id,
          stageName: s.label,
          pipelineName: p.label,
        }))
      ),
    };
  },
});
