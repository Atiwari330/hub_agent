import { requirePermission, RESOURCES } from '@/lib/auth';

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePermission(RESOURCES.PORTAL);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-8">
        {children}
      </div>
    </div>
  );
}
