import { LinearClient } from '@linear/sdk';

// --- Client Factory ---

let _client: LinearClient | null = null;

export function getLinearClient(): LinearClient {
  if (!_client) {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      throw new Error('LINEAR_API_KEY environment variable is not set');
    }
    _client = new LinearClient({ apiKey });
  }
  return _client;
}

// --- Types ---

export interface LinearComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface LinearIssueContext {
  issueId: string;
  identifier: string;
  title: string;
  description: string | null;
  state: string;
  priority: string;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  comments: LinearComment[];
}

// --- Extract Issue ID from URL ---

/**
 * Extract a Linear issue identifier or UUID from a URL or raw identifier.
 * Supports formats:
 *   - https://linear.app/team/issue/TEAM-123/slug
 *   - https://linear.app/team/issue/TEAM-123
 *   - TEAM-123
 *   - Raw UUID
 */
function extractIssueIdentifier(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  // URL format: https://linear.app/{workspace}/issue/{TEAM-123}/...
  const urlMatch = trimmed.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/i);
  if (urlMatch) return urlMatch[1];

  // Direct identifier: TEAM-123
  const identifierMatch = trimmed.match(/^([A-Z]+-\d+)$/i);
  if (identifierMatch) return identifierMatch[1];

  // UUID
  const uuidMatch = trimmed.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  if (uuidMatch) return uuidMatch[0];

  return null;
}

// --- Fetch Issue Context ---

export async function fetchLinearIssueContext(
  linearTaskValue: string
): Promise<LinearIssueContext | null> {
  const identifier = extractIssueIdentifier(linearTaskValue);
  if (!identifier) {
    console.warn(`Could not extract Linear issue identifier from: ${linearTaskValue}`);
    return null;
  }

  try {
    const client = getLinearClient();

    // Fetch issue — the SDK accepts both identifiers (TEAM-123) and UUIDs
    const issue = await client.issue(identifier);
    if (!issue) return null;

    // Fetch state
    const state = await issue.state;
    const stateName = state?.name || 'Unknown';

    // Fetch assignee
    const assignee = await issue.assignee;
    const assigneeName = assignee?.name || null;

    // Fetch comments
    const commentsConnection = await issue.comments();
    const comments: LinearComment[] = (commentsConnection.nodes || []).map((c) => ({
      author: c.user ? (c.user as { name?: string }).name || 'Unknown' : 'Unknown',
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    }));

    // Sort comments chronologically
    comments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Map priority number to label
    const priorityLabels: Record<number, string> = {
      0: 'No priority',
      1: 'Urgent',
      2: 'High',
      3: 'Medium',
      4: 'Low',
    };

    return {
      issueId: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description || null,
      state: stateName,
      priority: priorityLabels[issue.priority] || 'Unknown',
      assignee: assigneeName,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
      comments,
    };
  } catch (error) {
    console.error(`Failed to fetch Linear issue context for "${linearTaskValue}":`, error);
    return null;
  }
}
