import type { RentalCategorySlug } from '@/lib/constants';

export interface AgentContext {
  userId: string | null;
  sessionId: string;
}

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  execute: (input: TInput, ctx: AgentContext) => Promise<TOutput>;
}

export interface UbunyeAgent {
  id: string;
  name: string;
  description: string;
  provider: 'anthropic' | 'gemma';
  model: string;
  tools: AgentTool[];
  rateLimit: {
    guest: number;
    free: number;
    pro: number;
    studio: number;
  };
  costTier: 'free' | 'low' | 'medium';
}

// Vision tool types
export interface GearIdentificationResult {
  brand: string;
  model: string;
  equipmentType: string;
  condition: 'new' | 'like_new' | 'good' | 'fair' | 'for_parts';
  category: RentalCategorySlug;
  confidence: number;
}

export interface SceneAnalysisResult {
  sceneType: string;
  lightingSetup: string;
  qualityScore: number;
  description: string;
  hashtags: string[];
}

export interface IdExtractionResult {
  firstName: string | null;
  lastName: string | null;
  idNumber: string | null;
  dateOfBirth: string | null;
}

export interface SkillDetectionResult {
  skills: Array<{
    name: string;
    percentage: number;
  }>;
  platformSkills?: Array<{
    id: string;
    label: string;
    percentage: number;
  }>;
}

export interface FaceMatchResult {
  match: boolean;
  confidence: number;
  reasoning: string;
}
