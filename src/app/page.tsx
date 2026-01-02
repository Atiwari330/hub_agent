import { AgentChat } from '@/components/agent-chat';
import { createServerSupabaseClient } from '@/lib/supabase/client';

interface WorkflowRun {
  id: string;
  workflow_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
}

async function getDashboardStats() {
  try {
    const supabase = await createServerSupabaseClient();

    const [ownersResult, dealsResult, workflowsResult] = await Promise.all([
      supabase.from('owners').select('*', { count: 'exact', head: true }),
      supabase.from('deals').select('*', { count: 'exact', head: true }),
      supabase
        .from('workflow_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(5),
    ]);

    return {
      ownerCount: ownersResult.count || 0,
      dealCount: dealsResult.count || 0,
      recentWorkflows: (workflowsResult.data || []) as WorkflowRun[],
    };
  } catch (error) {
    console.error('Failed to fetch dashboard stats:', error);
    return {
      ownerCount: 0,
      dealCount: 0,
      recentWorkflows: [] as WorkflowRun[],
    };
  }
}

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">RevOps Agent</h1>
          <p className="text-gray-600 mt-1">
            AI-powered Revenue Operations Assistant for HubSpot CRM
          </p>
        </header>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
              Account Executives
            </h3>
            <p className="text-3xl font-bold text-gray-900 mt-2">
              {stats.ownerCount}
            </p>
            <p className="text-sm text-gray-500 mt-1">Synced from HubSpot</p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
              Active Deals
            </h3>
            <p className="text-3xl font-bold text-gray-900 mt-2">
              {stats.dealCount}
            </p>
            <p className="text-sm text-gray-500 mt-1">In pipeline</p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
              Last Sync
            </h3>
            <p className="text-xl font-bold text-gray-900 mt-2">
              {stats.recentWorkflows[0]?.completed_at
                ? new Date(stats.recentWorkflows[0].completed_at).toLocaleDateString()
                : 'Never'}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {stats.recentWorkflows[0]?.status || 'No runs yet'}
            </p>
          </div>
        </div>

        {/* Agent Chat */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Ask the Agent
          </h2>
          <AgentChat />
        </section>

        {/* Recent Workflow Runs */}
        {stats.recentWorkflows.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Recent Workflow Runs
            </h2>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Workflow
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Started
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {stats.recentWorkflows.map((run) => (
                    <tr key={run.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {run.workflow_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            run.status === 'completed'
                              ? 'bg-green-100 text-green-800'
                              : run.status === 'failed'
                              ? 'bg-red-100 text-red-800'
                              : run.status === 'running'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(run.started_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Setup Instructions (show if no data) */}
        {stats.ownerCount === 0 && stats.dealCount === 0 && (
          <section className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-blue-900 mb-2">
              Getting Started
            </h2>
            <p className="text-blue-800 mb-4">
              To start using the RevOps Agent, you need to:
            </p>
            <ol className="list-decimal list-inside text-blue-800 space-y-2">
              <li>
                Add your credentials to <code className="bg-blue-100 px-1 rounded">.env.local</code>
              </li>
              <li>
                Run the Supabase migration in{' '}
                <code className="bg-blue-100 px-1 rounded">supabase/migrations/001_initial_schema.sql</code>
              </li>
              <li>
                Trigger a sync by visiting{' '}
                <a href="/api/cron/sync-hubspot" className="underline">
                  /api/cron/sync-hubspot
                </a>
              </li>
            </ol>
          </section>
        )}
      </div>
    </main>
  );
}
